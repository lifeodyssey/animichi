import type { GeoJSONSourceSpecification, LineLayerSpecification } from "maplibre-gl";
import { COLORS, SPOTS } from "./constants";

const routeCoordinates = SPOTS.map((spot) => spot.coord);

export const routeSource = (): GeoJSONSourceSpecification => {
  return {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: routeCoordinates.map(([lon, lat]) => [lon, lat])
      }
    }
  };
};

export const routeLayer = (): LineLayerSpecification => {
  return {
    id: "uji-route",
    type: "line",
    source: "uji-route",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": COLORS.brown,
      "line-width": 4,
      "line-dasharray": [1.2, 1.2]
    }
  };
};
