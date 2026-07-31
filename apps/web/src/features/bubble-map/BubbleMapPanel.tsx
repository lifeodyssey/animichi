import type { AnimeOverviewCircle, AnimeScene } from "@animichi/contract";
import { type Ref, useState } from "react";
import { CircleBubbleMap } from "./CircleBubbleMap";
import { SpotSheet } from "./SpotSheet";
import type { BubbleMapCopy } from "./copy";

type Props = Readonly<{
  circles: readonly AnimeOverviewCircle[];
  scenes: readonly AnimeScene[];
  copy: BubbleMapCopy;
  mapContainerRef: Ref<HTMLDivElement>;
}>;

function scenesInRegion(scenes: readonly AnimeScene[], region: string): readonly AnimeScene[] {
  return scenes.filter((scene) => scene.city === region);
}

type SheetProps = Readonly<{
  region: string | null;
  scenes: readonly AnimeScene[];
  copy: BubbleMapCopy;
  onClose: () => void;
}>;

function RegionSheet({ region, scenes, copy, onClose }: SheetProps) {
  if (region === null) return null;
  return <SpotSheet region={region} scenes={scenesInRegion(scenes, region)} copy={copy} onClose={onClose} />;
}

/** Bubble map + shot-angle sheet: tapping a region bubble opens its 機位 sheet. */
export function BubbleMapPanel({ circles, scenes, copy, mapContainerRef }: Props) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <CircleBubbleMap circles={circles} copy={copy} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} mapContainerRef={mapContainerRef} />
      <RegionSheet region={selectedRegion} scenes={scenes} copy={copy} onClose={() => { setSelectedRegion(null); }} />
    </div>
  );
}
