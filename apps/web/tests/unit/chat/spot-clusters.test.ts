import { describe, expect, it } from "vitest";
import {
  clusterSpots,
  distanceKm,
  envelopeKm,
  locatedSpots,
  searchMapView,
  toSearchSpots,
  topSpots,
} from "../../../src/lib/chat/spotClusters";
import type { LocatedSpot } from "../../../src/lib/chat/spotClusters";

const UJI = { lat: 34.89, lng: 135.8 };
const TOKYO = { lat: 35.69, lng: 139.7 };

function located(id: string, lat: number, lng: number, city?: string): LocatedSpot {
  return { id, name: id, city, coord: { lat, lng } };
}

describe("toSearchSpots row normalization", () => {
  it("reads coordinates and episode under both streamed field names", () => {
    const spots = toSearchSpots([
      { id: "a", name: "A", lat: 34.89, lng: 135.8, ep: 8 },
      { id: "b", name: "B", latitude: 34.9, longitude: 135.81, episode: 3 },
    ]);
    expect(spots[0]?.coord).toEqual({ lat: 34.89, lng: 135.8 });
    expect(spots[1]?.coord).toEqual({ lat: 34.9, lng: 135.81 });
    expect(spots.map((spot) => spot.ep)).toEqual([8, 3]);
  });

  it("keeps coordinate-less rows but excludes them from located spots", () => {
    const spots = toSearchSpots([{ id: "a", name: "A" }, { id: "b", name: "B", lat: 1, lng: 2 }]);
    expect(spots).toHaveLength(2);
    expect(locatedSpots(spots).map((spot) => spot.id)).toEqual(["b"]);
  });
});

describe("distanceKm", () => {
  it("measures Uji to Tokyo at roughly 365km", () => {
    const km = distanceKm(UJI, TOKYO);
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(390);
  });
});

describe("clusterSpots", () => {
  it("merges spots within 50km into one cluster with a majority city", () => {
    const clusters = clusterSpots([
      located("a", 34.89, 135.8, "宇治市"),
      located("b", 34.9, 135.81, "宇治市"),
      located("c", 34.95, 135.76, "京都市"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.city).toBe("宇治市");
    expect(clusters[0]?.spots).toHaveLength(3);
  });

  it("splits spots farther than 50km into separate clusters", () => {
    const clusters = clusterSpots([located("a", UJI.lat, UJI.lng), located("b", TOKYO.lat, TOKYO.lng)]);
    expect(clusters).toHaveLength(2);
  });
});

describe("searchMapView", () => {
  it("returns empty when no spot carries coordinates", () => {
    expect(searchMapView(toSearchSpots([{ id: "a", name: "A" }])).kind).toBe("empty");
  });

  it("returns single for one tight cluster", () => {
    const view = searchMapView([located("a", 34.89, 135.8), located("b", 34.9, 135.81)]);
    expect(view.kind).toBe("single");
  });

  it("returns multi for two distant clusters", () => {
    const view = searchMapView([located("a", UJI.lat, UJI.lng), located("b", TOKYO.lat, TOKYO.lng)]);
    expect(view.kind).toBe("multi");
  });

  it("returns multi for a chained single cluster whose envelope exceeds 50km", () => {
    const chain = [0, 0.2, 0.4, 0.5].map((step, index) => located(`c${String(index)}`, 34.5 + step, 135.8));
    expect(clusterSpots(chain)).toHaveLength(1);
    expect(envelopeKm(chain)).toBeGreaterThan(50);
    expect(searchMapView(chain).kind).toBe("multi");
  });
});

describe("topSpots", () => {
  it("caps the cards at six", () => {
    const spots = toSearchSpots(
      Array.from({ length: 9 }, (_, index) => ({ id: `s${String(index)}`, name: `S${String(index)}`, screenshot_url: "/x.webp" })),
    );
    expect(topSpots(spots)).toHaveLength(6);
  });

  it("ranks photo-carrying spots first while preserving upstream order", () => {
    const spots = toSearchSpots([
      { id: "plain", name: "plain" },
      { id: "p1", name: "p1", screenshot_url: "/1.webp" },
      { id: "p2", name: "p2", screenshot_url: "/2.webp" },
    ]);
    expect(topSpots(spots).map((spot) => spot.id)).toEqual(["p1", "p2", "plain"]);
  });
});
