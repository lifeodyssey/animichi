import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { MapSpike, type MapStatus } from "../../features/map-spike/MapSpike";
import { attachMapSpike } from "../../features/map-spike/mapController";
import { parseSourceMode, type SourceMode } from "../../features/map-spike/sourceMode";

export const Route = createFileRoute("/_dev/map-spike")({
  component: MapSpikeRoute,
});

const initialSourceMode = (): SourceMode => {
  if (typeof window === "undefined") {
    return "pmtiles";
  }
  return parseSourceMode(window.location.search);
};

type StatusSetter = (status: MapStatus) => void;

const attachToContainer = (container: HTMLDivElement | null, mode: SourceMode, onStatus: StatusSetter): (() => void) | undefined => {
  if (!container) {
    return undefined;
  }
  return attachMapSpike({ container, mode, onStatus });
};

function useMapSpikeMount(ref: RefObject<HTMLDivElement | null>, mode: SourceMode, onStatus: StatusSetter): void {
  useEffect(() => attachToContainer(ref.current, mode, onStatus), [ref, mode, onStatus]);
}

function MapSpikeRoute() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [sourceMode] = useState<SourceMode>(initialSourceMode);
  useMapSpikeMount(containerRef, sourceMode, setStatus);
  return <MapSpike mapContainerRef={containerRef} status={status} sourceMode={sourceMode} />;
}
