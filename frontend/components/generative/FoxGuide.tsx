"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Type policy — FoxSurface whitelist
//
// Only emotional/empty surfaces are allowed here. High-task-density surfaces
// (map-select, route-confirm, itinerary, selection-tray) are intentionally
// absent from this union. Using <FoxGuide surface="route-confirm" /> is a
// compile-time error: policy enforced by construction.
// ---------------------------------------------------------------------------

export type FoxSurface =
  | "welcome"
  | "empty"
  | "error"
  | "permission"
  | "loading";

export type FoxPose =
  | "welcome"
  | "ai-navigator"
  | "compare"
  | "traveler"
  | "icon-mark";

export type FoxSize = "sm" | "md" | "lg";

interface FoxGuideProps {
  pose: FoxPose;
  size: FoxSize;
  surface: FoxSurface;
  className?: string;
}

// ---------------------------------------------------------------------------
// Asset mapping — locked by design review
// ---------------------------------------------------------------------------

const POSE_ASSET: Record<FoxPose, string> = {
  "welcome":      "/images/landing/fox-guide-v2/fox-a-city-guide.webp",
  "ai-navigator": "/images/landing/fox-guide-v2/fox-c-ai-navigator.webp",
  "compare":      "/images/landing/fox-guide-v2/fox-e-scene-compare.webp",
  "traveler":     "/images/landing/fox-guide-v2/fox-d-backpack-traveler.webp",
  "icon-mark":    "/images/landing/fox-guide-v2/fox-f-icon-mark.webp",
};

const SIZE_DIMS: Record<FoxSize, { w: number; h: number; cls: string }> = {
  sm: { w: 80,  h: 80,  cls: "w-20 h-20" },
  md: { w: 128, h: 128, cls: "w-32 h-32" },
  lg: { w: 200, h: 200, cls: "w-[200px] h-[200px]" },
};

function getReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(getReducedMotion);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

// ---------------------------------------------------------------------------
// FoxGuide
// ---------------------------------------------------------------------------

export default function FoxGuide({ pose, size, className }: FoxGuideProps) {
  const src = POSE_ASSET[pose];
  const prefersReduced = usePrefersReducedMotion();

  if (!src) return null;

  const { w, h, cls } = SIZE_DIMS[size];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute select-none",
        cls,
        !prefersReduced && "fox-idle",
        className,
      )}
    >
      <Image
        src={src}
        alt=""
        width={w}
        height={h}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
