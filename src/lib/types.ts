// Shared types across the CIPHER frontend.

export type OrbState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "planning"
  | "executing"
  | "waiting"
  | "speaking"
  | "success"
  | "error";

export type Risk = "safe" | "medium" | "high";

export interface ToolResult {
  ok: boolean;
  tool: string;
  risk: Risk;
  data: Record<string, unknown>;
  error: string | null;
  verified: boolean | null;
  evidence: string | null;
  duration_ms: number;
}

export type ToolOutcome =
  | { status: "executed"; result: ToolResult }
  | {
      status: "permission_required";
      request_id: string;
      tool: string;
      risk: Risk;
      summary: string;
      params: Record<string, unknown>;
      allow_always: boolean;
    };

export interface PlanStep {
  description: string;
  tool: string;
  status: "pending" | "running" | "done" | "failed";
}

export interface ActivityEntry {
  id?: number;
  ts: string;
  tool: string;
  risk: string;
  ok: boolean;
  summary: string;
  kind?: "action" | "user" | "report";
}

export interface PendingPermission {
  request_id: string;
  tool: string;
  risk: Risk;
  summary: string;
  params: Record<string, unknown>;
  allow_always: boolean;
  resolve: (decision: { granted: boolean; always_allow: boolean }) => void;
}

export interface GeneralSettings {
  launch_on_startup: boolean;
  minimize_to_tray: boolean;
  global_shortcut: string;
  theme: string;
}

export interface AISettings {
  provider: "openrouter" | "openai" | "gemini" | "groq" | "ollama" | "custom";
  model: string;
  custom_endpoint: string;
  ollama_endpoint: string;
  stt_provider: "openai" | "groq" | "local" | "custom";
  stt_model: string;
  stt_custom_endpoint: string;
  tts_mode: "off" | "important" | "all";
}

export interface VoiceSettings {
  microphone: string;
  wake_word: boolean;
  wake_word_local_only: boolean;
}

export interface DesktopSettings {
  file_access: boolean;
  app_control: boolean;
  terminal_access: boolean;
  screenshot_access: boolean;
  clipboard_access: boolean;
}

export interface SecuritySettings {
  auto_run_safe: boolean;
  confirm_medium: boolean;
  show_terminal_commands: boolean;
  always_confirm_destructive: boolean;
}

export interface PrivacySettings {
  disable_screenshot_analysis: boolean;
  disable_clipboard: boolean;
  disable_voice: boolean;
}

export interface Settings {
  general: GeneralSettings;
  ai: AISettings;
  voice: VoiceSettings;
  desktop: DesktopSettings;
  security: SecuritySettings;
  privacy: PrivacySettings;
  onboarded: boolean;
}

export interface OllamaModel {
  name: string;
  parameter_size: string | null;
  family: string | null;
}
