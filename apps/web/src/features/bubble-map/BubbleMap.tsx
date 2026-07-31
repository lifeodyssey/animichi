import type { AnimeOverviewCircle, AnimeScene } from "@animichi/contract";
import { type RefObject, useEffect, useRef, useState } from "react";
import { BubbleMapPanel } from "./BubbleMapPanel";
import { type BasemapStatus, attachBubbleMap } from "./bubbleMapController";
import type { BubbleMapCopy } from "./copy";

type Props = Readonly<{
  circles: readonly AnimeOverviewCircle[];
  scenes: readonly AnimeScene[];
  copy: BubbleMapCopy;
}>;

type StatusSetter = (status: BasemapStatus) => void;

const attachToContainer = (
  container: HTMLDivElement | null,
  circles: readonly AnimeOverviewCircle[],
  onStatus: StatusSetter,
): (() => void) | undefined => {
  if (!container || circles.length === 0) return undefined;
  return attachBubbleMap({ container, circles, onStatus });
};

function useBubbleMapMount(
  ref: RefObject<HTMLDivElement | null>,
  circles: readonly AnimeOverviewCircle[],
  onStatus: StatusSetter,
): void {
  useEffect(() => attachToContainer(ref.current, circles, onStatus), [ref, circles, onStatus]);
}

/** Feature entry: mounts the MapLibre basemap and renders the bubble overlay + sheet on top. */
export function BubbleMap({ circles, scenes, copy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setStatus] = useState<BasemapStatus>("loading");
  useBubbleMapMount(containerRef, circles, setStatus);
  return <BubbleMapPanel circles={circles} scenes={scenes} copy={copy} mapContainerRef={containerRef} />;
}
