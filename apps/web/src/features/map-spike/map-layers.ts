import type { GeoJSONSourceSpecification, LineLayerSpecification } from "maplibre-gl";
import { SPOTS, type LngLat } from "./spots";

export const ROUTE_SOURCE_ID = "uji-route";

// MapLibre style-spec paint values must be literal colors (CSS vars are not resolved
// by the GL renderer); this mirrors the `--color-map-pin-brand` token value.
const ROUTE_COLOR = "#c1440e";

export const routeCoordinates = (): readonly LngLat[] => {
  return SPOTS.map((spot) => spot.coord);
};

export const routeSource = (): GeoJSONSourceSpecification => {
  return {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: routeCoordinates().map((coord) => [...coord]) },
    },
  };
};

export const routeLayer = (): LineLayerSpecification => {
  return {
    id: ROUTE_SOURCE_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ROUTE_COLOR, "line-width": 4, "line-dasharray": [1.2, 1.2] },
  };
};
