"use client";

import { cn } from "@/lib/utils";
import FoxGuide from "@/components/generative/FoxGuide";
import SceneFrameCard from "@/components/landing/scene-card/SceneFrameCard";

export interface HeroSceneCardProps {
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
  /** Render the guide fox lounging over the frame's top-right corner. */
  showFox?: boolean;
  /** Kept for API compatibility; the clean scene has no stamp. */
  showStamp?: boolean;
  className?: string;
}

/**
 * HeroSceneCard — the landing hero composition: a standalone, mascot-free
 * `SceneFrameCard` (the tilted anime↔real photo frame) with the guide fox draped
 * over its top-right corner as a separate overlay layer. The fox is composed in
 * here, not baked into the frame, so the frame stays reusable on its own and the
 * fox can be positioned against the photo without coupling to the frame internals.
 */
export default function HeroSceneCard({
  animeSrc,
  realSrc,
  animeLabel,
  realLabel,
  locationName,
  locationArea,
  routePreviewLabel = "Route preview",
  showFox = true,
  className,
}: HeroSceneCardProps) {
  return (
    <div className={cn("entrance-up relative mx-auto w-full max-w-[560px]", className)}>
      <SceneFrameCard
        animeSrc={animeSrc}
        realSrc={realSrc}
        animeLabel={animeLabel}
        realLabel={realLabel}
        locationName={locationName}
        locationArea={locationArea}
        routePreviewLabel={routePreviewLabel}
      >
        {/* Guide fox lounges ON TOP of the photo as a separate overlay layer:
            positioned relative to the photo region, draped over its top-right so its
            chin/paws rest on the image, with a drop-shadow so it reads as sitting ON
            the photo. The box matches the SVG aspect (1181x901) so there is no wasted
            square padding. */}
        {showFox ? (
          <FoxGuide
            pose="lean"
            size="xl"
            surface="welcome"
            className="-top-[12.5rem] -right-[13%] z-30 !h-[256px] !w-[335px] [filter:drop-shadow(var(--shadow-fox))]"
          />
        ) : null}
      </SceneFrameCard>
    </div>
  );
}
