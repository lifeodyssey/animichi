import maplibregl from "maplibre-gl";
import { FileSource, PMTiles } from "pmtiles";
import { TILE_URL, UJI_CENTER } from "./constants";
import { createMapStyle } from "./map-style";
import { addDomMarkers } from "./markers";
import { protocol } from "./protocol";
import { routeLayer, routeSource } from "./route";

const addRoute = (map: maplibregl.Map): void => {
  map.addSource("uji-route", routeSource());
  map.addLayer(routeLayer());
};

const loadFileArchive = async (): Promise<void> => {
  const response = await fetch(TILE_URL);
  if (!response.ok) {
    throw new Error(`PMTiles fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  const file = new File([blob], "uji.pmtiles", { type: "application/octet-stream" });
  protocol.add(new PMTiles(new FileSource(file)));
};

export const mountOfflineDemo = (root: HTMLElement, button: HTMLButtonElement): void => {
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "loading...";

    loadFileArchive()
      .then(() => {
        root.classList.remove("is-empty");
        root.textContent = "";
        const map = new maplibregl.Map({
          container: root,
          style: createMapStyle("pmtiles", "pmtiles://uji.pmtiles"),
          center: [...UJI_CENTER],
          zoom: 13.8,
          fadeDuration: 0
        });
        map.addControl(new maplibregl.NavigationControl(), "top-right");
        map.on("load", () => {
          addRoute(map);
          addDomMarkers(map);
        });
        button.textContent = "loaded offline file";
      })
      .catch((error: unknown) => {
        button.disabled = false;
        button.textContent = "load region file offline";
        root.textContent = error instanceof Error ? error.message : "Offline load failed";
      });
  });
};
