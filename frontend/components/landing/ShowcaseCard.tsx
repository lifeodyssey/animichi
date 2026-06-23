"use client";

import Image from "next/image";
import { ChevronsLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import FoxGuide from "@/components/generative/FoxGuide";

export interface ScenePhoto {
  /** Photo source path. */
  src: string;
  /** Accessible label — doubles as the corner tag text. */
  alt: string;
}

export interface ShowcaseCardProps {
  /** Anime artwork (left half of the comparison). */
  anime: ScenePhoto;
  /** Real-location photo (right half of the comparison). */
  real: ScenePhoto;
  /** Render the fox mascot perched on the top-right corner. */
  showFox?: boolean;
  className?: string;
}

/**
 * ShowcaseCard — a thick cream polaroid frame leaning gently clockwise (left
 * shoulder up, right corner dipping), holding the anime|real comparison:
 * cream corner tags, a round slider handle on the centre seam, and the fox
 * mascot hooking its paws over the dipping top-right corner. The frame owns
 * its own aspect ratio; photos object-cover into each half.
 */
export default function ShowcaseCard({ anime, real, showFox = true, className }: ShowcaseCardProps) {
  return (
    <div
      className={cn(
        "entrance-up relative mx-auto mt-10 w-full max-w-[670px] lg:mx-0 lg:mt-[64px] lg:w-[670px] lg:max-w-none lg:justify-self-end",
        className,
      )}
    >
      <div className="relative rotate-[3deg] rounded-[28px] border border-border/70 bg-card p-5 shadow-[0_34px_64px_-26px_rgba(70,52,30,0.42),0_10px_24px_-14px_rgba(70,52,30,0.25)]">
        <div className="relative aspect-[8/5] w-full overflow-hidden rounded-[14px] ring-1 ring-border/50">
          <SceneHalf side="left" photo={anime} priority />
          <SceneHalf side="right" photo={real} />

          <SliderHandle />
          <CornerTag className="left-4 top-4">{anime.alt}</CornerTag>
          <CornerTag className="right-4 top-9">{real.alt}</CornerTag>
        </div>
      </div>

      {showFox ? (
        <FoxGuide
          pose="lean"
          size="xl"
          surface="welcome"
          className="-top-[78px] right-[64px] z-30 !h-[154px] !w-[202px] [filter:drop-shadow(var(--shadow-fox))]"
        />
      ) : null}
    </div>
  );
}

function SceneHalf({
  side,
  photo,
  priority = false,
}: {
  side: "left" | "right";
  photo: ScenePhoto;
  priority?: boolean;
}) {
  return (
    <div className={cn("absolute inset-y-0 w-1/2", side === "left" ? "left-0" : "right-0")}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes="(min-width: 1024px) 28rem, 60vw"
        className={cn("object-cover", side === "left" ? "scale-[1.28] object-[20%_42%]" : "scale-[1.18] object-[50%_64%]")}
        priority={priority}
      />
    </div>
  );
}

/** Centre seam + round slider-handle affordance. */
function SliderHandle() {
  return (
    <>
      <div className="absolute inset-y-0 left-1/2 w-[6px] -translate-x-1/2 bg-background" />
      <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-fg shadow-[0_3px_10px_rgba(61,52,40,0.35)]">
        <ChevronsLeftRight size={18} />
      </div>
    </>
  );
}

/** Cream pill tag with a teal marker dot. */
function CornerTag({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={cn(
        "absolute inline-flex items-center gap-1.5 rounded-full bg-card/95 px-3.5 py-[5px] text-[12.5px] font-bold text-fg shadow-[0_2px_6px_rgba(61,52,40,0.25)]",
        className,
      )}
    >
      <span className="h-[7px] w-[7px] rounded-full bg-primary" />
      {children}
    </span>
  );
}
