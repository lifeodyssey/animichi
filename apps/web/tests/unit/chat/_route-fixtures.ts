import { ChatResponseDataPart } from "@seichijunrei/contract";
import type { ChatDataPart, TimedItinerary, TimedStop, TransitLeg } from "@seichijunrei/contract";

/** Contract-validated fixtures for the S1.5 route card tests (issue #271). */

export function stopAt(id: string, name: string, arrive: string, depart: string, photos: number, lat: number, lng: number): TimedStop {
  return { cluster_id: id, name, arrive, depart, dwell_minutes: 20, lat, lng, photo_count: photos };
}

export function walkLeg(fromId: string, toId: string, minutes: number): TransitLeg {
  return { from_id: fromId, to_id: toId, mode: "walk", duration_minutes: minutes, distance_m: minutes * 62 };
}

/** Three Uji stops; 京阪宇治駅 carries the most photos, so it wears the star. */
export function ujiItinerary(): TimedItinerary {
  return {
    stops: [
      stopAt("a", "宇治橋", "10:00", "10:20", 2, 34.891, 135.807),
      stopAt("b", "京阪宇治駅", "10:32", "10:52", 9, 34.911, 135.806),
      stopAt("c", "宇治神社", "11:00", "11:20", 4, 34.9, 135.81),
    ],
    legs: [walkLeg("a", "b", 12), { ...walkLeg("b", "c", 8), mode: "transit" }],
    total_minutes: 80,
    total_distance_m: 1500,
    pacing: "chill",
    start_time: "10:00",
    export_google_maps_url: ["https://maps.example/route"],
  };
}

export interface RoutePointSpec {
  readonly id: string;
  readonly name: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly screenshot?: string;
  readonly episode?: number;
}

/** Upstream never omits stills/episodes — it sends "" and -1 sentinels. */
export function routePoint(spec: RoutePointSpec): Record<string, unknown> {
  return {
    id: spec.id,
    name: spec.name,
    latitude: spec.lat,
    longitude: spec.lng,
    screenshot_url: spec.screenshot ?? "",
    episode: spec.episode ?? -1,
  };
}

export function routePartRaw(points: readonly Record<string, unknown>[], extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: "plan_route",
    success: true,
    status: "ok",
    data: { route: { ordered_points: points, point_count: points.length, ...extras } },
  };
}

/** Every fixture crosses the REAL contract schema before a test renders it. */
export function parsedPart(raw: unknown): ChatDataPart {
  return ChatResponseDataPart.parse(raw);
}

export function ujiPoints(): readonly Record<string, unknown>[] {
  return [
    routePoint({ id: "a", name: "宇治橋", lat: 34.891, lng: 135.807, screenshot: "/scene-a.webp", episode: 8 }),
    routePoint({ id: "b", name: "京阪宇治駅", lat: 34.911, lng: 135.806 }),
    routePoint({ id: "c", name: "宇治神社", lat: 34.9, lng: 135.81 }),
  ];
}
