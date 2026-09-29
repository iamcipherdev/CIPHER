// Resolves and tracks the current execution mode so the UI can show an
// honest status indicator and adapt the input placeholder — without ever
// blocking the Agent screen.
import { useEffect, useState } from "react";
import * as api from "../lib/api";
import {
  modeStatusLabel,
  resolveExecutionMode,
  type ExecutionMode,
  type ModeDeps,
} from "../agent/mode";
import { useStore } from "../stores/store";

const tauriModeDeps: ModeDeps = {
  hasKey: async (p) => !!(await api.getSecret(p).catch(() => null)),
  ollamaDetect: () => api.ollamaDetect(),
};

export interface ModeStatus {
  mode: ExecutionMode | null;
  label: string;
  tone: "green" | "blue" | "amber";
  refresh: () => void;
}

let detectCache: { at: number; value: Awaited<ReturnType<typeof api.ollamaDetect>> } | null = null;

/** Cached Ollama probe so multiple consumers don't hammer localhost:11434. */
async function cachedOllamaDetect(): Promise<Awaited<ReturnType<typeof api.ollamaDetect>>> {
  const now = Date.now();
  if (detectCache && now - detectCache.at < 45_000) return detectCache.value;
  const value = await api.ollamaDetect().catch(() => ({ available: false }));
  detectCache = { at: now, value };
  return value;
}

export function useExecutionMode(): ModeStatus {
  const ai = useStore((s) => s.settings.ai);
  const settingsLoaded = useStore((s) => s.settingsLoaded);
  const hasKey = useStore((s) => s.hasKey);
  const [mode, setMode] = useState<ExecutionMode | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = () => {
    detectCache = null;
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!settingsLoaded) return;
    let alive = true;
    resolveExecutionMode(ai, {
      hasKey: tauriModeDeps.hasKey,
      ollamaDetect: cachedOllamaDetect,
    })
      .then((m) => {
        if (alive) setMode(m);
      })
      .catch(() => {
        if (alive) setMode({ kind: "local-commands" });
      });
    return () => {
      alive = false;
    };
  }, [ai, settingsLoaded, hasKey, tick]);

  const status = mode ? modeStatusLabel(mode) : { text: "Resolving…", tone: "amber" as const };
  return { mode, label: status.text, tone: status.tone, refresh };
}
