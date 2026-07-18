import { LIGHT, type Flavor, layers } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import { TILE_PMTILES_URL, TILE_ZXY_URL } from "./spots";
import type { SourceMode } from "./sourceMode";

const ATTRIBUTION = "© OpenStreetMap contributors, Protomaps";
const SOURCE_ID = "protomaps";
// Protomaps basemap assets; production copies these to R2 same-origin with the tiles.
const BASEMAP_ASSETS = "https://protomaps.github.io/basemaps-assets";

const workerSource = () => {
  return { type: "vector" as const, tiles: [TILE_ZXY_URL], minzoom: 0, maxzoom: 15, attribution: ATTRIBUTION };
};

const pmtilesSource = (tilePath: string) => {
  return { type: "vector" as const, url: `pmtiles://${tilePath}`, attribution: ATTRIBUTION };
};

// MapLibre style-spec needs a literal background color; mirrors the `--color-card` cream token.
const brandLight = (): Flavor => ({ ...LIGHT, background: "#f8f8f0", pois: undefined });

export const createMapStyle = (mode: SourceMode, tilePath: string = TILE_PMTILES_URL): StyleSpecification => {
  return {
    version: 8,
    name: "animichi-map-spike",
    glyphs: `${BASEMAP_ASSETS}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${BASEMAP_ASSETS}/sprites/v4/light`,
    sources: { [SOURCE_ID]: mode === "worker" ? workerSource() : pmtilesSource(tilePath) },
    layers: layers(SOURCE_ID, brandLight(), { lang: "ja" }),
  };
};
