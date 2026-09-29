// Provider-independent AI layer. CIPHER never ships keys — everything is BYOK
// and keys are fetched from OS secure storage at call time.

import type { AISettings } from "../lib/types";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Gemini-only. Opaque provider metadata ("thoughtSignature") that came on
   * the SAME response part as this functionCall. Gemini 3 requires it to be
   * replayed verbatim with that exact functionCall on the next request.
   * Never modified, decoded, or fabricated — stored exactly as received.
   * Optional + ignored by every other provider.
   */
  thought_signature?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    /** Gemini-only: exact thoughtSignature that must ride with this functionCall. */
    thought_signature?: string;
  }[];
  tool_call_id?: string;
  tool_name?: string;
  /** base64 PNG screenshots attached to this message */
  images?: string[];
  /**
   * Gemini-only: the raw model `parts` array from the original reply.
   * GeminiProvider replays it verbatim so thoughtSignature placement and part
   * order survive the round-trip exactly as Gemini sent them.
   */
  gemini_parts?: unknown[];
}

export interface ChatReply {
  content: string | null;
  toolCalls: ToolCall[];
  /** Gemini-only: raw response parts, preserved for verbatim replay. */
  providerParts?: unknown[];
}

export interface Provider {
  id: string;
  label: string;
  chat(messages: ChatMessage[]): Promise<ChatReply>;
  supportsTools(): boolean;
  supportsVision(): boolean;
}

export function providerError(status: number, body: string, provider: string, model: string): string {
  const snippet = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key (HTTP ${status}). Check the key in Settings → AI. Details: ${snippet}`;
  }
  if (status === 404) {
    return `${provider} says model "${model}" doesn't exist (HTTP 404). Check the model id in Settings → AI. Details: ${snippet}`;
  }
  if (status === 429) {
    return `${provider} rate limit hit (HTTP 429). Wait a moment or switch models. Details: ${snippet}`;
  }
  return `${provider} returned HTTP ${status} for model "${model}". Details: ${snippet}`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Couldn't reach ${url} (${e instanceof Error ? e.message : e}). Check your internet connection or endpoint.`
    );
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(providerError(resp.status, text, "The provider", ""));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Provider returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenAI, OpenRouter, Groq, custom endpoints)
// ---------------------------------------------------------------------------

const PRESETS: Record<string, { base: string; label: string; keyHint: string }> = {
  openai: { base: "https://api.openai.com/v1", label: "OpenAI", keyHint: "sk-…" },
  openrouter: {
    base: "https://openrouter.ai/api/v1",
    label: "OpenRouter",
    keyHint: "sk-or-…",
  },
  groq: { base: "https://api.groq.com/openai/v1", label: "Groq", keyHint: "gsk_…" },
  custom: { base: "", label: "Custom endpoint", keyHint: "key (if required)" },
};

export class OpenAICompatProvider implements Provider {
  id: string;
  label: string;
  private base: string;
  private model: string;
  private key: string;

  constructor(id: string, base: string, model: string, key: string) {
    this.id = id;
    this.label = PRESETS[id]?.label ?? id;
    this.base = base.replace(/\/$/, "");
    this.model = model;
    this.key = key;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    const m = this.model.toLowerCase();
    return /4o|4\.1|o4|gpt-5|vision|llama-4|qwen2.5.*vl/.test(m);
  }

  private mapMessages(messages: ChatMessage[]): unknown[] {
    const out: unknown[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        out.push({ role: "system", content: m.content });
      } else if (m.role === "tool") {
        out.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: m.content,
        });
        if (m.images?.length) {
          const parts: unknown[] = [
            { type: "text", text: `Screenshot captured by tool "${m.tool_name ?? "tool"}":` },
          ];
          for (const img of m.images) {
            parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
          }
          out.push({ role: "user", content: parts });
        }
      } else if (m.role === "user") {
        if (m.images?.length) {
          const parts: unknown[] = [{ type: "text", text: m.content ?? "" }];
          for (const img of m.images) {
            parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } });
          }
          out.push({ role: "user", content: parts });
        } else {
          out.push({ role: "user", content: m.content });
        }
      } else if (m.role === "assistant") {
        const entry: Record<string, unknown> = { role: "assistant", content: m.content };
        if (m.tool_calls?.length) {
          // OpenAI wire format only — strip provider-specific metadata such as
          // Gemini's thought_signature so it never leaks to other providers.
          entry.tool_calls = m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }));
        }
        out.push(entry);
      }
    }
    return out;
  }

  async chat(messages: ChatMessage[]): Promise<ChatReply> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.mapMessages(messages),
      temperature: 0.2,
    };
    body.tools = TOOL_SCHEMAS_FOR_PROVIDER;
    body.tool_choice = "auto";

    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (this.id === "openrouter") {
      headers["HTTP-Referer"] = "https://cipher.local";
      headers["X-Title"] = "CIPHER";
    }

    let resp: Response;
    try {
      resp = await fetch(`${this.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(
        `Couldn't reach ${this.label} (${e instanceof Error ? e.message : e}). Check your internet connection.`
      );
    }
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(providerError(resp.status, text, this.label, this.model));
    }
    let json: {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }[];
        };
      }[];
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${this.label} returned invalid JSON.`);
    }
    const msg = json.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = { _raw: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
    return { content: msg?.content ?? null, toolCalls };
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export class GeminiProvider implements Provider {
  id = "gemini";
  label = "Google Gemini";
  private model: string;
  private key: string;

  constructor(model: string, key: string) {
    this.model = model;
    this.key = key;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  private mapContents(messages: ChatMessage[]): { contents: unknown[]; system?: string } {
    const contents: unknown[] = [];
    let system: string | undefined;
    for (const m of messages) {
      if (m.role === "system") {
        system = m.content ?? undefined;
        continue;
      }
      if (m.role === "user") {
        const parts: unknown[] = [{ text: m.content ?? "" }];
        for (const img of m.images ?? []) {
          parts.push({ inline_data: { mime_type: "image/png", data: img } });
        }
        contents.push({ role: "user", parts });
      } else if (m.role === "assistant") {
        // Preferred replay: send the model's own parts back verbatim. This is
        // exactly what Google's function-calling guide does — it preserves
        // thoughtSignature placement, part order, and thought parts byte-for-byte.
        if (m.gemini_parts?.length) {
          contents.push({ role: "model", parts: m.gemini_parts });
          continue;
        }
        // Fallback reconstruction (e.g. messages built without raw parts):
        // each functionCall carries its original thoughtSignature on the SAME
        // part, in the original order — signatures are never merged or moved.
        const parts: unknown[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.tool_calls ?? []) {
          const part: Record<string, unknown> = {
            functionCall: { name: tc.function.name, args: safeJson(tc.function.arguments) },
          };
          if (tc.thought_signature) part.thoughtSignature = tc.thought_signature;
          parts.push(part);
        }
        if (parts.length) contents.push({ role: "model", parts });
      } else if (m.role === "tool") {
        const parts: unknown[] = [
          {
            functionResponse: {
              name: m.tool_name ?? "tool",
              response: { result: m.content ?? "" },
            },
          },
        ];
        for (const img of m.images ?? []) {
          parts.push({ inline_data: { mime_type: "image/png", data: img } });
        }
        contents.push({ role: "user", parts });
      }
    }
    return { contents, system };
  }

  async chat(messages: ChatMessage[]): Promise<ChatReply> {
    const { contents, system } = this.mapContents(messages);
    const body: Record<string, unknown> = {
      contents,
      tools: [
        {
          functionDeclarations: TOOL_SCHEMAS_FOR_PROVIDER.map((t) => t.function),
        },
      ],
      generationConfig: { temperature: 0.2 },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.key)}`;
    const json = (await postJson(url, {}, body)) as {
      candidates?: {
        content?: {
          parts?: {
            text?: string;
            thought?: boolean;
            thoughtSignature?: string;
            functionCall?: { name: string; args?: Record<string, unknown> };
          }[];
        };
      }[];
      error?: { message?: string };
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    let content: string | null = null;
    const toolCalls: ToolCall[] = [];
    for (const p of parts) {
      // thoughtSignature is opaque provider metadata: keep it exactly as
      // received, on the exact part that carried it.
      const sig = typeof p.thoughtSignature === "string" && p.thoughtSignature.length > 0
        ? p.thoughtSignature
        : undefined;
      if (typeof p.text === "string" && p.text.length > 0 && p.thought !== true) {
        content = (content ?? "") + p.text;
      }
      if (p.functionCall) {
        toolCalls.push({
          id: `gem_${toolCalls.length}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args ?? {},
          // store the signature WITH this exact function call — parallel calls
          // keep only the signature Gemini put on them, never a copied one.
          ...(sig ? { thought_signature: sig } : {}),
        });
      }
    }
    // Preserve the raw parts so the next request can replay them verbatim.
    return { content, toolCalls, providerParts: parts };
  }
}

// ---------------------------------------------------------------------------
// Ollama (local)
// ---------------------------------------------------------------------------

const TOOL_CAPABLE_HINTS = [
  "llama3.1", "llama3.2", "llama4", "qwen2.5", "qwen3", "mistral-nemo",
  "command-r", "firefunction", "mixtral", "mistral-small", "mistral-large",
  "glm-4", "granite3",
];

/** Pick the most tool-capable model from an Ollama model list (first match wins). */
export function pickOllamaModel(models: { name: string }[], saved?: string): string | null {
  if (saved && models.some((m) => m.name === saved)) return saved;
  const names = models.map((m) => m.name.toLowerCase());
  for (const hint of TOOL_CAPABLE_HINTS) {
    const hit = names.find((n) => n.includes(hint));
    if (hit) return models[names.indexOf(hit)].name;
  }
  return models[0]?.name ?? null;
}

export class OllamaProvider implements Provider {
  id = "ollama";
  label = "Ollama (local)";
  private base: string;
  private model: string;

  constructor(base: string, model: string) {
    this.base = base.replace(/\/$/, "");
    this.model = model;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    const m = this.model.toLowerCase();
    return /llava|vision|llama4|minicpm-v|vl\b|qwen2.5.*vl/.test(m);
  }

  /** Known reliability hints for local models. */
  compatNote(): string | null {
    const m = this.model.toLowerCase();
    if (TOOL_CAPABLE_HINTS.some((h) => m.includes(h))) return null;
    return `"${this.model}" may not support reliable tool calling. Local models known to work reasonably: llama3.1+, qwen2.5+, mistral-nemo, command-r+. Screenshots generally need a vision model (llava, llama3.2-vision).`;
  }

  private mapMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      const entry: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
      if (m.tool_name) entry.tool_name = m.tool_name;
      if (m.tool_call_id) entry.tool_call_id = m.tool_call_id;
      const imgs = m.images ?? [];
      if (imgs.length) entry.images = imgs;
      if (m.role === "assistant" && m.tool_calls?.length) {
        entry.tool_calls = m.tool_calls.map((tc) => ({
          function: {
            name: tc.function.name,
            arguments: safeJson(tc.function.arguments),
          },
        }));
      }
      return entry;
    });
  }

  async chat(messages: ChatMessage[]): Promise<ChatReply> {
    const body = {
      model: this.model,
      messages: this.mapMessages(messages),
      stream: false,
      tools: TOOL_SCHEMAS_FOR_PROVIDER,
      options: { temperature: 0.2 },
    };
    const url = `${this.base}/api/chat`;
    let json: {
      message?: {
        content?: string;
        tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
      };
      error?: string;
    };
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text.slice(0, 300));
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `Couldn't reach Ollama at ${this.base} (${e instanceof Error ? e.message : e}). Is Ollama running (ollama serve)?`
      );
    }
    if (json.error) throw new Error(`Ollama error: ${json.error}`);
    const msg = json.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
      id: `ol_${i}`,
      name: tc.function.name,
      arguments: tc.function.arguments ?? {},
    }));
    return { content: msg?.content ?? null, toolCalls };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS_FOR_PROVIDER: ToolSchema[] = []; // filled by agent/tools.ts

export async function createProvider(
  ai: AISettings,
  getKey: (provider: string) => Promise<string | null>
): Promise<Provider> {
  const key = await getKey(ai.provider === "ollama" ? "ollama" : ai.provider);
  switch (ai.provider) {
    case "openai":
      return new OpenAICompatProvider("openai", PRESETS.openai.base, ai.model || "gpt-4o-mini", key ?? "");
    case "openrouter":
      return new OpenAICompatProvider(
        "openrouter",
        PRESETS.openrouter.base,
        ai.model || "openai/gpt-4o-mini",
        key ?? ""
      );
    case "groq":
      return new OpenAICompatProvider("groq", PRESETS.groq.base, ai.model || "llama-3.3-70b-versatile", key ?? "");
    case "gemini":
      return new GeminiProvider(ai.model || "gemini-2.0-flash", key ?? "");
    case "ollama":
      return new OllamaProvider(ai.ollama_endpoint || "http://localhost:11434", ai.model || "llama3.2");
    case "custom": {
      if (!ai.custom_endpoint) {
        throw new Error("Custom provider selected but no endpoint is set. Add it in Settings → AI.");
      }
      return new OpenAICompatProvider("custom", ai.custom_endpoint, ai.model || "default", key ?? "");
    }
    default:
      throw new Error(`Unknown provider: ${ai.provider}`);
  }
}

export function providerNeedsKey(provider: string): boolean {
  return provider !== "ollama";
}

function safeJson(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return { _raw: raw };
    }
  }
  return raw ?? {};
}
