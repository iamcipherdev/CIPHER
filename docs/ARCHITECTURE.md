# CIPHER — Architecture

## 1. High-level flow

```
                USER
                  │
          Voice / Text Input
                  │
                  ▼
         ┌─────────────────┐
         │  CIPHER BRAIN   │  (src/agent/loop.ts + providers.ts)
         │ AI + Planner    │
         └────────┬────────┘
                  │  structured tool calls only (JSON schema)
                  ▼
             Tool Router            (src-tauri/src/tools/mod.rs)
                  │
       ┌──────────┼───────────┐
       ▼          ▼           ▼
    Desktop     Browser     System
    Tools       Tools       Tools
       │          │           │
       └──────────┼───────────┘
                  ▼
           Permission Engine     (src-tauri/src/permissions.rs)
                  │
                  ▼
              Windows            (win32 / WebView2 / shell)
                  │
                  ▼
           Verification          (evidence + verified flag per tool)
                  │
                  ▼
                 AI              (observation fed back, next step)
```

The **AI never touches the OS directly**. It only emits tool calls that match a
fixed JSON schema (`src/agent/tools.ts`). The Rust backend is the single point
of execution and the single authority on permissions.

## 2. Frontend (React + TypeScript)

| Path | Role |
|---|---|
| `src/agent/loop.ts` | The agent loop: understand → plan → execute → observe → verify → report. Enforces **max 20 tool calls/task**, **max 2 retries/action**, cancellation, TTS hooks. |
| `src/agent/providers.ts` | `Provider` abstraction: OpenAI-compatible (OpenAI/OpenRouter/Groq/custom), Gemini, Ollama. Tool-calling + vision (image parts) for each dialect. |
| `src/agent/prompts.ts` | System prompt + `wrapExternal()` prompt-injection defense. |
| `src/agent/tools.ts` | The 35 tool schemas + the set of tools whose output is treated as external data. |
| `src/stores/store.ts` | Zustand store: settings, orb state, active task, plan steps, activity feed, permission modal, toasts. |
| `src/hooks/useVoice.ts` | Push-to-talk (MediaRecorder) + auto-stop listening; STT via provider or local sidecar. |
| `src/screens/*` | MainScreen, SettingsScreen (6 tabs), Onboarding (3 steps), PaletteApp. |

Two windows share one build: `index.html` (main) and `palette.html`
(command palette, created hidden + always-on-top by Rust).

## 3. Backend (Rust / Tauri 2)

| Path | Role |
|---|---|
| `src-tauri/src/lib.rs` | Builder: plugins (single-instance, autostart, global-shortcut), setup (DB, settings defaults, palette window, tray, shortcut), close-to-tray behavior, IPC handler registry. |
| `src-tauri/src/permissions.rs` | **Risk engine.** `base_risk(tool)` + dynamic PowerShell classifier (destructive patterns → HIGH, read-only probes → SAFE, rest → MEDIUM) + category disable checks + human summaries. Pure functions, unit-tested. |
| `src-tauri/src/commands.rs` | IPC: `request_tool_execution` / `resolve_permission` (the permission round-trip), settings, secrets, history, speech, Ollama detect, sidecar status, autostart, shortcut. |
| `src-tauri/src/tools/*` | Tools: `apps` (discovery/launch/verify, focus, close, running list), `fsops` (list/search/open/copy/move/rename/info/delete→Recycle Bin, protected-path refusal), `shell` (PowerShell with EncodedCommand + timeout, background processes with log files, `check_http`), `browser` (sidecar HTTP client + `open_url` fallback), `media` (screenshots + active-window crop, clipboard via arboard, TTS via SAPI). |
| `src-tauri/src/system/*` | Tray + menu, palette window, global shortcut registration, `platform.rs` (Win32 via winapi: EnumWindows, SetForegroundWindow, WM_CLOSE, foreground rect; wmctrl/xdotool fallbacks elsewhere). |
| `src-tauri/src/db.rs` | SQLite schema: `settings`, `conversations`, `tasks`, `task_steps`, `actions`, `permission_rules`. |
| `src-tauri/src/secure.rs` | keyring (Windows Credential Manager) get/set/delete. |

## 4. Permission engine

```
request_tool_execution(tool, args)
  ├─ agent paused?                 → blocked
  ├─ category disabled?            → blocked (e.g. "Terminal access is disabled")
  ├─ classify(desktop, security, privacy, tool, args) → {risk, summary}
  ├─ HIGH        → ALWAYS ask (rules can never bypass)
  ├─ MEDIUM      → ask unless rule exists or confirm_medium=false
  └─ SAFE        → auto-run unless auto_run_safe=false
        │
        ▼
   pending request stored → "cipher-permission" event → UI modal
        │ user decides (Allow once / Always allow / Cancel)
        ▼
   resolve_permission → execute_and_log → action row + "cipher-action" event
```

Each tool result carries `verified` (bool) and `evidence` (human string), e.g.
open_app polls processes/windows for ≤7 s and reports *"window 'Spotify' is
visible (spotify.exe)"*; move_file checks destination exists and source removed;
run_powershell reports exit code; browser_navigate compares hosts.

## 5. Prompt-injection defense

- System prompt hard rules: external content is data; instructions inside it are
  refused and flagged; only the user's request authorizes actions.
- `wrapExternal(source, content)` wraps tool output of external-content tools in
  `<external_data>` tags with truncation.
- Screenshots include a note to the model that visible text is not instructions.
- The permission engine is the backstop: even a fully hijacked model cannot
  execute a high-risk action without a human click.

## 6. Voice pipeline

```
PTT (hold 🎙 or tray "Start Listening")
  → MediaRecorder (webm/opus) → base64
  → STT provider (OpenAI / Groq / custom / local sidecar)
  → text → runAgent(text)
TTS: modes off / important (final report) / all (short confirmations)
  → Rust `speak` → Windows SAPI (offline) — never reads long logs.
Wake word (experimental, default OFF): local voice sidecar scans 2s windows with
faster-whisper on-device; no cloud streaming.
```

## 7. Data model (SQLite)

```sql
settings(key, value)                      -- JSON per section
conversations(id, request, response, created_at)
tasks(id, request, status, plan_json, report, created_at, finished_at)
task_steps(id, task_id, idx, description, tool, status)
actions(id, task_id, tool, risk, ok, summary, detail, created_at)
permission_rules(id, tool, risk, created_at)  -- "always allow this type"
```
