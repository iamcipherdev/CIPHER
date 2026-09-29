# Building the Windows installer

Everything needed to turn this repository into `CIPHER.exe` and
`CIPHER-Setup.exe` on a Windows machine.

## 1. Prerequisites (once)

1. **Rust** (stable, MSVC toolchain): <https://rustup.rs>
2. **Node.js 18+** and npm
3. **Microsoft Visual Studio Build Tools** with "Desktop development with C++"
4. **WebView2 Runtime** — preinstalled on Windows 11; the installer config also
   bootstraps it automatically (`webviewInstallMode: downloadBootstrapper`)
5. **NSIS** is downloaded automatically by the Tauri CLI when bundling.

Check:

```powershell
rustc --version        # 1.77+
node --version         # 18+
```

## 2. Build

```powershell
cd cipher
npm install
npm run tauri build
```

The build runs, in order: `tsc` (typecheck) → `vite build` (frontend bundle) →
`cargo build --release` (Rust backend) → NSIS bundling.

## 3. Artifacts

| Artifact | Path |
|---|---|
| Standalone executable | `src-tauri\target\release\cipher.exe` |
| Windows installer | `src-tauri\target\release\bundle\nsis\CIPHER_0.2.0_x64-setup.exe` |

The NSIS installer is per-user (`installMode: currentUser`), installs to
`%LocalAppData%\CIPHER`, registers Start Menu shortcuts, and offers to launch
CIPHER after setup. "Launch on Windows startup" is an in-app setting
(Settings → General) backed by Tauri's autostart plugin.

## 4. First run on Windows

1. Launch CIPHER → onboarding (intro → permissions → AI setup).
2. Settings → AI → pick provider, paste API key (stored in **Windows Credential
   Manager**), press **Test connection**.
3. Try: *"Open Notepad"* — you should see a plan, an execution, verification
   evidence, and a spoken confirmation (TTS mode: *Important responses only*).

## 5. Optional sidecars (Windows)

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r agent\requirements.txt
python agent\browser_server.py     # port 11436 — browser automation
python agent\voice_server.py       # port 11437 — offline STT / wake word
```

The Settings screen shows live sidecar status dots. Browser DOM tools require
the browser sidecar; `open_url` works without it.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `link.exe not found` | Install VS Build Tools (C++ workload), reopen terminal. |
| Build fails on `screenshots` crate | Ensure Windows 10 SDK component is installed with Build Tools. |
| Installer missing | Check `src-tauri\target\release\bundle\nsis\` — rerun with `npm run tauri build -- --bundles nsis`. |
| Antivirus flags the exe | Unsigned binary; sign with your certificate (`tauri.conf.json → bundle.windows.certificateThumbprint`). |
| Global shortcut doesn't fire | Another app owns Ctrl+Space — change it in Settings → General. |

## 7. Configuring the bundle

Everything relevant lives in `src-tauri/tauri.conf.json` (product name, version,
identifier, icons, NSIS options) and `src-tauri/capabilities/default.json`
(what the webview may call). Icons are generated from `assets/icon.png` with
`npx tauri icon assets/icon.png`.
