"use client";

import { cn } from "@/lib/utils";

type GroupMode = "episode" | "area";

interface GroupToggleProps {
  value: GroupMode;
  onChange: (mode: GroupMode) => void;
  episodeLabel: string;
  areaLabel: string;
}

export default function GroupToggle({ value, onChange, episodeLabel, areaLabel }: GroupToggleProps) {
  return (
    <div className="flex w-fit overflow-hidden rounded-2xl border border-border shadow-3d-sm">
      <button
        type="button"
        onClick={() => onChange("episode")}
        aria-label={episodeLabel}
        aria-pressed={value === "episode"}
        className={cn("px-5 py-2 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
          value === "episode"
            ? "bg-primary text-primary-fg shadow-[inset_0_2px_4px_var(--shadow-inset-active)]"
            : "text-muted-foreground hover:bg-card active:translate-y-px"
        )}
      >
        {episodeLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("area")}
        aria-label={areaLabel}
        aria-pressed={value === "area"}
        className={cn("border-l-2 border-border px-5 py-2 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
          value === "area"
            ? "bg-primary text-primary-fg shadow-[inset_0_2px_4px_var(--shadow-inset-active)]"
            : "text-muted-foreground hover:bg-card active:translate-y-px"
        )}
      >
        {areaLabel}
      </button>
    </div>
  );
}
