import "maplibre-gl/dist/maplibre-gl.css";
import type { AnimeOverviewCircle, LatLng } from "@animichi/contract";
import type { FitBoundsOptions, LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
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
  /** Chat marker maps opt into container-aware framing: adaptive padding,
   * maxZoom 15, an initial camera at mount, and re-fit + re-projection as the
   * viewport changes. Omitted, the mount keeps the legacy fixed framing
   * (padding 64, maxZoom 12, one fit on load) existing maps render with. */
  framing?: "marker";
}>;

export type MountBubbleMapOptions = Readonly<{
  container: HTMLElement;
  circles: readonly AnimeOverviewCircle[];
  onStatus: (status: BasemapStatus) => void;
}>;

export type BubbleMapHandle = MapLibreHandle;

const LEGACY_PADDING = 64;
const LEGACY_MAX_ZOOM = 12;
const MARKER_MAX_ZOOM = 15;

const pointsBounds = (points: readonly LatLng[]): LngLatBoundsLike => {
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
};

// Frame the tile basemap around the coordinates; any overlay renders on top in React.
const paddingFor = (options: MountBasemapOptions, container: HTMLElement): number => {
  if (options.framing !== "marker") return LEGACY_PADDING;
  return Math.min(LEGACY_PADDING, Math.min(container.clientWidth, container.clientHeight) / 4);
};

const fitOptions = (options: MountBasemapOptions, container: HTMLElement): FitBoundsOptions => ({
  padding: paddingFor(options, container),
  maxZoom: options.framing === "marker" ? MARKER_MAX_ZOOM : LEGACY_MAX_ZOOM,
  animate: false,
});

const fitToPoints = (map: MapLibreMap, options: MountBasemapOptions): void => {
  if (options.points.length === 0) return;
  map.fitBounds(pointsBounds(options.points), fitOptions(options, map.getContainer()));
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
  const observer = new ResizeObserver(() => { map.resize(); fitToPoints(map, options); project(); });
  map.on("move", project);
  observer.observe(options.container);
  project();
  return () => { observer.disconnect(); map.off("move", project); };
};

const onMarkerLoad = (options: MountBasemapOptions, map: MapLibreMap): (() => void) => {
  const cleanup = observeViewport(options, map);
  const ready = () => { options.onStatus("ready"); };
  void map.once("idle", ready);
  return () => { cleanup(); map.off("idle", ready); };
};

const onBasemapLoad = (options: MountBasemapOptions, map: MapLibreMap): (() => void) | undefined => {
  fitToPoints(map, options);
  if (options.framing === "marker") return onMarkerLoad(options, map);
  projectPoints(map, options);
  options.onStatus("ready");
  return undefined;
};

const initialCamera = (options: MountBasemapOptions) => ({
  bounds: options.points.length ? pointsBounds(options.points) : undefined,
  fitBoundsOptions: fitOptions(options, options.container),
});

const mountOptions = (options: MountBasemapOptions): MapLibreMountOptions => ({
  ...(options.framing === "marker" ? initialCamera(options) : {}),
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
