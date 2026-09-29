interface SwitchProps {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}

export function Switch({ checked, onChange, disabled, title }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors ${
        checked
          ? "border-cipher-accent/60 bg-cipher-accent/80"
          : "border-cipher-edge bg-white/[0.06]"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all ${
          checked ? "left-[18px]" : "left-[2px] opacity-70"
        }`}
      />
    </button>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-cipher-faint">
      {children}
    </p>
  );
}

export function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-cipher-edge/50 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] text-cipher-text">{title}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-cipher-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
