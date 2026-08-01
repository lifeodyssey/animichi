import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { attachMapLibre, mountMapLibre, type MapLibreHandle, type MapLibreModule } from "../maplibre/maplibreAdapter";
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

export type MapHandle = MapLibreHandle;

const markerElement = (spot: Spot, index: number): HTMLElement => {
  const element = document.createElement("div");
  element.className = `map-spike__pin map-spike__pin--${spot.kind}`;
  element.textContent = pinLabel(spot, index);
  element.title = spot.label;
  return element;
};

const addRoute = (map: MapLibreMap): void => {
  map.addSource(ROUTE_SOURCE_ID, routeSource());
  try {
    map.addLayer(routeLayer());
  } catch (error) {
    map.removeSource(ROUTE_SOURCE_ID);
    throw error;
  }
};

const addMarker = (gl: MapLibreModule, map: MapLibreMap, spot: Spot, index: number): Marker => {
  return new gl.Marker({ element: markerElement(spot, index), anchor: "bottom" }).setLngLat([...spot.coord]).addTo(map);
};

const addMarkers = (gl: MapLibreModule, map: MapLibreMap): Marker[] => {
  const markers: Marker[] = [];
  try {
    SPOTS.forEach((spot, index) => { markers.push(addMarker(gl, map, spot, index)); });
  } catch (error) {
    markers.forEach((marker) => marker.remove());
    throw error;
  }
  return markers;
};

const mapStyle = (options: MountOptions) => createMapStyle(options.mode);

const cleanupMap = (map: MapLibreMap, markers: readonly Marker[]): void => {
  markers.forEach((marker) => marker.remove());
  if (map.getLayer(ROUTE_SOURCE_ID)) map.removeLayer(ROUTE_SOURCE_ID);
  if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
};

const loadMarkers = (options: MountOptions, gl: MapLibreModule, map: MapLibreMap): Marker[] => {
  let markers: Marker[] = [];
  try {
    markers = addMarkers(gl, map);
    options.onStatus("ready");
    return markers;
  } catch (error) {
    return cleanupAndThrow(map, markers, error);
  }
};

const cleanupAndThrow = (map: MapLibreMap, markers: readonly Marker[], error: unknown): never => {
  cleanupMap(map, markers);
  throw error;
};

const loadMap = (options: MountOptions, gl: MapLibreModule, map: MapLibreMap): (() => void) => {
  addRoute(map);
  const markers = loadMarkers(options, gl, map);
  return () => { cleanupMap(map, markers); };
};

const cameraOptions = () => ({
  center: { lng: UJI_CENTER[0], lat: UJI_CENTER[1] },
  zoom: UJI_ZOOM,
});

const mountOptions = (options: MountOptions) => ({
  ...cameraOptions(),
  attributionControl: { compact: true },
  container: options.container,
  interactive: true,
  onError: () => { options.onStatus("fallback"); },
  onLoad: ({ gl, map }: { gl: MapLibreModule; map: MapLibreMap }) => loadMap(options, gl, map),
  registerPmtiles: options.mode === "pmtiles",
  style: mapStyle(options),
});

export const mountMapSpike = async (options: MountOptions): Promise<MapHandle> => {
  const setup = mountOptions(options);
  return mountMapLibre(setup);
};

export const attachMapSpike = (options: MountOptions): (() => void) => {
  try {
    return attachMapLibre(mountOptions(options));
  } catch {
    options.onStatus("fallback");
    return () => { /* Mount failed before a handle was allocated. */ };
  }
};
