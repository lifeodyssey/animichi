import "maplibre-gl/dist/maplibre-gl.css";
import type { AnimeOverviewCircle, LatLng } from "@animichi/contract";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { attachMapLibre, mountMapLibre, type MapLibreHandle, type MapLibreMountOptions } from "../maplibre/maplibre-adapter";
import { createMapStyle } from "../map-spike/map-style";
import type { PointPlacement } from "./bubble-geometry";

export type BasemapStatus = "loading" | "ready" | "fallback";

/** Generic basemap mount: frame the tiles around a set of coordinates. */
export type MountBasemapOptions = Readonly<{
  container: HTMLElement;
  points: readonly LatLng[];
  onStatus: (status: BasemapStatus) => void;
  onProject?: (placements: readonly PointPlacement[]) => void;
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
const cameraPadding = (container: HTMLElement): number => {
  return Math.min(64, Math.min(container.clientWidth, container.clientHeight) / 4);
};

const fitToPoints = (map: MapLibreMap, points: readonly LatLng[]): void => {
  if (points.length === 0) return;
  const padding = cameraPadding(map.getContainer());
  map.fitBounds(pointsBounds(points), { padding, maxZoom: 15, animate: false });
};

const projectPoints = (map: MapLibreMap, options: MountBasemapOptions): void => {
  const { clientWidth, clientHeight } = options.container;
  if (!clientWidth || !clientHeight) return;
  options.onProject?.(options.points.map(({ lat, lng }) => {
    const { x, y } = map.project([lng, lat]);
    return { leftPct: x / clientWidth * 100, topPct: y / clientHeight * 100 };
  }));
};

const observeViewport = (options: MountBasemapOptions, map: MapLibreMap): (() => void) => {
  const project = () => { projectPoints(map, options); };
  const observer = new ResizeObserver(() => { map.resize(); fitToPoints(map, options.points); project(); });
  map.on("move", project);
  observer.observe(options.container);
  project();
  return () => { observer.disconnect(); map.off("move", project); };
};

const onBasemapLoad = (options: MountBasemapOptions, map: MapLibreMap): (() => void) => {
  fitToPoints(map, options.points);
  const cleanup = observeViewport(options, map);
  const ready = () => { options.onStatus("ready"); };
  void map.once("idle", ready);
  return () => { cleanup(); map.off("idle", ready); };
};

const initialCamera = (options: MountBasemapOptions) => ({
  bounds: options.points.length ? pointsBounds(options.points) : undefined,
  fitBoundsOptions: { padding: cameraPadding(options.container), maxZoom: 15, animate: false },
});

const mountOptions = (options: MountBasemapOptions): MapLibreMountOptions => ({
  ...initialCamera(options),
  attributionControl: options.interactive === false ? false : { compact: true },
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
  return attachMapLibre(mountOptions(options));
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
