import "maplibre-gl/dist/maplibre-gl.css";
import type { AnimeOverviewCircle } from "@seichijunrei/contract";
import type { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { createMapStyle } from "../map-spike/mapStyle";

export type BubbleMapStatus = "loading" | "ready" | "fallback";

export type MountBubbleMapOptions = Readonly<{
  container: HTMLElement;
  circles: readonly AnimeOverviewCircle[];
  onStatus: (status: BubbleMapStatus) => void;
}>;

export type BubbleMapHandle = Readonly<{ destroy: () => void }>;

let protocolReady = false;

const registerProtocol = async (gl: typeof import("maplibre-gl")): Promise<void> => {
  if (protocolReady) return;
  const { Protocol } = await import("pmtiles");
  gl.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  protocolReady = true;
};

const circlesBounds = (circles: readonly AnimeOverviewCircle[]): LngLatBoundsLike => {
  const lngs = circles.map((c) => c.lng);
  const lats = circles.map((c) => c.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
};

// Frame the tile basemap around the region cluster; the bubble overlay renders on top in React.
const fitToCircles = (map: MapLibreMap, circles: readonly AnimeOverviewCircle[]): void => {
  if (circles.length === 0) return;
  map.fitBounds(circlesBounds(circles), { padding: 64, maxZoom: 12, animate: false });
};

const createMap = (gl: typeof import("maplibre-gl"), container: HTMLElement): MapLibreMap => {
  return new gl.Map({ container, style: createMapStyle("pmtiles"), attributionControl: { compact: true } });
};

const onMapLoad = (map: MapLibreMap, options: MountBubbleMapOptions): void => {
  fitToCircles(map, options.circles);
  options.onStatus("ready");
};

const wireEvents = (map: MapLibreMap, options: MountBubbleMapOptions): void => {
  map.on("load", () => { onMapLoad(map, options); });
  map.on("error", () => { options.onStatus("fallback"); });
};

export const mountBubbleMap = async (options: MountBubbleMapOptions): Promise<BubbleMapHandle> => {
  const gl = await import("maplibre-gl");
  await registerProtocol(gl);
  const map = createMap(gl, options.container);
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

// Bridges the async mount into React's synchronous effect-cleanup contract.
export const attachBubbleMap = (options: MountBubbleMapOptions): (() => void) => {
  const attachment: Attachment = { handle: null, active: true };
  void mountBubbleMap(options).then((handle) => { storeHandle(attachment, handle); });
  return () => {
    attachment.active = false;
    attachment.handle?.destroy();
  };
};
