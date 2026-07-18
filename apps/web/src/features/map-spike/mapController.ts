import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { createMapStyle } from "./mapStyle";
import { routeLayer, ROUTE_SOURCE_ID, routeSource } from "./mapLayers";
import { pinLabel } from "./pins";
import type { MapStatus } from "./MapSpike";
import type { SourceMode } from "./sourceMode";
import { SPOTS, UJI_CENTER, UJI_ZOOM, type Spot } from "./spots";

export type MountOptions = Readonly<{
  container: HTMLElement;
  mode: SourceMode;
  onStatus: (status: MapStatus) => void;
}>;

export type MapHandle = Readonly<{ destroy: () => void }>;

let protocolReady = false;

const registerProtocol = async (gl: typeof import("maplibre-gl")): Promise<void> => {
  if (protocolReady) {
    return;
  }
  const { Protocol } = await import("pmtiles");
  gl.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  protocolReady = true;
};

const markerElement = (spot: Spot, index: number): HTMLElement => {
  const element = document.createElement("div");
  element.className = `map-spike__pin map-spike__pin--${spot.kind}`;
  element.textContent = pinLabel(spot, index);
  element.title = spot.label;
  return element;
};

const addRoute = (map: MapLibreMap): void => {
  map.addSource(ROUTE_SOURCE_ID, routeSource());
  map.addLayer(routeLayer());
};

const addMarkers = (gl: typeof import("maplibre-gl"), map: MapLibreMap): Marker[] => {
  return SPOTS.map((spot, index) =>
    new gl.Marker({ element: markerElement(spot, index), anchor: "bottom" })
      .setLngLat([...spot.coord])
      .addTo(map),
  );
};

const createMap = (gl: typeof import("maplibre-gl"), options: MountOptions): MapLibreMap => {
  return new gl.Map({
    container: options.container,
    style: createMapStyle(options.mode),
    center: [...UJI_CENTER],
    zoom: UJI_ZOOM,
    attributionControl: { compact: true },
  });
};

const onMapLoad = (gl: typeof import("maplibre-gl"), map: MapLibreMap, onStatus: MountOptions["onStatus"]): void => {
  addRoute(map);
  addMarkers(gl, map);
  onStatus("ready");
};

const wireEvents = (gl: typeof import("maplibre-gl"), map: MapLibreMap, options: MountOptions): void => {
  map.on("load", () => { onMapLoad(gl, map, options.onStatus); });
  map.on("error", () => { options.onStatus("fallback"); });
};

const buildHandle = (map: MapLibreMap): MapHandle => ({ destroy: () => { map.remove(); } });

export const mountMapSpike = async (options: MountOptions): Promise<MapHandle> => {
  const gl = await import("maplibre-gl");
  await registerProtocol(gl);
  const map = createMap(gl, options);
  wireEvents(gl, map, options);
  return buildHandle(map);
};

interface Attachment {
  handle: MapHandle | null;
  active: boolean;
}

const storeHandle = (attachment: Attachment, handle: MapHandle): void => {
  if (!attachment.active) {
    handle.destroy();
    return;
  }
  attachment.handle = handle;
};

// Bridges the async mount into React's synchronous effect-cleanup contract.
export const attachMapSpike = (options: MountOptions): (() => void) => {
  const attachment: Attachment = { handle: null, active: true };
  void mountMapSpike(options).then((handle) => {
    storeHandle(attachment, handle);
  });
  return () => {
    attachment.active = false;
    attachment.handle?.destroy();
  };
};
