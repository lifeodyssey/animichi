import "maplibre-gl/dist/maplibre-gl.css";
import type { AnimeOverviewCircle, LatLng } from "@seichijunrei/contract";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
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

export type BubbleMapHandle = Readonly<{ destroy: () => void }>;

let protocolReady = false;

const registerProtocol = async (gl: typeof import("maplibre-gl")): Promise<void> => {
  if (protocolReady) return;
  const { Protocol } = await import("pmtiles");
  gl.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  protocolReady = true;
};

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

const createMap = (gl: typeof import("maplibre-gl"), options: MountBasemapOptions): MapLibreMap => {
  return new gl.Map({
    container: options.container,
    style: createMapStyle("pmtiles"),
    interactive: options.interactive ?? true,
    attributionControl: { compact: true },
  });
};

const onMapLoad = (map: MapLibreMap, options: MountBasemapOptions): void => {
  fitToPoints(map, options.points);
  options.onStatus("ready");
};

const wireEvents = (map: MapLibreMap, options: MountBasemapOptions): void => {
  map.on("load", () => { onMapLoad(map, options); });
  map.on("error", () => { options.onStatus("fallback"); });
};

export const mountBasemap = async (options: MountBasemapOptions): Promise<BubbleMapHandle> => {
  const gl = await import("maplibre-gl");
  await registerProtocol(gl);
  const map = createMap(gl, options);
  wireEvents(map, options);
  return { destroy: () => { map.remove(); } };
};

interface Attachment {
  handle: BubbleMapHandle | null;
  active: boolean;
}

const storeHandle = (attachment: Attachment, handle: BubbleMapHandle): void => {
  if (!attachment.active) {
    handle.destroy();
    return;
  }
  attachment.handle = handle;
};

// A failed mount (no WebGL context, import failure) degrades like a tile failure.
const reportMountFailure = (attachment: Attachment, options: MountBasemapOptions): void => {
  if (attachment.active) options.onStatus("fallback");
};

// Bridges the async mount into React's synchronous effect-cleanup contract.
export const attachBasemap = (options: MountBasemapOptions): (() => void) => {
  const attachment: Attachment = { handle: null, active: true };
  void mountBasemap(options)
    .then((handle) => { storeHandle(attachment, handle); })
    .catch(() => { reportMountFailure(attachment, options); });
  return () => {
    attachment.active = false;
    attachment.handle?.destroy();
  };
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
