import type { StyleSpecification } from "maplibre-gl";
import { LIGHT, layers, type Flavor } from "@protomaps/basemaps";
import { COLORS, TILE_URL, WORKER_TILE_URL } from "./constants";
import type { SourceMode } from "./source-mode";

const attribution = "© OpenStreetMap contributors, Protomaps";

const toAbsolute = (path: string): string => {
  return new URL(path, window.location.origin).toString();
};

export const pmtilesUrl = (path: string): string => {
  return `pmtiles://${toAbsolute(path)}`;
};

const pmtilesSourceUrl = (tilePath: string): string => {
  return tilePath.startsWith("pmtiles://") ? tilePath : pmtilesUrl(tilePath);
};

const sourceFor = (mode: SourceMode, tilePath: string) => {
  if (mode === "worker") {
    return {
      type: "vector" as const,
      tiles: [WORKER_TILE_URL],
      minzoom: 0,
      maxzoom: 15,
      attribution
    };
  }

  return {
    type: "vector" as const,
    url: pmtilesSourceUrl(tilePath),
    attribution
  };
};

const brandLightFlavor = (): Flavor => ({
  ...LIGHT,
  background: COLORS.cream,
  pois: undefined
});

export const createMapStyle = (
  mode: SourceMode,
  tilePath: string = TILE_URL
): StyleSpecification => {
  return {
    version: 8,
    name: "seichijunrei-map-stack-spike",
    // Production copies these basemaps assets to R2 same-origin with the tiles.
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
    sources: {
      protomaps: sourceFor(mode, tilePath)
    },
    layers: layers("protomaps", brandLightFlavor(), { lang: "ja" })
  };
};
