import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar({ compact = false }: { compact?: boolean }) {
  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between pl-4 select-none"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-cipher-accent opacity-60 animate-pulse-soft" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cipher-accent" />
        </span>
        <span
          data-tauri-drag-region
          className="text-[13px] font-semibold tracking-[0.22em] text-cipher-text"
        >
          CIPHER
        </span>
        {!compact && (
          <span className="ml-1 rounded bg-cipher-accentsoft px-1.5 py-0.5 text-[10px] text-cipher-accent">
            0.2
          </span>
        )}
      </div>
      <div className="flex items-center">
        <button
          onClick={() => void win.minimize()}
          className="flex h-10 w-11 items-center justify-center text-cipher-dim transition-colors hover:bg-white/5 hover:text-cipher-text"
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => void win.toggleMaximize()}
          className="flex h-10 w-11 items-center justify-center text-cipher-dim transition-colors hover:bg-white/5 hover:text-cipher-text"
          aria-label="Maximize"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => void win.close()}
          className="flex h-10 w-11 items-center justify-center text-cipher-dim transition-colors hover:bg-cipher-red/80 hover:text-white"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
