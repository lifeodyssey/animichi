import { LIGHT, type Flavor, layers } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import { TILE_PMTILES_URL, TILE_ZXY_URL } from "./spots";
import type { SourceMode } from "./sourceMode";

const ATTRIBUTION = "© OpenStreetMap contributors, Protomaps";
const SOURCE_ID = "protomaps";
/** Same-origin R2 proxy. The bucket remains private; the edge Worker exposes only this prefix. */
export const TILE_ASSET_BASE_URL = "/tiles";
export const TILE_GLYPH_URL = `${TILE_ASSET_BASE_URL}/fonts/{fontstack}/{range}.pbf`;
export const TILE_SPRITE_URL = `${TILE_ASSET_BASE_URL}/sprites/v4/light`;

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
    glyphs: TILE_GLYPH_URL,
    sprite: TILE_SPRITE_URL,
    sources: { [SOURCE_ID]: mode === "worker" ? workerSource() : pmtilesSource(tilePath) },
    layers: layers(SOURCE_ID, brandLight(), { lang: "ja" }),
  };
};
