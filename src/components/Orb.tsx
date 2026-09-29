import type { OrbState } from "../lib/types";

const STATE_COLORS: Record<OrbState, { glow: string; body: string; label: string }> = {
  idle: { glow: "rgba(109,92,255,0.25)", body: "#6d5cff", label: "CIPHER is ready" },
  listening: { glow: "rgba(90,162,255,0.5)", body: "#5aa2ff", label: "Listening…" },
  transcribing: { glow: "rgba(90,162,255,0.45)", body: "#5aa2ff", label: "Transcribing…" },
  thinking: { glow: "rgba(109,92,255,0.5)", body: "#6d5cff", label: "Thinking…" },
  planning: { glow: "rgba(109,92,255,0.5)", body: "#6d5cff", label: "Planning…" },
  executing: { glow: "rgba(109,92,255,0.6)", body: "#7c6cff", label: "Executing…" },
  waiting: { glow: "rgba(245,176,77,0.55)", body: "#f5b04d", label: "Waiting for your permission" },
  speaking: { glow: "rgba(79,216,224,0.5)", body: "#4fd8e0", label: "Speaking…" },
  success: { glow: "rgba(62,207,142,0.55)", body: "#3ecf8e", label: "Done" },
  error: { glow: "rgba(255,93,93,0.55)", body: "#ff5d5d", label: "Something needs attention" },
};

const ACTIVE_STATES: OrbState[] = ["listening", "thinking", "planning", "executing", "waiting", "speaking"];

export function Orb({ size = 132, showLabel = true }: { size?: number; showLabel?: boolean }) {
  const state = useOrbState();
  const c = STATE_COLORS[state];
  const active = ACTIVE_STATES.includes(state);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        {/* glow */}
        <div
          className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${
            active ? "animate-pulse-soft" : "animate-breathe"
          }`}
          style={{ background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)` }}
        />
        {/* ripple for listening */}
        {state === "listening" && (
          <div
            className="absolute inset-2 rounded-full border border-cipher-blue/50 animate-ripple"
          />
        )}
        {/* body */}
        <div
          className={`absolute inset-[12%] rounded-full transition-colors duration-700 ${
            active ? "animate-breathe" : ""
          }`}
          style={{
            background: `radial-gradient(circle at 35% 30%, ${c.body} 0%, #2a2170 55%, #14103a 100%)`,
            boxShadow: `0 0 ${active ? 44 : 22}px ${c.glow}, inset 0 0 18px rgba(0,0,0,0.55)`,
          }}
        />
        {/* core */}
        <div
          className="absolute rounded-full transition-all duration-500"
          style={{
            inset: "38%",
            background: "#0b0b12",
            boxShadow: `0 0 14px ${c.glow}, inset 0 0 8px ${c.glow}`,
          }}
        />
        {/* ring */}
        <div
          className={`absolute inset-[6%] rounded-full border transition-colors duration-700 ${
            state === "executing" ? "animate-spin-slow" : ""
          }`}
          style={{
            borderColor: `${c.body}44`,
            borderTopColor: state === "executing" ? c.body : undefined,
          }}
        />
      </div>
      {showLabel && (
        <div className="text-center">
          <p className="text-[13px] text-cipher-dim">{c.label}</p>
        </div>
      )}
    </div>
  );
}

import { useStore } from "../stores/store";
function useOrbState(): OrbState {
  return useStore((s) => s.orb);
}
