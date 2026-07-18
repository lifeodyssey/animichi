import { describe, expect, it } from "vitest";
import {
  routeCoordinates,
  routeLayer,
  ROUTE_SOURCE_ID,
  routeSource,
} from "../../src/features/map-spike/mapLayers";
import { SPOTS } from "../../src/features/map-spike/spots";
import { parseSourceMode } from "../../src/features/map-spike/sourceMode";

describe("routeCoordinates", () => {
  it("routes through every spot coordinate in order", () => {
    expect(routeCoordinates()).toEqual(SPOTS.map((spot) => spot.coord));
  });
});

describe("routeSource", () => {
  it("wraps the itinerary as an inline geojson source", () => {
    expect(routeSource().type).toBe("geojson");
  });
});

describe("routeLayer", () => {
  it("draws a dashed line bound to the route source", () => {
    const layer = routeLayer();
    expect(layer).toMatchObject({ id: ROUTE_SOURCE_ID, type: "line", source: ROUTE_SOURCE_ID });
    expect(layer.paint?.["line-dasharray"]).toEqual([1.2, 1.2]);
  });
});

describe("parseSourceMode", () => {
  it("reads an explicit worker mode from the query string", () => {
    expect(parseSourceMode("?source=worker")).toBe("worker");
  });

  it("reads an explicit pmtiles mode from the query string", () => {
    expect(parseSourceMode("?source=pmtiles")).toBe("pmtiles");
  });

  it("defaults to pmtiles for missing or unknown values", () => {
    expect(parseSourceMode("")).toBe("pmtiles");
    expect(parseSourceMode("?source=bogus")).toBe("pmtiles");
  });
});
