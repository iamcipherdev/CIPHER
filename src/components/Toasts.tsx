import { useStore } from "../stores/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto animate-slide-up rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-snug shadow-lg shadow-black/40 backdrop-blur-md ${
            t.kind === "error"
              ? "border-cipher-red/40 bg-cipher-red/10 text-cipher-red"
              : t.kind === "success"
                ? "border-cipher-green/40 bg-cipher-green/10 text-cipher-green"
                : "border-cipher-edge bg-cipher-panel/90 text-cipher-text"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
