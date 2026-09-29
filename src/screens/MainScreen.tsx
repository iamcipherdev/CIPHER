import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useStore } from "../stores/store";
import { Orb } from "../components/Orb";
import { CommandBar } from "../components/CommandBar";
import { TaskCard } from "../components/TaskCard";
import { ActivityFeed } from "../components/ActivityFeed";
import { PermissionModal } from "../components/PermissionModal";
import { Toasts } from "../components/Toasts";
import { TitleBar } from "../components/TitleBar";
import { sidecarStatus } from "../lib/api";
import { useExecutionMode } from "../hooks/useExecutionMode";
import { useEffect } from "react";

const TONE_CLASS: Record<"green" | "blue" | "amber", string> = {
  green: "bg-cipher-green/70",
  blue: "bg-cipher-blue/70",
  amber: "bg-cipher-amber/80",
};

export function MainScreen() {
  const busy = useStore((s) => s.busy);
  const paused = useStore((s) => s.paused);
  const task = useStore((s) => s.activeTask);
  const ai = useStore((s) => s.settings.ai);
  const [sidecars, setSidecars] = useState({ browser: false, voice: false });
  const modeStatus = useExecutionMode();

  useEffect(() => {
    sidecarStatus()
      .then(setSidecars)
      .catch(() => {});
    const t = setInterval(() => {
      sidecarStatus().then(setSidecars).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, []);

  const providerLabel =
    modeStatus.mode?.kind === "local-ai"
      ? modeStatus.label
      : modeStatus.mode?.kind === "local-commands"
        ? modeStatus.label
        : `${ai.provider} · ${ai.model || "model not set"}`;
  const dotClass = TONE_CLASS[modeStatus.tone];

  return (
    <div className="flex h-full flex-col bg-cipher-bg">
      <TitleBar />

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-4">
        {/* hero — orb shrinks while a task is on screen */}
        <div
          className={`flex justify-center pt-4 transition-all ${
            task ? "opacity-0 h-0 overflow-hidden" : "cipher-hero-bg pb-2"
          }`}
        >
          <Orb size={busy ? 96 : 128} />
        </div>

        <CommandBar />

        {(task || busy) && <TaskCard />}

        <ActivityFeed max={busy ? 6 : 14} />
      </div>

      {/* footer status */}
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-cipher-edge px-5 text-[10.5px] text-cipher-faint">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {providerLabel}
        </span>
        <span className="flex items-center gap-3">
          {paused && <span className="text-cipher-amber">PAUSED</span>}
          <span
            className="flex items-center gap-1"
            title={sidecars.browser ? "Browser sidecar running" : "Browser sidecar offline (browser_click/type need it)"}
          >
            <ShieldCheck size={10} className={sidecars.browser ? "text-cipher-green/70" : "text-cipher-faint"} />
            browser
          </span>
          <span className={sidecars.voice ? "text-cipher-green/70" : ""} title={sidecars.voice ? "Voice sidecar running" : "Voice sidecar offline (local STT/wake word need it)"}>
            voice
          </span>
        </span>
      </div>

      <PermissionModal />
      <Toasts />
    </div>
  );
}
