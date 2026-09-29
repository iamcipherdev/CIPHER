# BUILD REPORT — CIPHER MVP 0.2 (this session)

Honest status, per the spec's requirement to never claim untested things.

## Build status

| Check | Result | Where |
|---|---|---|
| TypeScript strict typecheck (`tsc`) | ✅ PASS (0 errors) | sandbox (Linux) |
| Frontend production build (`vite build`) | ✅ PASS (2 windows: main + palette) | sandbox (Linux) |
| Rust type check (`cargo check`) | ✅ PASS against real tauri 2 / sysinfo / image / rusqlite / ureq / screenshots / keyring crates | sandbox (Linux) |
| Rust unit tests (`cargo test`) | ✅ 6/6 PASS (risk classifier, PowerShell guard, privacy gates, human summaries) | sandbox (Linux) |
| Debug binary launch (GTK init, DB init, settings defaults, tray + palette window + shortcut registration) | ✅ starts without panic; stops only at WebKit helper-process path (see "Known limitations") | sandbox (Linux, Xvfb) |
| `npm run tauri build` → CIPHER.exe / CIPHER-Setup.exe | ⏳ **must run on Windows** — Windows MSVC targets cannot be cross-compiled from this Linux sandbox | — |
| Windows end-to-end tests 1–10 | ⏳ not executed (need a real Windows machine) — protocol in `docs/TESTING.md` | — |

## What was built (complete)

- Full Tauri 2 + React + TypeScript + Tailwind desktop app, window-chrome-less
  dark UI with orb states, task plan card, activity feed, permission modal,
  settings (6 sections), onboarding (3 steps), command palette window.
- 35-tool typed tool system; AI restricted to structured tool calls.
- Permission engine in Rust: SAFE/MEDIUM/HIGH, PowerShell pattern guard,
  category disabling, "always allow" rules (never for high risk), denial logging.
- App control with real Windows discovery (PATH + Start Menu .lnk + common
  install dirs) and process/window verification via Win32 (EnumWindows,
  SetForegroundWindow, WM_CLOSE) — plus Linux fallbacks so the code compiles
  and partially runs cross-platform.
- Filesystem tools with Recycle-Bin deletion and protected-path refusal.
- PowerShell via `-EncodedCommand` with timeout protection; background
  processes with log capture (dev-server workflow: start → read log →
  check_http → open browser).
- Browser automation via a Python/Playwright sidecar (localhost-only HTTP) with
  a no-dependency `open_url` fallback.
- Screenshots (full + active-window crop) + vision-model screen understanding.
- Voice: push-to-talk + auto-stop listening, STT providers (OpenAI/Groq/custom/
  local sidecar), TTS via Windows SAPI (offline), experimental local-only wake
  word sidecar.
- SQLite persistence (settings, conversations, tasks, steps, actions,
  permission rules) and Windows Credential Manager for API keys.
- System tray with the full menu (Open / Ask / Start Listening / Pause Agent /
  Settings / Quit), global shortcut (Ctrl+Space, configurable), close-to-tray,
  single instance, launch-on-startup.

## Installer location

Not produced here — cannot be produced from Linux. On Windows:

```powershell
npm install
npm run tauri build
# → src-tauri\target\release\cipher.exe
# → src-tauri\target\release\bundle\nsis\CIPHER_0.2.0_x64-setup.exe
```

Everything is preconfigured: NSIS per-user bundle, WebView2 bootstrapper,
icons, product metadata.

## Known limitations

1. **Windows-specific code paths are compile-checked, not runtime-tested here.**
   The Win32 app-control code (winapi) and PowerShell/TTS/SAPI paths are behind
   `#[cfg(windows)]` and could not be executed on this Linux sandbox. They are
   written against stable, well-known APIs but need the Windows test pass.
2. **Smoke launch on Linux stops at the WebKit helper path** — an artifact of
   the user-space dependency sysroot used for validation (helpers can't be
   bind-mounted without root). Real Windows uses WebView2; this failure mode
   does not exist there.
3. **UWP/Store apps** (e.g. Spotify installed from the Store) are not discover
   able by Start-Menu .lnk scanning yet — CIPHER will say it can't find them.
   Win32 installs are covered. (Roadmap: `shell:AppsFolder` enumeration.)
4. **Wake word** is experimental and requires the local voice sidecar
   (faster-whisper); it is OFF by default and never streams audio to the cloud.
5. **Streaming AI responses**: intentionally not used in tool rounds (priority:
   reliability); final reports arrive as a block.
6. **Speech recognition** defaults to cloud Whisper APIs with BYOK; the local
   sidecar covers offline use but is heavier to set up.

## Features not verified on real Windows (must run docs/TESTING.md)

- Tests 1–10 exactly as specified (Notepad, Chrome+github, CipherTest folder,
  clipboard read/write, screen understanding, node --version, dev-server flow,
  high-risk delete, voice Calculator).
- TTS voice selection, Credential Manager persistence across reboots, tray
  menu icon rendering, autostart at login, global shortcut while minimized.

## Priority order honored

Reliability (verification evidence on every tool) → Safety (Rust-side
permission authority, injection defense, Recycle-Bin deletes) → Execution
(35 tools, sidecars) → Speed (non-streaming tool rounds, lean IPC) →
Intelligence (planning-first prompt, retries with explanations) → Visual
polish (orb states, glass panels, motion kept subtle).
