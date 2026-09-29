// Unit tests for the ExecutionModeResolver.

import { describe, it, expect } from "vitest";
import { resolveExecutionMode, type ModeDeps, type ExecutionMode } from "../mode";
import type { AISettings } from "../../lib/types";

function aiSettings(patch: Partial<AISettings> = {}): AISettings {
  return {
    provider: "openrouter",
    model: "",
    custom_endpoint: "",
    ollama_endpoint: "http://localhost:11434",
    stt_provider: "openai",
    stt_model: "whisper-1",
    stt_custom_endpoint: "",
    tts_mode: "off",
    ...patch,
  };
}

function deps(opts: {
  keys: Record<string, boolean>;
  ollama?: { available: boolean; models?: { name: string }[] };
}): ModeDeps {
  return {
    hasKey: async (p) => opts.keys[p] ?? false,
    ollamaDetect: async () =>
      opts.ollama ?? { available: false, error: "not reachable" },
  };
}

describe("resolveExecutionMode", () => {
  it("valid Gemini key → CloudAi (Gemini)", async () => {
    const mode = await resolveExecutionMode(
      aiSettings({ provider: "gemini", model: "gemini-3-pro" }),
      deps({ keys: { gemini: true } })
    );
    expect(mode).toEqual({
      kind: "cloud",
      provider: "gemini",
      label: "Gemini",
      model: "gemini-3-pro",
    });
  });

  it("no Gemini key + Ollama available → LocalAi with a tool-capable model", async () => {
    const mode: ExecutionMode = await resolveExecutionMode(
      aiSettings({ provider: "gemini" }),
      deps({
        keys: {},
        ollama: { available: true, models: [{ name: "qwen2.5:7b" }, { name: "minicpm-v" }] },
      })
    );
    expect(mode.kind).toBe("local-ai");
    if (mode.kind === "local-ai") {
      expect(mode.model).toBe("qwen2.5:7b");
      expect(mode.endpoint).toBe("http://localhost:11434");
    }
  });

  it("no provider + no Ollama → LocalCommands", async () => {
    const mode = await resolveExecutionMode(aiSettings(), deps({ keys: {} }));
    expect(mode).toEqual({ kind: "local-commands" });
  });

  it("cloud key wins over Ollama when both exist", async () => {
    const mode = await resolveExecutionMode(
      aiSettings({ provider: "openai" }),
      deps({ keys: { openai: true }, ollama: { available: true, models: [{ name: "llama3.2" }] } })
    );
    expect(mode.kind).toBe("cloud");
  });

  it("Ollama selected with a saved model → that exact model is used", async () => {
    const mode = await resolveExecutionMode(
      aiSettings({ provider: "ollama", model: "llama3.1:8b" }),
      deps({
        keys: {},
        ollama: { available: true, models: [{ name: "llama3.1:8b" }, { name: "qwen2.5:7b" }] },
      })
    );
    expect(mode.kind).toBe("local-ai");
    if (mode.kind === "local-ai") expect(mode.model).toBe("llama3.1:8b");
  });

  it("Ollama up but zero models → LocalCommands (not a broken LocalAi)", async () => {
    const mode = await resolveExecutionMode(
      aiSettings({ provider: "ollama", model: "" }),
      deps({ keys: {}, ollama: { available: true, models: [] } })
    );
    expect(mode).toEqual({ kind: "local-commands" });
  });

  it("key lookup errors degrade gracefully to Ollama/local", async () => {
    const mode = await resolveExecutionMode(aiSettings({ provider: "groq" }), {
      hasKey: async () => {
        throw new Error("credential manager exploded");
      },
      ollamaDetect: async () => ({ available: false }),
    });
    expect(mode).toEqual({ kind: "local-commands" });
  });
});
