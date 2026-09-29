import { useRef, useState } from "react";
import { Mic, Send, Square } from "lucide-react";
import { useStore } from "../stores/store";
import { useVoice } from "../hooks/useVoice";
import { useExecutionMode } from "../hooks/useExecutionMode";
import { runAgent } from "../agent/loop";

export function CommandBar() {
  const [input, setInput] = useState("");
  const busy = useStore((s) => s.busy);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { listening, start, stop } = useVoice();
  const { mode } = useExecutionMode();

  // Honest input hints: when no AI model is available, say what still works.
  const placeholder =
    mode?.kind === "local-commands"
      ? "Enter a local command — e.g. Open Chrome, show system info"
      : "Ask CIPHER to do something…";

  // voice hook hands the transcript over via a DOM event
  const onVoiceText = (text: string) => {
    setInput(text);
    void runAgent(text);
  };

  window.addEventListener("cipher-voice-text", ((e: CustomEvent) => {
    onVoiceText(e.detail);
  }) as EventListener);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void runAgent(text);
  };

  return (
    <div className="w-full">
      <div className="flex items-end gap-2 rounded-xl2 border border-cipher-edge bg-white/[0.03] px-3 py-2.5 backdrop-blur-md transition-colors focus-within:border-cipher-accent/50">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const el = textareaRef.current;
            if (el) {
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 96) + "px";
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={busy}
          className="max-h-24 flex-1 resize-none bg-transparent text-[14px] text-cipher-text placeholder:text-cipher-faint focus:outline-none disabled:opacity-50"
        />
        {busy ? (
          <button
            onClick={() => useStore.getState().requestCancel()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-cipher-red/40 bg-cipher-red/10 px-3 text-[12px] font-medium text-cipher-red transition-colors hover:bg-cipher-red/20"
            title="Stop the current task"
          >
            <Square size={12} fill="currentColor" />
            STOP
          </button>
        ) : (
          <button
            onPointerDown={() => void start(false)}
            onPointerUp={stop}
            onPointerLeave={() => listening && stop()}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
              listening
                ? "border-cipher-blue bg-cipher-blue/20 text-cipher-blue"
                : "border-cipher-edge text-cipher-dim hover:border-cipher-blue/50 hover:text-cipher-blue"
            }`}
            title="Hold to talk"
          >
            <Mic size={15} />
          </button>
        )}
        {!busy && (
          <button
            onClick={submit}
            disabled={!input.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-cipher-accent text-white transition-opacity hover:opacity-85 disabled:opacity-30"
            title="Run"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
