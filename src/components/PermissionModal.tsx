import { AlertTriangle, ShieldCheck, ShieldX } from "lucide-react";
import { useStore } from "../stores/store";
import { resolvePermission } from "../lib/api";

const RISK_META: Record<string, { label: string; className: string }> = {
  safe: { label: "LOW RISK", className: "bg-cipher-green/10 text-cipher-green border-cipher-green/30" },
  medium: { label: "MEDIUM RISK", className: "bg-cipher-amber/10 text-cipher-amber border-cipher-amber/30" },
  high: { label: "HIGH RISK", className: "bg-cipher-red/10 text-cipher-red border-cipher-red/30" },
};

function prettyParams(tool: string, params: Record<string, unknown>): string {
  if (tool === "run_powershell" || tool === "start_background_process") {
    const cwd = params.cwd ? `  (in ${params.cwd})` : "";
    return `${params.command ?? ""}${cwd}`;
  }
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}

export function PermissionModal() {
  const pending = useStore((s) => s.pendingPermission);
  const resolve = useStore((s) => s.resolvePermission);
  if (!pending) return null;

  const meta = RISK_META[pending.risk] ?? RISK_META.medium;
  const details = prettyParams(pending.tool, pending.params);

  const decide = (granted: boolean, always = false) => {
    void resolvePermission(pending.request_id, granted, always).catch(() => {});
    resolve(granted, always);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="mx-4 w-full max-w-md rounded-xl2 border border-cipher-edge bg-cipher-panel p-5 shadow-2xl shadow-black/60 animate-slide-up">
        <div className="mb-3 flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              pending.risk === "high"
                ? "border-cipher-red/40 bg-cipher-red/10"
                : "border-cipher-amber/40 bg-cipher-amber/10"
            }`}
          >
            <AlertTriangle
              size={16}
              className={pending.risk === "high" ? "text-cipher-red" : "text-cipher-amber"}
            />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-cipher-text">
              CIPHER wants to act
            </p>
            <span
              className={`mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider ${meta.className}`}
            >
              {meta.label}
            </span>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-cipher-text">{pending.summary}</p>

        {details && (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-cipher-edge bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-cipher-dim cipher-scroll">
            {details}
          </pre>
        )}

        {pending.risk === "high" && (
          <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-snug text-cipher-red/90">
            <ShieldX size={13} className="mt-0.5 shrink-0" />
            Destructive actions always require confirmation. This cannot be disabled.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => decide(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cipher-accent px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
          >
            <ShieldCheck size={14} />
            Allow once
          </button>
          {pending.allow_always && (
            <button
              onClick={() => decide(true, true)}
              className="rounded-lg border border-cipher-edge bg-white/[0.03] px-3 py-2 text-[12px] text-cipher-dim transition-colors hover:border-cipher-accent/40 hover:text-cipher-text"
            >
              Always allow this type
            </button>
          )}
          <button
            onClick={() => decide(false)}
            className="rounded-lg border border-cipher-red/30 px-3 py-2 text-[12px] text-cipher-red transition-colors hover:bg-cipher-red/10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
