import type { Ref } from "react";
import { IllustrationBasemap } from "./IllustrationBasemap";
import type { SourceMode } from "./sourceMode";

export type MapStatus = "loading" | "ready" | "fallback";

type MapSpikeProps = Readonly<{
  mapContainerRef: Ref<HTMLDivElement>;
  status: MapStatus;
  sourceMode: SourceMode;
}>;

const STATUS_MESSAGE: Record<MapStatus, string> = {
  loading: "Loading Uji tiles…",
  ready: "Interactive map ready.",
  fallback: "Showing the illustrated basemap — tiles are unavailable.",
};

function MapSpikeHeader({ status, sourceMode }: Omit<MapSpikeProps, "mapContainerRef">) {
  return (<header className="map-spike__head">
    <p className="eyebrow">Dev spike</p>
    <h1 id="map-spike-title">Map spike</h1>
    <p className="tagline">MapLibre GL + Protomaps PMTiles over Uji (Kansai).</p>
    <p aria-live="polite">{STATUS_MESSAGE[status]}</p>
    <p className="map-spike__source">Tile source: {sourceMode}</p>
  </header>);
}

export function MapSpike({ mapContainerRef, status, sourceMode }: MapSpikeProps) {
  return (<main className="map-spike" aria-labelledby="map-spike-title">
    <MapSpikeHeader status={status} sourceMode={sourceMode} />
    <div className="map-spike__stage" data-status={status}>
      <IllustrationBasemap />
      <div ref={mapContainerRef} className="map-spike__gl" aria-hidden={status !== "ready"} />
    </div>
  </main>);
}
