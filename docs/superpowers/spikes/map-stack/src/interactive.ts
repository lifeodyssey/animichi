import maplibregl from "maplibre-gl";
import { TOKYO_CENTER, UJI_CENTER } from "./constants";
import { createMapStyle } from "./map-style";
import { addDomMarkers } from "./markers";
import { routeLayer, routeSource } from "./route";
import type { SourceMode } from "./source-mode";

const addRoute = (map: maplibregl.Map): void => {
  if (map.getSource("uji-route")) {
    return;
  }
  map.addSource("uji-route", routeSource());
  map.addLayer(routeLayer());
};

export const mountInteractiveMap = (
  root: HTMLElement,
  mode: SourceMode,
  flyTokyo: HTMLButtonElement,
  flyUji: HTMLButtonElement
): void => {
  const map = new maplibregl.Map({
    container: root,
    style: createMapStyle(mode),
    center: [...UJI_CENTER],
    zoom: 13.9,
    attributionControl: { compact: true },
    fadeDuration: 0
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("load", () => {
    addRoute(map);
    addDomMarkers(map);
  });

  flyTokyo.addEventListener("click", () => {
    map.flyTo({ center: [...TOKYO_CENTER], zoom: 12, duration: 900 });
  });
  flyUji.addEventListener("click", () => {
    map.flyTo({ center: [...UJI_CENTER], zoom: 13.9, duration: 900 });
  });
};
