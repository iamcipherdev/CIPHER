import { ShieldCheck, ShieldAlert, User, CircleCheck, CircleX } from "lucide-react";
import { useStore } from "../stores/store";
import type { ActivityEntry } from "../lib/types";

const RISK_STYLE: Record<string, string> = {
  safe: "text-cipher-green",
  medium: "text-cipher-amber",
  high: "text-cipher-red",
};

export function ActivityFeed({ max = 24 }: { max?: number }) {
  const activity = useStore((s) => s.activity).slice(0, max);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-cipher-faint">
        Recent activity
      </p>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 cipher-scroll">
        {activity.length === 0 && (
          <p className="py-2 text-[12px] text-cipher-faint">
            Actions CIPHER takes will appear here — every tool call is logged locally.
          </p>
        )}
        {activity.map((entry, i) => (
          <Row key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function Row({ entry }: { entry: ActivityEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
        <User size={12} className="mt-0.5 shrink-0 text-cipher-dim" />
        <span className="text-[12px] leading-snug text-cipher-text">{entry.summary}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-cipher-faint">{entry.ts}</span>
      </div>
    );
  }
  if (entry.kind === "report") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-cipher-accent/20 bg-cipher-accentsoft/50 px-2.5 py-1.5">
        {entry.ok ? (
          <CircleCheck size={12} className="mt-0.5 shrink-0 text-cipher-green" />
        ) : (
          <CircleX size={12} className="mt-0.5 shrink-0 text-cipher-red" />
        )}
        <span className="whitespace-pre-wrap text-[12px] leading-snug text-cipher-text">
          {entry.summary}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-cipher-faint">{entry.ts}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 px-2.5 py-1">
      {entry.ok ? (
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-cipher-dim" />
      ) : (
        <ShieldAlert size={12} className="mt-0.5 shrink-0 text-cipher-red" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[11px] text-cipher-accent">{entry.tool}</span>
        <span className={`ml-1.5 text-[10px] ${RISK_STYLE[entry.risk] ?? "text-cipher-faint"}`}>
          {entry.risk}
        </span>
        <span className="ml-2 text-[12px] leading-snug text-cipher-dim">{entry.summary}</span>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-cipher-faint">{entry.ts}</span>
    </div>
  );
}
