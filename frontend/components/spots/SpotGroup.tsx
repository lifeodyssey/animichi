"use client";

import { useState } from "react";
import type { PilgrimagePoint } from "../../lib/types";
import SpotCard from "./SpotCard";

interface SpotGroupProps {
  title: string;
  count: number;
  points: PilgrimagePoint[];
  defaultOpen?: boolean;
  /** Select mode props — passed through to SpotCard */
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
}

export default function SpotGroup({
  title,
  count,
  points,
  defaultOpen = false,
  selectedIds,
  onToggle,
}: SpotGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isSelectMode = selectedIds !== undefined && onToggle !== undefined;

  return (
    <div className="border-b border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between py-3.5 text-left"
      >
        <h3
          className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {title}
        </h3>
        <span className="flex items-center gap-2 text-[12px] text-[var(--color-muted-fg)]">
          {count} spots
          <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        </span>
      </button>

      {open && (
        <div
          className="grid grid-cols-2 gap-2.5 pb-4 sm:grid-cols-3 lg:grid-cols-4"
          style={{ animation: "seichi-fade-up 0.3s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {points.map((point) =>
            isSelectMode ? (
              <SpotCard
                key={point.id}
                point={point}
                mode="select"
                selected={selectedIds.has(point.id)}
                onToggle={onToggle}
              />
            ) : (
              <SpotCard key={point.id} point={point} mode="browse" />
            ),
          )}
        </div>
      )}
    </div>
  );
}
