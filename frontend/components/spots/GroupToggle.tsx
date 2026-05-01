"use client";

type GroupMode = "episode" | "area";

interface GroupToggleProps {
  value: GroupMode;
  onChange: (mode: GroupMode) => void;
  episodeLabel: string;
  areaLabel: string;
}

export default function GroupToggle({ value, onChange, episodeLabel, areaLabel }: GroupToggleProps) {
  return (
    <div className="flex w-fit overflow-hidden rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => onChange("episode")}
        className={`px-5 py-2 text-[14px] font-medium transition-colors ${
          value === "episode"
            ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
            : "text-[var(--color-muted-fg)] hover:bg-[var(--color-card)]"
        }`}
      >
        {episodeLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("area")}
        className={`border-l border-[var(--color-border)] px-5 py-2 text-[14px] font-medium transition-colors ${
          value === "area"
            ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
            : "text-[var(--color-muted-fg)] hover:bg-[var(--color-card)]"
        }`}
      >
        {areaLabel}
      </button>
    </div>
  );
}
