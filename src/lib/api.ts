// Typed wrappers around every CIPHER backend command.
import { invoke } from "@tauri-apps/api/core";
import type {
  OllamaModel,
  Settings,
  ToolOutcome,
} from "./types";

export async function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  return invoke("set_setting", { key, value });
}

export async function getSecret(provider: string): Promise<string | null> {
  return invoke("get_secret", { provider });
}

export async function setSecret(provider: string, key: string): Promise<void> {
  return invoke("set_secret", { provider, key });
}

export async function deleteSecret(provider: string): Promise<void> {
  return invoke("delete_secret", { provider });
}

export async function requestToolExecution(
  tool: string,
  args: Record<string, unknown>,
  taskId: string | null
): Promise<ToolOutcome> {
  return invoke("request_tool_execution", { tool, args, taskId });
}

export async function resolvePermission(
  requestId: string,
  granted: boolean,
  alwaysAllow: boolean
): Promise<ToolOutcome> {
  return invoke("resolve_permission", { requestId, granted, alwaysAllow });
}

export async function cancelTask(taskId: string): Promise<number> {
  return invoke("cancel_task", { taskId });
}

export async function permissionRules(): Promise<
  { tool: string; risk: string; created_at: string }[]
> {
  return invoke("permission_rules");
}

export async function clearPermissionRules(): Promise<void> {
  return invoke("clear_permission_rules");
}

export async function createTask(request: string): Promise<string> {
  return invoke("create_task", { request });
}

export async function setTaskPlan(
  taskId: string,
  steps: { description: string; tool: string }[]
): Promise<void> {
  return invoke("set_task_plan", { taskId, steps });
}

export async function completeTask(
  taskId: string,
  status: string,
  report: string
): Promise<void> {
  return invoke("complete_task", { taskId, status, report });
}

export interface TaskRow {
  id: string;
  request: string;
  status: string;
  report: string | null;
  created_at: string;
}

export async function listTasks(limit = 30): Promise<TaskRow[]> {
  return invoke("list_tasks", { limit });
}

export interface ActionRow {
  id: number;
  ts: string;
  tool: string;
  risk: string;
  ok: boolean;
  summary: string;
}

export async function listActions(limit = 40): Promise<ActionRow[]> {
  return invoke("list_actions", { limit });
}

export async function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

export async function saveConversation(request: string, response: string): Promise<void> {
  return invoke("save_conversation", { request, response });
}

export async function listConversations(limit = 30): Promise<
  { id: string; request: string; response: string | null; created_at: string }[]
> {
  return invoke("list_conversations", { limit });
}

export async function clearConversations(): Promise<void> {
  return invoke("clear_conversations");
}

export async function speak(text: string): Promise<void> {
  return invoke("speak", { text });
}

export async function ollamaDetect(): Promise<{
  available: boolean;
  models?: OllamaModel[];
  error?: string;
}> {
  return invoke("ollama_detect");
}

export async function sidecarStatus(): Promise<{ browser: boolean; voice: boolean }> {
  return invoke("get_sidecar_status");
}

export async function startBrowserSidecar(): Promise<{ started: boolean; reason?: string }> {
  return invoke("start_browser_sidecar");
}

export interface SystemInfo {
  os: string;
  arch: string;
  home: string;
  hostname: string;
}

export async function systemInfo(): Promise<SystemInfo> {
  return invoke("system_info");
}

export async function setLaunchOnStartup(enabled: boolean): Promise<void> {
  return invoke("set_launch_on_startup", { enabled });
}

export async function setGlobalShortcut(shortcut: string): Promise<void> {
  return invoke("set_global_shortcut_cmd", { shortcut });
}

export async function submitPalette(text: string): Promise<void> {
  return invoke("submit_palette", { text });
}

export async function setPaused(paused: boolean): Promise<void> {
  return invoke("set_paused", { paused });
}
