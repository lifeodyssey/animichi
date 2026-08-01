import "maplibre-gl/dist/maplibre-gl.css";
import type { AnimeOverviewCircle, LatLng } from "@animichi/contract";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { attachMapLibre, mountMapLibre, type MapLibreHandle } from "../maplibre/maplibreAdapter";
import { createMapStyle } from "../map-spike/mapStyle";

export type BasemapStatus = "loading" | "ready" | "fallback";

/** Generic basemap mount: frame the tiles around a set of coordinates. */
export type MountBasemapOptions = Readonly<{
  container: HTMLElement;
  points: readonly LatLng[];
  onStatus: (status: BasemapStatus) => void;
  /** Static-first surfaces (issue #261 C3a) mount the map non-interactive. */
  interactive?: boolean;
}>;

export type MountBubbleMapOptions = Readonly<{
  container: HTMLElement;
  circles: readonly AnimeOverviewCircle[];
  onStatus: (status: BasemapStatus) => void;
}>;

export type BubbleMapHandle = MapLibreHandle;

const pointsBounds = (points: readonly LatLng[]): LngLatBoundsLike => {
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
};

// Frame the tile basemap around the coordinates; any overlay renders on top in React.
const fitToPoints = (map: MapLibreMap, points: readonly LatLng[]): void => {
  if (points.length === 0) return;
  map.fitBounds(pointsBounds(points), { padding: 64, maxZoom: 12, animate: false });
};

const onBasemapLoad = (options: MountBasemapOptions, map: MapLibreMap): (() => void) | undefined => {
  fitToPoints(map, options.points);
  options.onStatus("ready");
  return undefined;
};

const mountOptions = (options: MountBasemapOptions) => ({
  attributionControl: { compact: true },
  container: options.container,
  interactive: options.interactive ?? true,
  onError: () => { options.onStatus("fallback"); },
  onLoad: ({ map }: { map: MapLibreMap }) => onBasemapLoad(options, map),
  registerPmtiles: true,
  style: createMapStyle("pmtiles"),
});

export const mountBasemap = async (options: MountBasemapOptions): Promise<BubbleMapHandle> => {
  return mountMapLibre(mountOptions(options));
};

export const attachBasemap = (options: MountBasemapOptions): (() => void) => {
  try {
    return attachMapLibre(mountOptions(options));
  } catch {
    options.onStatus("fallback");
    return () => { /* Mount failed before a handle was allocated. */ };
  }
};

const circlePoints = (circles: readonly AnimeOverviewCircle[]): readonly LatLng[] => {
  return circles.map(({ lat, lng }) => ({ lat, lng }));
};

/** Bubble-map entry kept for BubbleMap.tsx: circles only frame the bounds. */
export const attachBubbleMap = (options: MountBubbleMapOptions): (() => void) => {
  return attachBasemap({
    container: options.container,
    points: circlePoints(options.circles),
    onStatus: options.onStatus,
  });
};
