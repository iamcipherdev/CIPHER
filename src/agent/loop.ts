// The CIPHER agent loop:
// understand → plan → permission → execute → observe → verify → next → report
//
// The AI only ever emits structured tool calls against src/agent/tools.ts.
// Every execution goes through the Rust permission engine before it touches
// the operating system. Limits: 20 tool calls per task, 2 retries per action.
//
// Execution modes (resolved before anything runs):
//   CloudAi       — configured cloud provider with a stored key
//   LocalAi       — auto-detected Ollama server, no cloud key needed
//   LocalCommands — deterministic direct commands, still permission-checked
// A failed cloud call can fall back to LocalCommands when the request is a
// simple, safely-recognizable direct command.

import { useStore } from "../stores/store";
import * as api from "../lib/api";
import { systemPrompt, wrapExternal } from "./prompts";
import { EXTERNAL_TOOLS } from "./tools";
import {
  createProvider,
  OllamaProvider,
  type ChatMessage,
  type ChatReply,
  type Provider,
  type ToolCall,
} from "./providers";
import { resolveExecutionMode, type ModeDeps } from "./mode";
import {
  routeLocalCommand,
  formatLocalResult,
  NEEDS_AI_MESSAGE,
  type LocalIntent,
  type FolderKey,
} from "./localRouter";
import { speakIfEnabled } from "../lib/tts";

const MAX_TOOL_CALLS = 20;
const MAX_RETRIES = 2;

class Cancelled extends Error {}

/** Tauri-backed resolver dependencies. */
const tauriModeDeps: ModeDeps = {
  hasKey: async (p) => !!(await api.getSecret(p).catch(() => null)),
  ollamaDetect: () => api.ollamaDetect(),
};

export async function runAgent(request: string): Promise<void> {
  const store = useStore.getState();
  if (store.busy) {
    store.toast("info", "CIPHER is already working on a task. Press STOP first.");
    return;
  }

  // Resolve the execution mode FIRST. A missing cloud key must never block
  // the Agent screen — CIPHER degrades to Ollama or to direct local commands.
  const mode = await resolveExecutionMode(store.settings.ai, tauriModeDeps);

  if (mode.kind === "local-commands") {
    const route = routeLocalCommand(request);
    if (route.kind === "needs_ai") {
      await reportWithoutTask(request, NEEDS_AI_MESSAGE(request), {
        toast: "info",
        toastText: "That request needs an AI model. CIPHER can still run direct local commands.",
      });
      return;
    }
    if (route.kind === "refused") {
      await reportWithoutTask(request, route.reason, {
        toast: "info",
        toastText: "CIPHER won't run destructive or ambiguous commands without an AI plan.",
      });
      return;
    }
    await runLocalIntentFlow(request, route.intent);
    return;
  }

  // ---------------------------------------------------------------- AI modes
  const abort = new AbortController();
  store.setAbort(abort);
  store.setBusy(true);
  store.pushActivity({
    ts: nowTime(),
    tool: "user",
    risk: "safe",
    ok: true,
    summary: request,
    kind: "user",
  });

  let taskId: string | null = null;
  try {
    taskId = await api.createTask(request);
    store.startTask(taskId, request);
  } catch {
    store.toast("error", "Couldn't create the local task record.");
  }

  try {
    let provider: Provider;
    if (mode.kind === "local-ai") {
      provider = new OllamaProvider(mode.endpoint, mode.model);
      store.toast("info", `Using local AI: Ollama · ${mode.model}`);
    } else {
      const key = await api.getSecret(mode.provider).catch(() => null);
      if (!key) {
        // The resolver only routes here with a key; this is a hard failsafe.
        const route = routeLocalCommand(request);
        if (route.kind === "intent") {
          store.toast("info", "No AI key available — executed this direct command locally.");
          await runLocalIntentCore(route.intent, taskId, abort);
          return;
        }
        await reportExistingTask(taskId, NEEDS_AI_MESSAGE(request), "failed");
        store.toast("error", `No API key for ${mode.provider}. Add it in Settings → AI, or keep typing direct commands.`);
        return;
      }
      provider = await createProvider(store.settings.ai, async (p) =>
        p === mode.provider ? key : api.getSecret(p).catch(() => null)
      );
    }

    const note = (provider as { compatNote?: () => string | null }).compatNote?.();
    if (note) store.toast("info", note);

    const info = await api.systemInfo().catch(() => null);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(info) },
      { role: "user", content: request },
    ];

    const toolCallCounts = new Map<string, number>();
    let totalToolCalls = 0;
    let finalReport: string | null = null;
    let finalSuccess = true;

    // ------------------------------------------------------------- main loop
    while (true) {
      if (abort.signal.aborted) throw new Cancelled();
      if (useStore.getState().paused) {
        throw new Cancelled();
      }

      store.setOrb("thinking");
      let reply: ChatReply;
      try {
        reply = await withAbort(abort.signal, provider.chat(messages));
      } catch (e) {
        // Provider outage fallback: if the provider failed AND this exact
        // request is a simple direct command, run it locally instead of
        // dying. Complex natural-language tasks are NOT silently faked.
        if (e instanceof Cancelled) throw e;
        const route = routeLocalCommand(request);
        if (route.kind === "intent") {
          const label = (provider as { label?: string }).label ?? "The AI provider";
          const note = `${label} is unavailable — executed this direct command locally.`;
          store.toast("info", note);
          store.pushActivity({
            ts: nowTime(),
            tool: "report",
            risk: "safe",
            ok: true,
            summary: note,
            kind: "report",
          });
          await runLocalIntentCore(route.intent, taskId, abort);
          return;
        }
        throw e;
      }

      if (!reply.toolCalls.length) {
        finalReport = reply.content ?? "Task finished.";
        break;
      }

      // assistant message with tool calls — Gemini thought signatures and raw
      // parts ride along so the next request can replay them exactly.
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

      for (const tc of reply.toolCalls) {
        if (abort.signal.aborted) throw new Cancelled();

        // ---- local plan tool
        if (tc.name === "create_plan") {
          const steps = (tc.arguments.steps as { description: string; tool: string }[] | undefined) ?? [];
          store.setOrb("planning");
          store.setPlan(steps.slice(0, 8));
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            tool_name: tc.name,
            content: "Plan recorded. Now execute it step by step.",
          });
          continue;
        }

        // ---- final report
        if (tc.name === "report_result") {
          finalReport = String(tc.arguments.summary ?? "Task finished.");
          finalSuccess = tc.arguments.success !== false;
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            tool_name: tc.name,
            content: "Report recorded. Task complete.",
          });
          continue;
        }

        // ---- limits
        if (totalToolCalls >= MAX_TOOL_CALLS) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            tool_name: tc.name,
            content:
              "Tool call limit (20) reached for this task. Stop and report what was accomplished and what remains.",
          });
          continue;
        }
        totalToolCalls += 1;

        // ---- execute with permission flow
        store.setOrb("executing");
        const result = await executeToolWithPermission(tc, taskId, abort);

        // retry bookkeeping
        const failKey = `${tc.name}:${JSON.stringify(tc.arguments).slice(0, 80)}`;
        const fails = (toolCallCounts.get(failKey) ?? 0) + (result.ok ? 0 : 1);
        toolCallCounts.set(failKey, fails);

        // observation → message
        const dataText = JSON.stringify(stripImages(result.data));
        const contentText = result.ok
          ? dataText
          : `ERROR: ${result.error ?? "unknown failure"}\n\n(attempt ${fails}/${MAX_RETRIES + 1})`;
        const wrapped = EXTERNAL_TOOLS.has(tc.name)
          ? wrapExternal(tc.name, contentText)
          : contentText;
        const msg: ChatMessage = {
          role: "tool",
          tool_call_id: tc.id,
          tool_name: tc.name,
          content: `verified=${result.verified ?? "unknown"} ${result.evidence ? `| ${result.evidence}` : ""}\n${wrapped}`,
        };
        if (result.data.image_base64 && typeof result.data.image_base64 === "string") {
          msg.images = [result.data.image_base64 as string];
        }
        messages.push(msg);

        // UI: step + activity + verification note
        store.markStep(tc.name, result.ok);
        store.pushActivity({
          ts: nowTime(),
          tool: tc.name,
          risk: result.risk,
          ok: result.ok,
          summary:
            result.error ??
            (result.evidence
              ? `${result.evidence}`
              : dataText.slice(0, 120)),
          kind: "action",
        });

        if (!result.ok && fails > MAX_RETRIES) {
          messages.push({
            role: "system",
            content: `The action "${tc.name}" failed ${fails} times. Do NOT retry it again — choose a different approach or continue with the rest of the task, and mention the failure in the final report.`,
          });
        }

        if (store.settings.ai.tts_mode === "all" && result.ok && result.verified) {
          void speakIfEnabled(`Done: ${stepPhrase(tc.name)}`, "step");
        }
        store.setOrb("thinking");
      }

      if (finalReport) break;
    }

    // ------------------------------------------------------------- finish
    const report = (finalReport ?? "Task finished.").trim();
    store.setOrb(finalSuccess ? "success" : "error");
    store.finishTask(finalSuccess ? "done" : "failed", report);
    store.pushActivity({
      ts: nowTime(),
      tool: "report",
      risk: "safe",
      ok: finalSuccess,
      summary: report,
      kind: "report",
    });
    if (taskId) {
      await api
        .completeTask(taskId, finalSuccess ? "done" : "failed", report)
        .catch(() => {});
      await api.saveConversation(request, report).catch(() => {});
    }
    await speakIfEnabled(report, "final");
  } catch (e) {
    await handleAgentError(e, taskId);
  } finally {
    store.setAbort(null);
    store.setBusy(false);
    setTimeout(() => {
      if (useStore.getState().orb !== "idle" && !useStore.getState().busy) {
        useStore.getState().setOrb("idle");
      }
    }, 2600);
  }
}

// ---------------------------------------------------------------------------
// Local command mode
// ---------------------------------------------------------------------------

interface LocalToolResult {
  tool: string;
  ok: boolean;
  error: string | null;
  data: Record<string, unknown>;
  evidence: string | null;
  risk: string;
}

/** Execute a local intent's tool calls through the normal permission engine. */
async function runLocalIntentCore(
  intent: LocalIntent,
  taskId: string | null,
  abort: AbortController
): Promise<void> {
  const store = useStore.getState();
  store.setOrb("thinking");
  store.setPlan([planStepFor(intent)]);

  const results = await executeLocalIntent(intent, taskId, abort);
  const last = results[results.length - 1];
  const ok = last?.ok ?? false;
  const report = formatLocalResult(intent, results);

  store.markStep(planStepFor(intent).tool, ok);
  store.setOrb(ok ? "success" : "error");
  store.finishTask(ok ? "done" : "failed", report);
  store.pushActivity({
    ts: nowTime(),
    tool: "report",
    risk: "safe",
    ok,
    summary: report,
    kind: "report",
  });
  if (taskId) {
    await api.completeTask(taskId, ok ? "done" : "failed", report).catch(() => {});
    await api.saveConversation(requestOf(intent), report).catch(() => {});
  }
  await speakIfEnabled(report, "final");
}

/** Full standalone flow for a local intent (busy/abort/task bookkeeping). */
async function runLocalIntentFlow(request: string, intent: LocalIntent): Promise<void> {
  const store = useStore.getState();
  const abort = new AbortController();
  store.setAbort(abort);
  store.setBusy(true);
  store.pushActivity({
    ts: nowTime(),
    tool: "user",
    risk: "safe",
    ok: true,
    summary: request,
    kind: "user",
  });

  let taskId: string | null = null;
  try {
    taskId = await api.createTask(request);
    store.startTask(taskId, request);
  } catch {
    store.toast("error", "Couldn't create the local task record.");
  }

  try {
    await runLocalIntentCore(intent, taskId, abort);
  } catch (e) {
    await handleAgentError(e, taskId);
  } finally {
    store.setAbort(null);
    store.setBusy(false);
    setTimeout(() => {
      if (useStore.getState().orb !== "idle" && !useStore.getState().busy) {
        useStore.getState().setOrb("idle");
      }
    }, 2600);
  }
}

async function executeLocalIntent(
  intent: LocalIntent,
  taskId: string | null,
  abort: AbortController
): Promise<LocalToolResult[]> {
  const out: LocalToolResult[] = [];

  if (intent.kind === "open_app") {
    // Deterministic disambiguation: discover installed matches through the
    // SAME safe tool the AI uses. Multiple distinct matches → ask, don't guess.
    const find = await executeToolWithPermission(
      { id: "local_find", name: "find_installed_app", arguments: { app: intent.app } },
      taskId,
      abort
    );
    out.push(toLocal(find));
    if (find.ok) {
      const stems = distinctStems(find.data.matches);
      if (stems.length > 1) {
        return [...out, {
          tool: "find_installed_app",
          ok: true,
          error: null,
          evidence: null,
          risk: "safe",
          data: { choices: stems },
        }];
      }
      if (stems.length === 1) {
        const res = await executeToolWithPermission(
          { id: "local_open", name: "open_app", arguments: { app: stems[0] } },
          taskId,
          abort
        );
        return [...out, toLocal(res)];
      }
    }
    // No discovery results — let open_app do its own (broader) search and
    // report honestly if nothing is installed.
    const res = await executeToolWithPermission(
      { id: "local_open", name: "open_app", arguments: { app: intent.app } },
      taskId,
      abort
    );
    return [...out, toLocal(res)];
  }

  const t = simpleToolFor(intent);
  const res = await executeToolWithPermission(
    { id: "local_cmd", name: t.tool, arguments: t.args },
    taskId,
    abort
  );
  return [toLocal(res)];
}

function simpleToolFor(intent: LocalIntent): { tool: string; args: Record<string, unknown> } {
  switch (intent.kind) {
    case "open_folder":
      return { tool: "open_file", args: { path: folderPath(intent.folder) } };
    case "system_info":
      return { tool: "get_system_info", args: {} };
    case "memory_info":
      return { tool: "get_memory_info", args: {} };
    case "disk_info":
      return { tool: "get_disk_info", args: {} };
    case "battery_info":
      return { tool: "get_battery_info", args: {} };
    case "running_apps":
      return { tool: "list_running_apps", args: {} };
    case "windows_settings":
      return { tool: "open_windows_settings", args: {} };
    case "open_app":
      return { tool: "open_app", args: { app: intent.app } };
  }
}

function planStepFor(intent: LocalIntent): { description: string; tool: string } {
  switch (intent.kind) {
    case "open_app":
      return { description: `Find and open ${intent.display}`, tool: "open_app" };
    case "open_folder":
      return { description: `Open the ${intent.display} folder`, tool: "open_file" };
    case "system_info":
      return { description: "Read system information", tool: "get_system_info" };
    case "memory_info":
      return { description: "Read memory usage", tool: "get_memory_info" };
    case "disk_info":
      return { description: "Read disk usage", tool: "get_disk_info" };
    case "battery_info":
      return { description: "Read battery status", tool: "get_battery_info" };
    case "running_apps":
      return { description: "List running applications", tool: "list_running_apps" };
    case "windows_settings":
      return { description: "Open Windows Settings", tool: "open_windows_settings" };
  }
}

function folderPath(f: FolderKey): string {
  const map: Record<FolderKey, string> = {
    downloads: "%USERPROFILE%\\Downloads",
    documents: "%USERPROFILE%\\Documents",
    pictures: "%USERPROFILE%\\Pictures",
    music: "%USERPROFILE%\\Music",
    videos: "%USERPROFILE%\\Videos",
    desktop: "%USERPROFILE%\\Desktop",
  };
  return map[f];
}

function toLocal(r: Awaited<ReturnType<typeof executeToolWithPermission>>): LocalToolResult {
  return {
    tool: r.tool,
    ok: r.ok,
    error: r.error,
    data: r.data,
    evidence: r.evidence,
    risk: r.risk,
  };
}

/** Distinct human-readable app names from find_installed_app matches. */
function distinctStems(matches: unknown): string[] {
  if (!Array.isArray(matches)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const p = String(m);
    const file = p.split(/[\\/]/).pop() ?? p;
    const stem = file.replace(/\.(lnk|exe|url)$/i, "").replace(/[_-]+/g, " ").trim();
    if (!stem) continue;
    const key = stem.toLowerCase().replace(/\s+/g, "");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(stem);
    }
    if (out.length >= 6) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Record a request + report pair without executing tools (NeedsAI/refusals). */
async function reportWithoutTask(
  request: string,
  report: string,
  opts: { toast?: string; toastText?: string }
): Promise<void> {
  const store = useStore.getState();
  store.pushActivity({
    ts: nowTime(),
    tool: "user",
    risk: "safe",
    ok: true,
    summary: request,
    kind: "user",
  });
  store.pushActivity({
    ts: nowTime(),
    tool: "report",
    risk: "safe",
    ok: true,
    summary: report,
    kind: "report",
  });
  if (opts.toast && opts.toastText) store.toast("info", opts.toastText);
  let taskId: string | null = null;
  try {
    taskId = await api.createTask(request);
  } catch {
    /* local record is best-effort */
  }
  await reportExistingTask(taskId, report, "done");
  await speakIfEnabled(report, "final");
}

async function reportExistingTask(
  taskId: string | null,
  report: string,
  status: "done" | "failed"
): Promise<void> {
  const store = useStore.getState();
  if (taskId) {
    await api.completeTask(taskId, status, report).catch(() => {});
    await api.saveConversation(report.slice(0, 60), report).catch(() => {});
  }
  store.finishTask(status, report);
}

async function handleAgentError(e: unknown, taskId: string | null): Promise<void> {
  const store = useStore.getState();
  if (e instanceof Cancelled || (e instanceof Error && e.name === "AbortError")) {
    store.setOrb("idle");
    store.finishTask("cancelled", null);
    store.pushActivity({
      ts: nowTime(),
      tool: "control",
      risk: "safe",
      ok: true,
      summary: "Task cancelled by the user.",
      kind: "report",
    });
    if (taskId) {
      await api.completeTask(taskId, "cancelled", "Cancelled by the user.").catch(() => {});
    }
  } else {
    const friendly = friendlyError(e);
    store.setOrb("error");
    store.finishTask("failed", friendly);
    store.pushActivity({
      ts: nowTime(),
      tool: "error",
      risk: "safe",
      ok: false,
      summary: friendly,
      kind: "report",
    });
    store.toast("error", friendly);
    if (taskId) {
      await api.completeTask(taskId, "failed", friendly).catch(() => {});
    }
  }
}

async function executeToolWithPermission(
  tc: ToolCall,
  taskId: string | null,
  abort: AbortController
) {
  const store = useStore.getState();
  const outcome = await withAbort(
    abort.signal,
    api.requestToolExecution(tc.name, tc.arguments, taskId)
  );

  if (outcome.status === "permission_required") {
    store.setOrb("waiting");
    const decision = await new Promise<{ granted: boolean; always_allow: boolean }>(
      (resolve) => {
        store.setPendingPermission({
          ...outcome,
          resolve: (d: { granted: boolean; always_allow: boolean }) => resolve(d),
        } as never);
      }
    );
    if (!decision.granted) {
      return {
        ok: false,
        tool: tc.name,
        risk: outcome.risk,
        data: {},
        error: "Permission denied by the user.",
        verified: false,
        evidence: null,
        duration_ms: 0,
      };
    }
    const resolved = await withAbort(
      abort.signal,
      api.resolvePermission(outcome.request_id, true, decision.always_allow)
    );
    if (resolved.status === "executed") return resolved.result;
    return {
      ok: false,
      tool: tc.name,
      risk: outcome.risk,
      data: {},
      error: "Unexpected permission state.",
      verified: false,
      evidence: null,
      duration_ms: 0,
    };
  }

  return outcome.result;
}

function requestOf(intent: LocalIntent): string {
  switch (intent.kind) {
    case "open_app":
      return `open ${intent.display.toLowerCase()}`;
    case "open_folder":
      return `open ${intent.display.toLowerCase()}`;
    default:
      return planStepFor(intent).description.toLowerCase();
  }
}

async function withAbort<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  if (signal.aborted) throw new Cancelled();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((v) => resolve(v))
      .catch((e) => reject(e))
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function stripImages(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };
  if ("image_base64" in clone) {
    clone.image_base64 = "[image attached]";
  }
  return clone;
}

function stepPhrase(tool: string): string {
  const map: Record<string, string> = {
    open_app: "Application opened",
    close_app: "Application closed",
    focus_app: "Window focused",
    create_folder: "Folder created",
    move_file: "File moved",
    copy_file: "File copied",
    run_powershell: "Command executed",
    browser_navigate: "Page loaded",
  };
  return map[tool] ?? tool.replace(/_/g, " ");
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("401") || msg.includes("403")) {
    return "The AI provider rejected the API key. Check Settings → AI.";
  }
  if (msg.includes("429")) {
    return "The AI provider rate limit was hit. Wait a moment and retry.";
  }
  if (msg.toLowerCase().includes("failed to fetch")) {
    return "Network error reaching the AI provider. Check your internet connection.";
  }
  return msg.slice(0, 400);
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
