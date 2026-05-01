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
    <div className="flex w-fit overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => onChange("episode")}
        aria-label={episodeLabel}
        aria-pressed={value === "episode"}
        className={cn("px-5 py-2 text-sm font-medium transition-colors",
          value === "episode"
            ? "bg-primary text-primary-fg"
            : "text-muted-foreground hover:bg-card"
        )}
      >
        {episodeLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("area")}
        aria-label={areaLabel}
        aria-pressed={value === "area"}
        className={cn("border-l border-border px-5 py-2 text-sm font-medium transition-colors",
          value === "area"
            ? "bg-primary text-primary-fg"
            : "text-muted-foreground hover:bg-card"
        )}
      >
        {areaLabel}
      </button>
    </div>
  );
}
