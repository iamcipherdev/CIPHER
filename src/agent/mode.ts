// ExecutionModeResolver — decides HOW a request is handled before anything
// runs. CIPHER must never become unusable just because no cloud API key is
// configured, so resolution falls through:
//
//   1. CloudAi        — the selected cloud provider has a key
//   2. LocalAi        — a local Ollama server with at least one model is up
//   3. LocalCommands  — a deterministic, no-LLM command router
//
// LocalCommands still goes through the same permission engine, risk
// classifier, executor and activity log as AI-driven calls. It never pretends
// to be an LLM and never interprets ambiguous or destructive requests.

import type { AISettings } from "../lib/types";
import { pickOllamaModel } from "./providers";

export type ExecutionMode =
  | { kind: "cloud"; provider: string; label: string; model: string }
  | { kind: "local-ai"; endpoint: string; model: string }
  | { kind: "local-commands" };

/** Providers that need a cloud API key. */
export const CLOUD_PROVIDERS = ["openrouter", "openai", "gemini", "groq", "custom"];

/** Injected so the resolver stays unit-testable without Tauri. */
export interface ModeDeps {
  hasKey(provider: string): Promise<boolean>;
  ollamaDetect(): Promise<{ available: boolean; models?: { name: string }[] }>;
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  groq: "Groq",
  ollama: "Ollama",
  custom: "Custom AI",
};

export function providerLabel(ai: AISettings): string {
  if (ai.provider === "custom") return "Custom AI";
  return PROVIDER_LABELS[ai.provider] ?? ai.provider;
}

export async function resolveExecutionMode(
  ai: AISettings,
  deps: ModeDeps
): Promise<ExecutionMode> {
  // 1) a configured cloud provider with a stored key wins
  if (CLOUD_PROVIDERS.includes(ai.provider)) {
    try {
      if (await deps.hasKey(ai.provider)) {
        return {
          kind: "cloud",
          provider: ai.provider,
          label: providerLabel(ai),
          model: ai.model || defaultModel(ai.provider),
        };
      }
    } catch {
      // key lookup failed — fall through to local options
    }
  }

  // 2) local Ollama, auto-detected even when another provider is selected
  try {
    const det = await deps.ollamaDetect();
    if (det.available && det.models?.length) {
      const saved = ai.provider === "ollama" ? ai.model || undefined : undefined;
      const model = pickOllamaModel(det.models, saved);
      if (model) {
        return {
          kind: "local-ai",
          endpoint: ai.ollama_endpoint || "http://localhost:11434",
          model,
        };
      }
    }
  } catch {
    // detection failed (no server) — fall through
  }

  // 3) deterministic local commands — always available, no key required
  return { kind: "local-commands" };
}

export function defaultModel(provider: string): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "openrouter":
      return "openai/gpt-4o-mini";
    case "gemini":
      return "gemini-2.0-flash";
    case "groq":
      return "llama-3.3-70b-versatile";
    default:
      return "default";
  }
}

/** Human-facing status for the footer: "Gemini • Connected" etc. */
export function modeStatusLabel(mode: ExecutionMode): { text: string; tone: "green" | "blue" | "amber" } {
  switch (mode.kind) {
    case "cloud":
      return { text: `${mode.label} • Connected`, tone: "green" };
    case "local-ai":
      return { text: `Ollama • Local (${mode.model})`, tone: "blue" };
    case "local-commands":
      return { text: "Local Commands • Offline", tone: "amber" };
  }
}
