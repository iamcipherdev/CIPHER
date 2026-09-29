# CIPHER

**An AI operating layer for Windows.**

CIPHER is a local-first AI desktop agent. It understands what you want, creates a
plan, executes supported actions through a strict permission engine, verifies the
result, and reports what happened. It is **not** a chatbot in a desktop window —
it is a personal computer operator.

```
Understand → Plan → Permission → Execute → Observe → Verify → Report
```

## Product identity

| | |
|---|---|
| Name | CIPHER (MVP 0.2) |
| Platform | Windows 10 / 11 (Tauri 2 + WebView2) |
| Stack | Tauri 2 (Rust) · React 18 · TypeScript · Vite · Tailwind CSS |
| AI | BYOK: OpenRouter, OpenAI, Gemini, Groq, Ollama (local), custom OpenAI-compatible |
| Storage | Local SQLite (`cipher.db`) + Windows Credential Manager for keys |
| Sidecars (optional) | Python: Playwright browser automation · faster-whisper local voice |

## What CIPHER can do (MVP 0.2)

Text & voice commands · TTS replies · optional local wake word · open/close/focus
applications · detect running apps · discover installed apps (Start Menu, PATH,
common install dirs) · full file/folder management (deletes go to the Recycle Bin
and are always HIGH-RISK confirmed) · clipboard read/write · PowerShell with
timeout + risk classification · background processes with log capture · browser
automation via Playwright sidecar · screenshots · screen understanding via vision
models · multi-step planning · action verification · a 3-level permission engine ·
action history · system tray · global command palette (Ctrl+Space) · task
cancellation.

The AI never touches the OS directly. It may only emit structured tool calls
against a fixed schema; every call passes:

```
AI → Tool Router → Risk Classifier → Permission Manager → Tool → Windows
                                                      ↓
                                              Observation → Verification → AI
```

## Quick start (development)

Prerequisites on Windows: [Rust](https://rustup.rs), Node.js 18+, WebView2
(preinstalled on Win 11), and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm install
npm run tauri dev      # opens the real desktop window
```

Linux/macOS dev machines also work for development builds (window controls, tools
and sidecars degrade gracefully); see `docs/BUILD-REPORT.md` for what was
validated where.

## Building the Windows installer

```powershell
npm run tauri build
```

Artifacts:

- `src-tauri/target/release/cipher.exe` — standalone executable
- `src-tauri/target/release/bundle/nsis/CIPHER_0.2.0_x64-setup.exe` — NSIS installer (per-user)

Full details: `docs/BUILD-WINDOWS.md`.

## Optional: Python sidecars

```powershell
pip install -r agent/requirements.txt
python agent/browser_server.py     # browser_* tools (Playwright)
python agent/voice_server.py       # offline STT + experimental wake word
```

Without the browser sidecar, `open_url` still works (system default browser);
the DOM-automation tools report clear instructions instead of failing silently.

## Security model (summary)

- **SAFE** tools (open app, list files, screenshots, read page…) run
  automatically if *Settings → Security → Auto-run safe tools* is on.
- **MEDIUM** tools (move/rename files, close app, run normal terminal commands…)
  show a permission card: *Allow once / Always allow this type / Cancel*.
- **HIGH-RISK** tools (delete, winget/choco installs, `git push`, shutdown,
  registry, credential access…) **always** require confirmation. No model output
  can bypass this; "always allow" rules never apply to high risk.
- Prompt-injection defense: webpages, files, terminal output, clipboard and
  screenshots are wrapped as `<external_data>` — data, never instructions.
- API keys live in Windows Credential Manager (keyring), never in source code.
- Every tool call is written to the local `actions` table and shown in the UI.

## Documentation

- `docs/ARCHITECTURE.md` — components, agent loop, data model
- `docs/BUILD-WINDOWS.md` — building CIPHER.exe / CIPHER-Setup.exe
- `docs/TESTING.md` — the 10 sample tasks as a manual test protocol
- `docs/BUILD-REPORT.md` — what was built & validated in this session, honestly
