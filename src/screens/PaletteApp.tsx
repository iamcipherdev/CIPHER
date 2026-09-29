import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { submitPalette } from "../lib/api";
import { useStore } from "../stores/store";
import { runAgent } from "../agent/loop";

export function PaletteApp() {
  const [input, setInput] = useState("");
  const busy = useStore((s) => s.busy);
  const orb = useStore((s) => s.orb);
  const inputRef = useRef<HTMLInputElement>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    inputRef.current?.focus();
    const un = listen("cipher-palette-shown", () => {
      inputRef.current?.focus();
    });
    const onBlur = () => {
      setTimeout(() => {
        void win.hide();
      }, 150);
    };
    window.addEventListener("blur", onBlur);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      void un.then((f) => f());
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
    };
  }, [win]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void submitPalette(text);
    if (busy) return; // main window will show the running task
    void runAgent(text);
  };

  const dotColor =
    orb === "executing" || orb === "thinking" || orb === "planning"
      ? "bg-cipher-accent"
      : orb === "error"
        ? "bg-cipher-red"
        : orb === "success"
          ? "bg-cipher-green"
          : "bg-cipher-accent/60";

  return (
    <div className="h-full bg-cipher-bg/95 p-3">
      <div className="flex h-full items-center gap-3 rounded-xl2 border border-cipher-accent/30 bg-cipher-panel/90 px-4 shadow-2xl shadow-black/60">
        <span className={`relative flex h-2.5 w-2.5 shrink-0 ${busy ? "animate-pulse-soft" : ""}`}>
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`} />
        </span>
        <span className="shrink-0 text-[11px] font-semibold tracking-[0.2em] text-cipher-dim">
          CIPHER
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Ask me to do something…"
          className="h-full flex-1 bg-transparent text-[15px] text-cipher-text placeholder:text-cipher-faint focus:outline-none"
        />
        <span className="shrink-0 font-mono text-[10px] text-cipher-faint">esc</span>
      </div>
    </div>
  );
}
