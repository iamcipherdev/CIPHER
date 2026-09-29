// Regression tests for Gemini thought-signature preservation (HTTP 400 fix).
//
// The bug: GeminiProvider parsed functionCall parts but DROPPED
// thoughtSignature, so the next request rebuilt history with a bare
// { functionCall: { name, args } } part and Gemini 3 rejected it with
// "Function call is missing a thought_signature" (HTTP 400).
//
// These tests drive the PUBLIC chat() API with mocked HTTP so the full
// round-trip is exercised: response parse → message history → next request.

import { describe, it, expect, afterEach } from "vitest";
import { GeminiProvider, OpenAICompatProvider, OllamaProvider } from "../providers";
import type { ChatMessage } from "../providers";

const originalFetch = globalThis.fetch;

/** Install a fetch stub that records request bodies and plays canned replies. */
function mockFetch(replies: unknown[]): { requests: any[] } {
  const requests: any[] = [];
  let call = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push(body);
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { requests };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Push an assistant message exactly the way the agent loop does. */
function pushAssistant(
  messages: ChatMessage[],
  reply: { content: string | null; toolCalls: any[]; providerParts?: unknown[] }
) {
  messages.push({
    role: "assistant",
    content: reply.content,
    ...(reply.providerParts?.length ? { gemini_parts: reply.providerParts } : {}),
    tool_calls: reply.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      ...(tc.thought_signature ? { thought_signature: tc.thought_signature } : {}),
    })),
  });
}

function modelParts(requestBody: any, modelTurnIndex: number): any[] {
  const turns = requestBody.contents.filter((c: any) => c.role === "model");
  return turns[modelTurnIndex]?.parts ?? [];
}

// ---------------------------------------------------------------------------

describe("Gemini thought signature round-trip", () => {
  it("TEST 1: single function call — thoughtSignature survives on the exact functionCall part", async () => {
    const { requests } = mockFetch([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { name: "get_system_info", args: {} },
                  thoughtSignature: "TEST_SIGNATURE_123",
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [
          { content: { role: "model", parts: [{ text: "Here is your system info." }] } },
        ],
      },
    ]);

    const provider = new GeminiProvider("gemini-3-pro", "test-key");
    const messages: ChatMessage[] = [{ role: "user", content: "Tell me my system information." }];

    const reply = await provider.chat(messages);
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0].name).toBe("get_system_info");
    expect(reply.toolCalls[0].thought_signature).toBe("TEST_SIGNATURE_123");

    // rebuild history exactly like the agent loop, then ask again
    pushAssistant(messages, reply);
    messages.push({
      role: "tool",
      tool_call_id: reply.toolCalls[0].id,
      tool_name: "get_system_info",
      content: "verified=true | host DESKTOP-X",
    });

    await provider.chat(messages);

    // request 2 must carry the original signature on the SAME functionCall part
    const parts = modelParts(requests[1], 0);
    expect(parts).toHaveLength(1);
    expect(parts[0].functionCall).toEqual({ name: "get_system_info", args: {} });
    expect(parts[0].thoughtSignature).toBe("TEST_SIGNATURE_123");

    // the tool result must map to the REAL function name (Phase 9)
    const userTurns = requests[1].contents.filter((c: any) => c.role === "user");
    const toolTurn = userTurns[userTurns.length - 1];
    expect(toolTurn.parts[0].functionResponse.name).toBe("get_system_info");
    expect(toolTurn.parts[0].functionResponse.response.result).toContain("DESKTOP-X");
  });

  it("TEST 2: missing thoughtSignature must not crash and must not invent one", async () => {
    const { requests } = mockFetch([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "get_memory_info", args: {} } }],
            },
          },
        ],
      },
      { candidates: [{ content: { role: "model", parts: [{ text: "done" }] } }] },
    ]);

    const provider = new GeminiProvider("gemini-3-pro", "test-key");
    const messages: ChatMessage[] = [{ role: "user", content: "show ram" }];
    const reply = await provider.chat(messages);
    expect(reply.toolCalls[0].thought_signature).toBeUndefined();

    pushAssistant(messages, reply);
    messages.push({
      role: "tool",
      tool_call_id: reply.toolCalls[0].id,
      tool_name: "get_memory_info",
      content: "ok",
    });
    await provider.chat(messages);

    const parts = modelParts(requests[1], 0);
    expect(parts[0].functionCall.name).toBe("get_memory_info");
    expect(parts[0].thoughtSignature).toBeUndefined();
  });

  it("TEST 3: parallel function calls — FC1 keeps its signature, FC2 gets NO copied signature", async () => {
    const { requests } = mockFetch([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { name: "get_system_info", args: {} },
                  thoughtSignature: "SIG_ONLY_ON_FC1",
                },
                { functionCall: { name: "get_disk_info", args: {} } },
              ],
            },
          },
        ],
      },
      { candidates: [{ content: { role: "model", parts: [{ text: "done" }] } }] },
    ]);

    const provider = new GeminiProvider("gemini-3-pro", "test-key");
    const messages: ChatMessage[] = [{ role: "user", content: "system and disk info" }];
    const reply = await provider.chat(messages);
    expect(reply.toolCalls).toHaveLength(2);
    expect(reply.toolCalls[0].thought_signature).toBe("SIG_ONLY_ON_FC1");
    expect(reply.toolCalls[1].thought_signature).toBeUndefined();

    pushAssistant(messages, reply);
    for (const tc of reply.toolCalls) {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        tool_name: tc.name,
        content: "ok",
      });
    }
    await provider.chat(messages);

    const parts = modelParts(requests[1], 0);
    expect(parts).toHaveLength(2);
    expect(parts[0].functionCall.name).toBe("get_system_info");
    expect(parts[0].thoughtSignature).toBe("SIG_ONLY_ON_FC1");
    expect(parts[1].functionCall.name).toBe("get_disk_info");
    expect(parts[1].thoughtSignature).toBeUndefined();
  });

  it("TEST 4: sequential tool calls — every model step keeps its own signature", async () => {
    const { requests } = mockFetch([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { name: "get_system_info", args: {} },
                  thoughtSignature: "SIG_A",
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { name: "get_memory_info", args: {} },
                  thoughtSignature: "SIG_B",
                },
              ],
            },
          },
        ],
      },
      { candidates: [{ content: { role: "model", parts: [{ text: "all done" }] } }] },
    ]);

    const provider = new GeminiProvider("gemini-3-pro", "test-key");
    const messages: ChatMessage[] = [{ role: "user", content: "system info, then memory" }];

    // step 1
    const reply1 = await provider.chat(messages);
    expect(reply1.toolCalls[0].thought_signature).toBe("SIG_A");
    pushAssistant(messages, reply1);
    messages.push({
      role: "tool",
      tool_call_id: reply1.toolCalls[0].id,
      tool_name: "get_system_info",
      content: "ok",
    });

    // step 2
    const reply2 = await provider.chat(messages);
    expect(reply2.toolCalls[0].thought_signature).toBe("SIG_B");
    pushAssistant(messages, reply2);
    messages.push({
      role: "tool",
      tool_call_id: reply2.toolCalls[0].id,
      tool_name: "get_memory_info",
      content: "ok",
    });

    // request 3 must preserve BOTH signatures on the correct turns
    await provider.chat(messages);
    const turn0 = modelParts(requests[2], 0);
    const turn1 = modelParts(requests[2], 1);
    expect(turn0[0].functionCall.name).toBe("get_system_info");
    expect(turn0[0].thoughtSignature).toBe("SIG_A");
    expect(turn1[0].functionCall.name).toBe("get_memory_info");
    expect(turn1[0].thoughtSignature).toBe("SIG_B");
  });

  it("TEST 4b: verbatim replay — raw parts keep order and text-part signatures", async () => {
    // A reply where the FIRST part is a text part with its own signature,
    // followed by a function call — order and placement must not change.
    const { requests } = mockFetch([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "Let me check that.", thoughtSignature: "SIG_TEXT" },
                {
                  functionCall: { name: "get_system_info", args: {} },
                  thoughtSignature: "SIG_FC",
                },
              ],
            },
          },
        ],
      },
      { candidates: [{ content: { role: "model", parts: [{ text: "done" }] } }] },
    ]);

    const provider = new GeminiProvider("gemini-3-pro", "test-key");
    const messages: ChatMessage[] = [{ role: "user", content: "check my system" }];
    const reply = await provider.chat(messages);
    expect(reply.content).toBe("Let me check that.");

    pushAssistant(messages, reply);
    messages.push({
      role: "tool",
      tool_call_id: reply.toolCalls[0].id,
      tool_name: "get_system_info",
      content: "ok",
    });
    await provider.chat(messages);

    // verbatim replay of the raw model parts: same order, same signatures
    const parts = modelParts(requests[1], 0);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: "Let me check that.", thoughtSignature: "SIG_TEXT" });
    expect(parts[1].thoughtSignature).toBe("SIG_FC");
  });

  it("TEST 5: other providers are unaffected by Gemini metadata", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_system_info", arguments: "{}" },
            thought_signature: "SIG_SHOULD_NOT_APPEAR",
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", tool_name: "get_system_info", content: "ok" },
    ];

    // OpenAI-compatible wire format: no thought_signature leakage
    const { requests: openaiReqs } = mockFetch([{ choices: [{ message: { content: "ok" } }] }]);
    const openai = new OpenAICompatProvider(
      "openai",
      "https://api.openai.com/v1",
      "gpt-4o-mini",
      "k"
    );
    await openai.chat(messages);
    const oaMsg = openaiReqs[0].messages.find((m: any) => m.role === "assistant");
    expect(oaMsg.tool_calls[0].function.name).toBe("get_system_info");
    expect(JSON.stringify(openaiReqs[0])).not.toContain("SIG_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(openaiReqs[0])).not.toContain("thoughtSignature");

    // Ollama wire format: same guarantee
    const { requests: olReqs } = mockFetch([{ message: { content: "ok" } }]);
    const ollama = new OllamaProvider("http://localhost:11434", "llama3.2");
    await ollama.chat(messages);
    const olAssistant = olReqs[0].messages.find((m: any) => m.role === "assistant");
    expect(olAssistant.tool_calls[0].function.name).toBe("get_system_info");
    expect(JSON.stringify(olReqs[0])).not.toContain("SIG_SHOULD_NOT_APPEAR");
  });
});
