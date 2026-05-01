"use client";

import type { RouteData } from "../../lib/types";

interface FallbackListProps {
  data: RouteData;
}

export default function FallbackList({ data }: FallbackListProps) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <ol className="flex flex-col gap-2">
        {data.route.ordered_points.map((pt, idx) => (
          <li key={pt.id} className="flex items-center gap-2 text-sm text-foreground">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-fg">
              {idx + 1}
            </span>
            <span className="truncate">{pt.name_cn || pt.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
