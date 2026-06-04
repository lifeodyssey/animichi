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
  | "guide"
  | "traveler"
  | "thinking"
  | "cheer"
  | "curious"
  | "oops"
  | "peek"
  | "lean";

export type FoxSize = "sm" | "md" | "lg" | "xl";

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
  "welcome":  "/images/landing/fox-guide-v3/fox-welcome.webp",
  "guide":    "/images/landing/fox-guide-v3/fox-guide.webp",
  "traveler": "/images/landing/fox-guide-v3/fox-traveler.webp",
  "thinking": "/images/landing/fox-guide-v3/fox-thinking.webp",
  "cheer":    "/images/landing/fox-guide-v3/fox-cheer.webp",
  "curious":  "/images/landing/fox-guide-v3/fox-curious.webp",
  "oops":     "/images/landing/fox-guide-v3/fox-oops.webp",
  "peek":     "/images/landing/fox-guide-v3/fox-peek.webp",
  // Pure-vector pose (traced via raster-to-svg); served unoptimized below.
  "lean":     "/images/landing/fox-guide-v3/svg/med/fox-lean.svg",
};

const SIZE_DIMS: Record<FoxSize, { w: number; h: number; cls: string }> = {
  sm: { w: 80,  h: 80,  cls: "w-20 h-20" },
  md: { w: 128, h: 128, cls: "w-32 h-32" },
  lg: { w: 200, h: 200, cls: "w-[200px] h-[200px]" },
  xl: { w: 280, h: 280, cls: "w-[280px] h-[280px]" },
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
        unoptimized={src.endsWith(".svg")}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
