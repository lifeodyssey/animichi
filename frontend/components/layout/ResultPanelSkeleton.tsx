"use client";

import { Skeleton } from "../ui/skeleton";

/**
 * Loading skeleton for the map-first layout.
 * Shows a full-bleed map shimmer with floating list skeleton overlay.
 * Uses shadcn Skeleton components.
 */
export function ResultPanelSkeleton() {
  return (
    <div className="relative flex-1 overflow-hidden" data-testid="loading-skeleton">
      {/* Map shimmer background */}
      <Skeleton className="absolute inset-0 rounded-none" />

      {/* Floating list skeleton overlay */}
      <div className="absolute bottom-3 left-3 top-3 z-10 flex w-[220px] flex-col gap-3 rounded-xl bg-card p-3 shadow-lg">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-10" />
        </div>

        {/* Filter chips skeleton */}
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>

        {/* Spot list rows skeleton */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2 w-2/3" />
            </div>
          </div>
        ))}
      </div>

      {/* View toggle skeleton (top-right) */}
      <div className="absolute right-3 top-3 z-10">
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
    </div>
  );
}
