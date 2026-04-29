"use client";

type GroupMode = "episode" | "area";

interface GroupToggleProps {
  value: GroupMode;
  onChange: (mode: GroupMode) => void;
}

export default function GroupToggle({ value, onChange }: GroupToggleProps) {
  return (
    <div className="flex w-fit overflow-hidden rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => onChange("episode")}
        className={`px-4 py-1.5 text-[12px] font-medium transition-colors ${
          value === "episode"
            ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
            : "text-[var(--color-muted-fg)] hover:bg-[var(--color-card)]"
        }`}
      >
        集数
      </button>
      <button
        type="button"
        onClick={() => onChange("area")}
        className={`border-l border-[var(--color-border)] px-4 py-1.5 text-[12px] font-medium transition-colors ${
          value === "area"
            ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
            : "text-[var(--color-muted-fg)] hover:bg-[var(--color-card)]"
        }`}
      >
        エリア
      </button>
    </div>
  );
}
