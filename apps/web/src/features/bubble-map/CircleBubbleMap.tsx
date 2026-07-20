import type { AnimeOverviewCircle } from "@seichijunrei/contract";
import type { CSSProperties, Ref } from "react";
import type { BubbleMapCopy } from "./copy";
import { type BubblePlacement, bubblePlacements, hasBubbles } from "./bubbleGeometry";

type Props = Readonly<{
  circles: readonly AnimeOverviewCircle[];
  copy: BubbleMapCopy;
  selectedRegion: string | null;
  onSelectRegion: (region: string) => void;
  mapContainerRef: Ref<HTMLDivElement>;
}>;

type OverlayProps = Omit<Props, "mapContainerRef">;

type BubbleProps = Readonly<{
  placement: BubblePlacement;
  copy: BubbleMapCopy;
  selected: boolean;
  onSelect: (region: string) => void;
}>;

const BUBBLE_CLASS =
  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-border)] bg-[var(--color-primary)]/80 text-xs font-bold text-[var(--color-primary-fg)] shadow-md aria-pressed:ring-2 aria-pressed:ring-[var(--color-accent)]";

function bubbleStyle(placement: BubblePlacement): CSSProperties {
  const diameter = placement.radius * 2;
  return { width: diameter, height: diameter, left: `${String(placement.leftPct)}%`, top: `${String(placement.topPct)}%` };
}

function BubbleButton({ placement, copy, selected, onSelect }: BubbleProps) {
  return (
    <button type="button" aria-pressed={selected} onClick={() => { onSelect(placement.region); }} style={bubbleStyle(placement)} className={BUBBLE_CLASS}>
      {placement.region}
      <span className="block font-normal">{copy.spotUnit(placement.count)}</span>
    </button>
  );
}

function EmptyBubbleMap({ copy }: Readonly<{ copy: BubbleMapCopy }>) {
  return <p className="grid h-full place-items-center text-center text-[var(--color-muted-fg)]">{copy.empty}</p>;
}

function BubbleOverlay({ circles, copy, selectedRegion, onSelectRegion }: OverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 [&_button]:pointer-events-auto">
      {bubblePlacements(circles).map((placement) => (
        <BubbleButton key={placement.region} placement={placement} copy={copy} selected={placement.region === selectedRegion} onSelect={onSelectRegion} />
      ))}
    </div>
  );
}

function MapStage({ mapContainerRef, ...overlay }: Props) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[var(--color-card)]">
      <div ref={mapContainerRef} className="absolute inset-0" aria-hidden />
      {hasBubbles(overlay.circles) ? <BubbleOverlay {...overlay} /> : <EmptyBubbleMap copy={overlay.copy} />}
    </div>
  );
}

/** Bubble map card: MapLibre basemap underneath, an accessible bubble overlay on top. */
export function CircleBubbleMap(props: Props) {
  return (
    <section aria-labelledby="bubble-map-heading">
      <h2 id="bubble-map-heading" className="text-lg">{props.copy.heading}</h2>
      <MapStage {...props} />
    </section>
  );
}
