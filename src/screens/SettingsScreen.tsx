import { useState } from "react";
import {
  ArrowLeft, Bot, Eye, Lock, Mic, Monitor, Shield, SlidersHorizontal, Loader2, CheckCircle2, XCircle,
} from "lucide-react";
import { useStore } from "../stores/store";
import { Switch, SettingRow, SectionLabel } from "../components/ui";
import * as api from "../lib/api";
import { ollamaDetect } from "../lib/api";
import type { OllamaModel } from "../lib/types";

type Tab = "general" | "ai" | "voice" | "desktop" | "security" | "privacy";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <SlidersHorizontal size={13} /> },
  { id: "ai", label: "AI", icon: <Bot size={13} /> },
  { id: "voice", label: "Voice", icon: <Mic size={13} /> },
  { id: "desktop", label: "Desktop", icon: <Monitor size={13} /> },
  { id: "security", label: "Security", icon: <Shield size={13} /> },
  { id: "privacy", label: "Privacy", icon: <Eye size={13} /> },
];

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>("general");
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const setScreen = useStore((s) => s.setScreen);
  const toast = useStore((s) => s.toast);

  return (
    <div className="flex h-full flex-col bg-cipher-bg">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-cipher-edge px-4">
        <button
          onClick={() => setScreen("main")}
          className="flex items-center gap-1 text-[12px] text-cipher-dim transition-colors hover:text-cipher-text"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-[12px] font-semibold tracking-[0.2em] text-cipher-text">
          SETTINGS
        </span>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-cipher-edge px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11.5px] transition-colors ${
              tab === t.id
                ? "bg-cipher-accentsoft text-cipher-accent"
                : "text-cipher-dim hover:bg-white/[0.04] hover:text-cipher-text"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 cipher-scroll">
        {tab === "general" && <GeneralTab settings={settings} update={update} toast={toast} />}
        {tab === "ai" && <AITab settings={settings} update={update} toast={toast} />}
        {tab === "voice" && <VoiceTab settings={settings} update={update} />}
        {tab === "desktop" && <DesktopTab settings={settings} update={update} />}
        {tab === "security" && <SecurityTab settings={settings} update={update} toast={toast} />}
        {tab === "privacy" && <PrivacyTab settings={settings} update={update} toast={toast} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GeneralTab({ settings, update, toast }: any) {
  return (
    <div>
      <SectionLabel>Startup &amp; window</SectionLabel>
      <SettingRow
        title="Launch on Windows startup"
        hint="Start CIPHER automatically when you sign in."
      >
        <Switch
          checked={settings.general.launch_on_startup}
          onChange={(v) => {
            update("general", { launch_on_startup: v });
            api.setLaunchOnStartup(v).catch(() => toast("error", "Couldn't change autostart."));
          }}
        />
      </SettingRow>
      <SettingRow
        title="Minimize to system tray"
        hint="Closing the window keeps CIPHER running in the tray."
      >
        <Switch
          checked={settings.general.minimize_to_tray}
          onChange={(v) => update("general", { minimize_to_tray: v })}
        />
      </SettingRow>
      <SettingRow title="Global shortcut" hint="Opens the command palette from anywhere (e.g. ctrl+space).">
        <input
          defaultValue={settings.general.global_shortcut}
          onBlur={(e) => {
            const v = e.target.value.trim().toLowerCase();
            if (v && v !== settings.general.global_shortcut) {
              api.setGlobalShortcut(v)
                .then(() => update("general", { global_shortcut: v }))
                .catch((err) => toast("error", String(err).replace("Error:", "").trim()));
            }
          }}
          className="w-36 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-text focus:border-cipher-accent/50 focus:outline-none"
        />
      </SettingRow>
      <SettingRow title="Theme" hint="Dark is the only theme right now.">
        <select
          value="dark"
          disabled
          className="rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-dim"
        >
          <option value="dark">Dark</option>
        </select>
      </SettingRow>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AITab({ settings, update, toast }: any) {
  const [testing, setTesting] = useState(false);
  const [ollama, setOllama] = useState<{ available: boolean; models?: OllamaModel[] } | null>(null);
  const ai = settings.ai;
  const hasKey = useStore((s) => s.hasKey[ai.provider]);

  const loadKeyState = () => {
    api.getSecret(ai.provider).then((k) => useStore.getState().setHasKey(ai.provider, !!k));
  };
  useState(() => {
    loadKeyState();
  });

  const testConnection = async () => {
    setTesting(true);
    try {
      const { createProvider } = await import("../agent/providers");
      const provider = await createProvider(ai, (p) => api.getSecret(p));
      const reply = await provider.chat([
        { role: "user", content: 'Reply with exactly: OK' },
      ]);
      if ((reply.content ?? "").includes("OK")) {
        toast("success", `${provider.label} responded — connection works.`);
      } else {
        toast("info", `Provider responded: ${(reply.content ?? "").slice(0, 80)}`);
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <SectionLabel>Provider (bring your own key)</SectionLabel>
      <SettingRow title="AI provider" hint="Keys are stored in Windows Credential Manager, never in code.">
        <select
          value={ai.provider}
          onChange={(e) => update("ai", { provider: e.target.value })}
          className="rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-text focus:border-cipher-accent/50 focus:outline-none"
        >
          <option value="openrouter">OpenRouter</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="groq">Groq</option>
          <option value="ollama">Ollama (local)</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
      </SettingRow>

      {ai.provider === "ollama" ? (
        <>
          <SettingRow title="Ollama endpoint" hint="Default: http://localhost:11434">
            <input
              defaultValue={ai.ollama_endpoint}
              onBlur={(e) => update("ai", { ollama_endpoint: e.target.value.trim() })}
              className="w-56 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-cipher-text focus:border-cipher-accent/50 focus:outline-none"
            />
          </SettingRow>
          <SettingRow title="Local models" hint="Detect Ollama and pick a model. Tools + vision need capable models.">
            <button
              onClick={async () => {
                const r = await ollamaDetect();
                setOllama(r);
                if (!r.available) toast("error", r.error ?? "Ollama not reachable.");
              }}
              className="rounded-lg border border-cipher-edge px-2.5 py-1.5 text-[12px] text-cipher-dim hover:text-cipher-text"
            >
              Detect
            </button>
          </SettingRow>
          {ollama?.available && (
            <div className="mt-2 rounded-lg border border-cipher-edge bg-white/[0.02] p-3">
              {ollama.models?.length ? (
                ollama.models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => update("ai", { model: m.name })}
                    className={`block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.04] ${
                      ai.model === m.name ? "text-cipher-accent" : "text-cipher-text"
                    }`}
                  >
                    <span className="font-mono">{m.name}</span>
                    <span className="ml-2 text-cipher-faint">
                      {m.parameter_size ?? "?"} · {m.family ?? "?"}
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-[12px] text-cipher-dim">Ollama is running but has no models. Try: ollama pull llama3.2</p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {ai.provider === "custom" && (
            <SettingRow title="Custom endpoint" hint="OpenAI-compatible base URL, e.g. http://host:8000/v1">
              <input
                defaultValue={ai.custom_endpoint}
                onBlur={(e) => update("ai", { custom_endpoint: e.target.value.trim() })}
                className="w-56 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-cipher-text focus:border-cipher-accent/50 focus:outline-none"
              />
            </SettingRow>
          )}
          <SettingRow
            title="API key"
            hint={
              hasKey
                ? "A key is saved in secure storage."
                : "Required. Stored in Windows Credential Manager."
            }
          >
            <div className="flex items-center gap-2">
              <span className={hasKey ? "text-cipher-green" : "text-cipher-faint"}>
                {hasKey ? "saved" : "not set"}
              </span>
              <input
                type="password"
                placeholder="paste key + Enter"
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (!v) return;
                    try {
                      await api.setSecret(ai.provider, v);
                      useStore.getState().setHasKey(ai.provider, true);
                      (e.target as HTMLInputElement).value = "";
                      toast("success", "Key saved to secure storage.");
                    } catch (err) {
                      toast("error", String(err));
                    }
                  }
                }}
                className="w-44 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-text focus:border-cipher-accent/50 focus:outline-none"
              />
              {hasKey && (
                <button
                  onClick={async () => {
                    await api.deleteSecret(ai.provider).catch(() => {});
                    useStore.getState().setHasKey(ai.provider, false);
                    toast("info", "Key removed.");
                  }}
                  className="text-[11px] text-cipher-red/80 hover:text-cipher-red"
                >
                  remove
                </button>
              )}
            </div>
          </SettingRow>
        </>
      )}

      <SettingRow title="Model" hint="Model id as the provider expects it.">
        <input
          defaultValue={ai.model}
          onBlur={(e) => update("ai", { model: e.target.value.trim() })}
          placeholder={
            ai.provider === "openai" ? "gpt-4o-mini" :
            ai.provider === "openrouter" ? "openai/gpt-4o-mini" :
            ai.provider === "gemini" ? "gemini-2.0-flash" :
            ai.provider === "groq" ? "llama-3.3-70b-versatile" :
            "model id"
          }
          className="w-48 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-cipher-text focus:border-cipher-accent/50 focus:outline-none"
        />
      </SettingRow>

      <div className="py-3">
        <button
          onClick={testConnection}
          disabled={testing}
          className="flex items-center gap-2 rounded-lg bg-cipher-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-85 disabled:opacity-50"
        >
          {testing && <Loader2 size={13} className="animate-spin" />}
          Test connection
        </button>
      </div>

      <SectionLabel>Speech</SectionLabel>
      <SettingRow title="Speech-to-text provider" hint="Used for push-to-talk. Local needs agent/voice_server.py.">
        <select
          value={ai.stt_provider}
          onChange={(e) => update("ai", { stt_provider: e.target.value })}
          className="rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-text"
        >
          <option value="openai">OpenAI Whisper API</option>
          <option value="groq">Groq Whisper</option>
          <option value="local">Local sidecar (offline)</option>
          <option value="custom">Custom endpoint</option>
        </select>
      </SettingRow>
      {ai.stt_provider === "custom" && (
        <SettingRow title="STT endpoint" hint="Full URL, multipart/form, OpenAI-compatible.">
          <input
            defaultValue={ai.stt_custom_endpoint}
            onBlur={(e) => update("ai", { stt_custom_endpoint: e.target.value.trim() })}
            className="w-56 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-cipher-text"
          />
        </SettingRow>
      )}
      <SettingRow
        title="CIPHER voice (TTS)"
        hint="Important responses only = the final report is spoken. Never reads logs aloud."
      >
        <select
          value={ai.tts_mode}
          onChange={(e) => update("ai", { tts_mode: e.target.value })}
          className="rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-text"
        >
          <option value="off">Off</option>
          <option value="important">Important responses only</option>
          <option value="all">Short responses</option>
        </select>
      </SettingRow>
    </div>
  );
}

// ---------------------------------------------------------------------------

function VoiceTab({ settings, update }: any) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useState(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  });
  return (
    <div>
      <SectionLabel>Microphone</SectionLabel>
      <SettingRow title="Input device" hint="Reload after granting mic permission to see names.">
        <select
          value={settings.voice.microphone}
          onChange={(e) => update("voice", { microphone: e.target.value })}
          className="max-w-48 rounded-lg border border-cipher-edge bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cipher-text"
        >
          <option value="default">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microphone"}
            </option>
          ))}
        </select>
      </SettingRow>
      <SectionLabel>Wake word (experimental)</SectionLabel>
      <SettingRow
        title='Wake word "CIPHER"'
        hint="Experimental. Uses the local voice sidecar only — audio never leaves the machine. Default OFF."
      >
        <Switch
          checked={settings.voice.wake_word}
          onChange={(v) => update("voice", { wake_word: v })}
        />
      </SettingRow>
      <SettingRow title="Local-only detection" hint="Keep enabled to guarantee no cloud streaming of ambient audio.">
        <Switch
          checked={settings.voice.wake_word_local_only}
          onChange={(v) => update("voice", { wake_word_local_only: v })}
        />
      </SettingRow>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DesktopTab({ settings, update }: any) {
  const d = settings.desktop;
  return (
    <div>
      <SectionLabel>What CIPHER may access</SectionLabel>
      <SettingRow title="File access" hint="List, search, open, copy, move, rename and delete files (deletes are always confirmed).">
        <Switch checked={d.file_access} onChange={(v) => update("desktop", { file_access: v })} />
      </SettingRow>
      <SettingRow title="Application control" hint="Open, close and focus desktop applications.">
        <Switch checked={d.app_control} onChange={(v) => update("desktop", { app_control: v })} />
      </SettingRow>
      <SettingRow title="Terminal access" hint="Run PowerShell commands. Risky commands always ask first.">
        <Switch checked={d.terminal_access} onChange={(v) => update("desktop", { terminal_access: v })} />
      </SettingRow>
      <SettingRow title="Screenshot access" hint="Capture the screen when a task needs it. Always logged in activity.">
        <Switch checked={d.screenshot_access} onChange={(v) => update("desktop", { screenshot_access: v })} />
      </SettingRow>
      <SettingRow title="Clipboard access" hint="Read and write clipboard text.">
        <Switch checked={d.clipboard_access} onChange={(v) => update("desktop", { clipboard_access: v })} />
      </SettingRow>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SecurityTab({ settings, update, toast }: any) {
  const sec = settings.security;
  return (
    <div>
      <SectionLabel>Permission engine</SectionLabel>
      <SettingRow title="Auto-run safe tools" hint="Open apps, list files, screenshots… run without asking.">
        <Switch checked={sec.auto_run_safe} onChange={(v) => update("security", { auto_run_safe: v })} />
      </SettingRow>
      <SettingRow title="Confirm medium-risk actions" hint="Ask before moving/renaming files, running terminal commands…">
        <Switch checked={sec.confirm_medium} onChange={(v) => update("security", { confirm_medium: v })} />
      </SettingRow>
      <SettingRow
        title="Always confirm destructive actions"
        hint="Deletes, installs, git push, shutdowns. Cannot be disabled."
      >
        <Switch checked disabled title="Destructive actions are always confirmed." />
      </SettingRow>
      <SettingRow title="Show terminal commands in the UI" hint="Hide command contents from popups if others can see your screen.">
        <Switch checked={sec.show_terminal_commands} onChange={(v) => update("security", { show_terminal_commands: v })} />
      </SettingRow>
      <SectionLabel>Stored rules</SectionLabel>
      <SettingRow
        title='Clear "always allow" rules'
        hint="Removes every remembered permission. High-risk actions never get permanent rules."
      >
        <button
          onClick={async () => {
            await api.clearPermissionRules().catch(() => {});
            toast("info", "Permission rules cleared.");
          }}
          className="rounded-lg border border-cipher-red/30 px-3 py-1.5 text-[12px] text-cipher-red hover:bg-cipher-red/10"
        >
          Clear rules
        </button>
      </SettingRow>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PrivacyTab({ settings, update, toast }: any) {
  const p = settings.privacy;
  return (
    <div>
      <SectionLabel>Local data</SectionLabel>
      <SettingRow title="Clear task history" hint="Removes all tasks, steps and logged actions from this machine.">
        <button
          onClick={async () => {
            await api.clearHistory().catch(() => {});
            toast("info", "Task history cleared.");
          }}
          className="rounded-lg border border-cipher-edge px-3 py-1.5 text-[12px] text-cipher-dim hover:text-cipher-text"
        >
          Clear
        </button>
      </SettingRow>
      <SettingRow title="Clear conversations" hint="Removes stored request/report pairs.">
        <button
          onClick={async () => {
            await api.clearConversations().catch(() => {});
            toast("info", "Conversations cleared.");
          }}
          className="rounded-lg border border-cipher-edge px-3 py-1.5 text-[12px] text-cipher-dim hover:text-cipher-text"
        >
          Clear
        </button>
      </SettingRow>
      <SectionLabel>Disable features</SectionLabel>
      <SettingRow title="Disable screenshot analysis" hint="CIPHER can never capture or analyze the screen.">
        <Switch checked={p.disable_screenshot_analysis} onChange={(v) => update("privacy", { disable_screenshot_analysis: v })} />
      </SettingRow>
      <SettingRow title="Disable clipboard tools" hint="CIPHER can never read or write the clipboard.">
        <Switch checked={p.disable_clipboard} onChange={(v) => update("privacy", { disable_clipboard: v })} />
      </SettingRow>
      <SettingRow title="Disable voice" hint="Removes the microphone button and wake word entirely.">
        <Switch checked={p.disable_voice} onChange={(v) => update("privacy", { disable_voice: v })} />
      </SettingRow>
      <div className="mt-4 flex items-center gap-2 text-[11px] text-cipher-faint">
        <Lock size={11} />
        Everything CIPHER stores lives in this folder only. Nothing syncs anywhere.
      </div>
    </div>
  );
}
