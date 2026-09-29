// Single zustand store for the whole app.
import { create } from "zustand";
import type {
  ActivityEntry,
  OrbState,
  PendingPermission,
  PlanStep,
  Settings,
  ToolResult,
} from "../lib/types";
import * as api from "../lib/api";

export const DEFAULT_SETTINGS: Settings = {
  general: {
    launch_on_startup: false,
    minimize_to_tray: true,
    global_shortcut: "ctrl+space",
    theme: "dark",
  },
  ai: {
    provider: "openrouter",
    model: "",
    custom_endpoint: "",
    ollama_endpoint: "http://localhost:11434",
    stt_provider: "openai",
    stt_model: "whisper-1",
    stt_custom_endpoint: "",
    tts_mode: "important",
  },
  voice: {
    microphone: "default",
    wake_word: false,
    wake_word_local_only: true,
  },
  desktop: {
    file_access: true,
    app_control: true,
    terminal_access: true,
    screenshot_access: true,
    clipboard_access: true,
  },
  security: {
    auto_run_safe: true,
    confirm_medium: true,
    show_terminal_commands: true,
    always_confirm_destructive: true,
  },
  privacy: {
    disable_screenshot_analysis: false,
    disable_clipboard: false,
    disable_voice: false,
  },
  onboarded: false,
};

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export interface ActiveTask {
  id: string;
  request: string;
  status: "running" | "done" | "failed" | "cancelled";
  report: string | null;
}

interface Store {
  screen: "main" | "settings";
  settings: Settings;
  settingsLoaded: boolean;
  orb: OrbState;
  busy: boolean;
  activeTask: ActiveTask | null;
  planSteps: PlanStep[];
  activity: ActivityEntry[];
  pendingPermission: PendingPermission | null;
  paused: boolean;
  toasts: Toast[];
  abort: AbortController | null;
  hasKey: Record<string, boolean>;

  setScreen: (s: "main" | "settings") => void;
  loadSettings: () => Promise<void>;
  updateSettings: <K extends keyof Omit<Settings, "onboarded">>(
    section: K,
    patch: Partial<Settings[K]>
  ) => void;
  setOrb: (o: OrbState) => void;
  setBusy: (b: boolean) => void;
  startTask: (id: string, request: string) => void;
  setPlan: (steps: { description: string; tool: string }[]) => void;
  markStep: (tool: string, ok: boolean) => void;
  finishTask: (status: ActiveTask["status"], report: string | null) => void;
  pushActivity: (entry: ActivityEntry) => void;
  setPendingPermission: (p: PendingPermission | null) => void;
  resolvePermission: (granted: boolean, always_allow: boolean) => void;
  setPaused: (p: boolean) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
  setAbort: (a: AbortController | null) => void;
  requestCancel: () => void;
  setHasKey: (provider: string, present: boolean) => void;
}

let toastId = 0;

export const useStore = create<Store>((set, get) => ({
  screen: "main",
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  orb: "idle",
  busy: false,
  activeTask: null,
  planSteps: [],
  activity: [],
  pendingPermission: null,
  paused: false,
  toasts: [],
  abort: null,
  hasKey: {},

  setScreen: (screen) => set({ screen }),

  loadSettings: async () => {
    try {
      const s = await api.getSettings();
      set({
        settings: {
          ...DEFAULT_SETTINGS,
          ...s,
          general: { ...DEFAULT_SETTINGS.general, ...s.general },
          ai: { ...DEFAULT_SETTINGS.ai, ...s.ai },
          voice: { ...DEFAULT_SETTINGS.voice, ...s.voice },
          desktop: { ...DEFAULT_SETTINGS.desktop, ...s.desktop },
          security: { ...DEFAULT_SETTINGS.security, ...s.security },
          privacy: { ...DEFAULT_SETTINGS.privacy, ...s.privacy },
        },
        settingsLoaded: true,
      });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  updateSettings: (section, patch) => {
    const current = get().settings;
    const next = { ...current, [section]: { ...current[section], ...patch } };
    set({ settings: next });
    api.setSetting(section as string, next[section]).catch(() => {
      get().toast("error", "Couldn't save the setting.");
    });
  },

  setOrb: (orb) => set({ orb }),
  setBusy: (busy) => set({ busy }),

  startTask: (id, request) =>
    set({
      activeTask: { id, request, status: "running", report: null },
      planSteps: [],
    }),

  setPlan: (steps) => {
    set({
      planSteps: steps.map((s) => ({ ...s, status: "pending" })),
    });
    if (get().activeTask) {
      api.setTaskPlan(get().activeTask!.id, steps).catch(() => {});
    }
  },

  markStep: (tool, ok) => {
    const steps = [...get().planSteps];
    const idx = steps.findIndex((s) => s.tool === tool && s.status === "pending");
    const target = idx >= 0 ? idx : steps.findIndex((s) => s.status === "pending");
    if (target >= 0) {
      steps[target] = {
        ...steps[target],
        status: ok ? "done" : "failed",
      };
      set({ planSteps: steps });
    }
  },

  finishTask: (status, report) =>
    set({
      activeTask: get().activeTask
        ? { ...get().activeTask!, status, report }
        : null,
      busy: false,
    }),

  pushActivity: (entry) =>
    set((s) => ({ activity: [entry, ...s.activity].slice(0, 80) })),

  setPendingPermission: (p) => set({ pendingPermission: p }),

  resolvePermission: (granted, always_allow) => {
    const pending = get().pendingPermission;
    if (!pending) return;
    set({ pendingPermission: null });
    pending.resolve({ granted, always_allow });
  },

  setPaused: (paused) => set({ paused }),

  toast: (kind, text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 6000);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setAbort: (abort) => set({ abort }),

  requestCancel: () => {
    const task = get().activeTask;
    const abort = get().abort;
    if (abort) abort.abort();
    if (task) {
      api.cancelTask(task.id).catch(() => {});
    }
    set({ pendingPermission: null });
  },

  setHasKey: (provider, present) =>
    set((s) => ({ hasKey: { ...s.hasKey, [provider]: present } })),
}));

export function describeResult(r: ToolResult): string {
  const bits: string[] = [];
  if (r.evidence) bits.push(r.evidence);
  else if (r.error) bits.push(r.error);
  return bits.join(" · ");
}
