import { LIGHT, type Flavor, layers } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import { TILE_PMTILES_URL, TILE_ZXY_URL } from "./spots";
import type { SourceMode } from "./source-mode";

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

// MapLibre style-spec needs literal colors (no CSS vars); this flavor mirrors the
// direction-E tokens — cream card ground, leaf greens, teal water, brown labels.
const animichiLight: Flavor = {
  ...LIGHT,
  background: "#f2eee2",
  earth: "#ece7d6",
  park_a: "#cfe3c4",
  park_b: "#a5d6a0",
  hospital: "#eadfd8",
  industrial: "#dde3dd",
  school: "#e8e2cf",
  wood_a: "#c4ddb6",
  wood_b: "#93cf95",
  pedestrian: "#eae4d2",
  scrub_a: "#cfe0c2",
  scrub_b: "#a3d3ad",
  sand: "#e6e1cc",
  beach: "#ece6cf",
  water: "#7fd4cb",
  zoo: "#cfe4d2",
  military: "#e2ddce",
  pier: "#e0dac6",
  buildings: "#ddd7c4",
  tunnel_other_casing: "#ded7c6",
  tunnel_minor_casing: "#ded7c6",
  tunnel_link_casing: "#ded7c6",
  tunnel_major_casing: "#ded7c6",
  tunnel_highway_casing: "#ded7c6",
  tunnel_other: "#d4cdb8",
  tunnel_minor: "#d4cdb8",
  tunnel_link: "#d4cdb8",
  tunnel_major: "#d4cdb8",
  tunnel_highway: "#d4cdb8",
  minor_service_casing: "#ded7c6",
  minor_casing: "#ded7c6",
  link_casing: "#ded7c6",
  major_casing_late: "#ded7c6",
  highway_casing_late: "#ded7c6",
  other: "#efeada",
  minor_service: "#efeada",
  minor_a: "#efeada",
  minor_b: "#fdfbf3",
  major_casing_early: "#ded7c6",
  highway_casing_early: "#ded7c6",
  railway: "#b0a898",
  boundaries: "#b8b09c",
  bridges_other_casing: "#ded7c6",
  bridges_minor_casing: "#ded7c6",
  bridges_link_casing: "#ded7c6",
  bridges_major_casing: "#ded7c6",
  bridges_highway_casing: "#ded7c6",
  bridges_other: "#efeada",
  bridges_major: "#f8f5ea",
  roads_label_minor: "#8a7f70",
  roads_label_minor_halo: "rgba(250,247,236,0.85)",
  roads_label_major: "#7d7263",
  roads_label_major_halo: "rgba(250,247,236,0.85)",
  ocean_label: "#3f9e94",
  subplace_label: "#93887a",
  subplace_label_halo: "rgba(250,247,236,0.85)",
  city_label: "#6b5f4e",
  city_label_halo: "rgba(250,247,236,0.85)",
  state_label: "#a99e88",
  state_label_halo: "rgba(250,247,236,0.85)",
  country_label: "#8a7f6c",
  pois: undefined,
  landcover: {
    barren: "#e6e0c8",
    farmland: "#e9e3c6",
    forest: "#b5d9a8",
    glacier: "#eef0ea",
    grassland: "#cfe3bd",
    scrub: "#c2dcb2",
    urban_area: "#ece7d6",
  },
};

export const createMapStyle = (mode: SourceMode, tilePath: string = TILE_PMTILES_URL): StyleSpecification => {
  return {
    version: 8,
    name: "animichi-map-spike",
    glyphs: TILE_GLYPH_URL,
    sprite: TILE_SPRITE_URL,
    sources: { [SOURCE_ID]: mode === "worker" ? workerSource() : pmtilesSource(tilePath) },
    layers: layers(SOURCE_ID, animichiLight, { lang: "ja" }),
  };
};
