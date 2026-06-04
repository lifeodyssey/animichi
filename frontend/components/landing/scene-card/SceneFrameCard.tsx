"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import BeforeAfter from "@/components/generative/BeforeAfter";
import CornerLabel from "@/components/landing/scene-card/CornerLabel";

export interface SceneFrameCardProps {
  /** Anime artwork source (left side of the before/after slider). */
  animeSrc: string;
  /** Real-location photo source (right side of the before/after slider). */
  realSrc: string;
  /** Corner pill label for the anime side. */
  animeLabel: string;
  /** Corner pill label for the real side. */
  realLabel: string;
  /** Place name (used for the accessible label of the route-preview card). */
  locationName: string;
  /** Area / region, paired with the place name in the accessible label. */
  locationArea: string;
  /** Accessible label prefix for the route-preview affordance. */
  routePreviewLabel?: string;
  /**
   * Optional overlay, rendered on top of the photo inside the card's rotated,
   * photo-relative coordinate space. The frame itself is mascot-free; a caller
   * (e.g. HeroSceneCard) composes any overlay such as the guide fox. Rendering
   * `<SceneFrameCard />` with no children is a clean, standalone photo frame.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * SceneFrameCard — the tilted cream "Polaroid" that frames a draggable anime↔real
 * comparison (BeforeAfter slider + corner pills). It is intentionally mascot-free
 * and reusable on its own; overlays (the guide fox, a stamp) are composed in by the
 * caller via `children`, so the frame stays decoupled from whatever sits on top.
 */
export default function SceneFrameCard({
  animeSrc,
  realSrc,
  animeLabel,
  realLabel,
  locationName,
  locationArea,
  routePreviewLabel = "Route preview",
  children,
  className,
}: SceneFrameCardProps) {
  return (
    <div
      data-testid="route-preview"
      data-measure="card"
      aria-label={`${routePreviewLabel}: ${locationName}, ${locationArea}`}
      className={cn(
        "relative z-10 rotate-[4deg] rounded-[var(--r-lg)] border border-border bg-card p-2.5 shadow-[var(--shadow-scene-card)]",
        className,
      )}
    >
      <div className="relative aspect-[17/10] w-full">
        {/* Real draggable anime↔real comparison (the registered BeforeAfter, the
            same slider the rest of the app uses). Marked data-match-ignore so the
            pixel-match loop scores the chrome (frame, labels, overlay), not the
            production photo, which differs from any reference composite. */}
        <div data-match-ignore data-measure="photo" className="absolute inset-0">
          <BeforeAfter
            draggable
            leftSrc={animeSrc}
            rightSrc={realSrc}
            leftAlt={`${locationName} (anime)`}
            rightAlt={`${locationName} (real)`}
            className="h-full w-full border-0 bg-transparent aspect-auto"
          />
        </div>
        <CornerLabel side="left" tone="anime" text={animeLabel} measure="label-anime" />
        <CornerLabel side="right" tone="real" text={realLabel} className="top-[44%]" measure="label-real" />
        {children}
      </div>
    </div>
  );
}
