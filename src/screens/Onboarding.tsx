import { useState } from "react";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { useStore } from "../stores/store";
import { Orb } from "../components/Orb";
import { Switch } from "../components/ui";

const FEATURES = [
  ["Applications", "Open, focus and close desktop apps — and verify they really started."],
  ["Files & folders", "Search, organize, move and rename. Deletes always ask you first."],
  ["Browser & terminal", "Automate pages via DOM, run PowerShell with risk checks."],
  ["Screen understanding", "Ask what's on your screen; screenshots are logged and never streamed."],
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);

  return (
    <div className="flex h-full flex-col bg-cipher-bg">
      <div className="cipher-hero-bg flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        {step === 0 && (
          <>
            <Orb size={120} showLabel={false} />
            <div className="animate-fade-in">
              <h1 className="text-[26px] font-semibold tracking-[0.28em] text-cipher-text">
                CIPHER
              </h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-cipher-dim">
                Your AI operating layer for Windows.
                <br />
                It plans, executes and verifies — you stay in control.
              </p>
            </div>
            <div className="grid w-full max-w-sm gap-2 text-left">
              {FEATURES.map(([t, d]) => (
                <div key={t} className="flex items-start gap-2.5 rounded-lg border border-cipher-edge bg-white/[0.02] px-3 py-2">
                  <Sparkles size={13} className="mt-0.5 shrink-0 text-cipher-accent" />
                  <div>
                    <p className="text-[12.5px] font-medium text-cipher-text">{t}</p>
                    <p className="text-[11.5px] leading-snug text-cipher-faint">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <div className="w-full max-w-sm animate-fade-in text-left">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-cipher-accent" />
              <h2 className="text-[17px] font-semibold text-cipher-text">
                You decide what CIPHER can access
              </h2>
            </div>
            <p className="mb-4 text-[12.5px] leading-relaxed text-cipher-dim">
              Every action runs through the permission engine. Risky actions ask
              you first; destructive ones always do. You can change these
              anytime in Settings → Desktop.
            </p>
            <div className="rounded-xl2 border border-cipher-edge bg-white/[0.02] p-4">
              {[
                ["app_control", "Application control", "Open, focus and close apps."],
                ["file_access", "File access", "Read, organize and manage files and folders."],
                ["terminal_access", "Terminal access", "Run PowerShell commands with risk checks."],
                ["screenshot_access", "Screenshot access", "Capture the screen when you ask about it."],
                ["clipboard_access", "Clipboard access", "Read and write clipboard text."],
              ].map(([key, title, hint]) => (
                <div key={key} className="flex items-center justify-between gap-3 border-b border-cipher-edge/50 py-2.5 last:border-0">
                  <div>
                    <p className="text-[12.5px] text-cipher-text">{title}</p>
                    <p className="text-[11px] text-cipher-faint">{hint}</p>
                  </div>
                  <Switch
                    checked={(settings.desktop as any)[key]}
                    onChange={(v) => update("desktop", { [key]: v })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="w-full max-w-sm animate-fade-in text-left">
            <h2 className="text-[17px] font-semibold text-cipher-text">Bring your own key</h2>
            <p className="mt-2 mb-4 text-[12.5px] leading-relaxed text-cipher-dim">
              CIPHER works with OpenRouter, OpenAI, Gemini, Groq — or a local
              Ollama model. Keys go into Windows Credential Manager, never into
              source code. You can set this up now or later in Settings → AI.
            </p>
            <div className="rounded-xl2 border border-cipher-accent/25 bg-cipher-accentsoft/40 p-4 text-[12.5px] leading-relaxed text-cipher-text">
              <p className="font-medium">Recommended first steps</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-cipher-dim">
                <li>Open Settings → AI and add your provider + key</li>
                <li>Press Test connection</li>
                <li>Come back and try: “Open Notepad”</li>
              </ol>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-cipher-edge px-6 py-3.5">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-5 bg-cipher-accent" : "w-1.5 bg-white/15"
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => {
            if (step < 2) {
              setStep(step + 1);
            } else {
              import("../lib/api").then(({ setSetting }) =>
                setSetting("onboarded", true)
                  .then(() => {
                    useStore.setState((s) => ({
                      settings: { ...s.settings, onboarded: true },
                    }));
                  })
                  .catch(() => {})
              );
            }
          }}
          className="flex items-center gap-1.5 rounded-lg bg-cipher-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-85"
        >
          {step < 2 ? "Continue" : "Meet CIPHER"} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
