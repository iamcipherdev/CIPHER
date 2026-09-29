import { Check, Circle, Loader2, X } from "lucide-react";
import { useStore } from "../stores/store";

export function TaskCard() {
  const task = useStore((s) => s.activeTask);
  const steps = useStore((s) => s.planSteps);
  if (!task) return null;

  const running = task.status === "running";

  return (
    <div className="animate-slide-up rounded-xl2 border border-cipher-edge bg-white/[0.02] p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-cipher-faint">
            Current task
          </p>
          <p className="mt-0.5 text-[14px] font-medium text-cipher-text">{task.request}</p>
        </div>
        {running && (
          <span className="flex items-center gap-1.5 rounded-full bg-cipher-accentsoft px-2.5 py-1 text-[10px] font-medium text-cipher-accent">
            <Loader2 size={10} className="animate-spin" />
            RUNNING
          </span>
        )}
        {task.status === "done" && (
          <span className="rounded-full bg-cipher-green/10 px-2.5 py-1 text-[10px] font-medium text-cipher-green">
            COMPLETE
          </span>
        )}
        {(task.status === "failed" || task.status === "cancelled") && (
          <span className="rounded-full bg-cipher-red/10 px-2.5 py-1 text-[10px] font-medium text-cipher-red">
            {task.status.toUpperCase()}
          </span>
        )}
      </div>

      {steps.length > 0 && (
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[13px]">
              {s.status === "done" && <Check size={14} className="shrink-0 text-cipher-green" />}
              {s.status === "running" && (
                <Loader2 size={14} className="shrink-0 animate-spin text-cipher-accent" />
              )}
              {s.status === "failed" && <X size={14} className="shrink-0 text-cipher-red" />}
              {s.status === "pending" && (
                <Circle size={14} className="shrink-0 text-cipher-faint" />
              )}
              <span
                className={
                  s.status === "done"
                    ? "text-cipher-dim"
                    : s.status === "pending"
                      ? "text-cipher-faint"
                      : "text-cipher-text"
                }
              >
                {s.description}
              </span>
            </li>
          ))}
        </ol>
      )}

      {task.report && (
        <div className="mt-3 border-t border-cipher-edge pt-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-cipher-faint">
            CIPHER
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-cipher-text">{task.report}</p>
        </div>
      )}
    </div>
  );
}
