import { expect } from "vitest";
import { app } from "../src/index";
import { localDatabaseUrl } from "./spike-db";

export interface ApiPoint {
  id: string;
  name: string;
  bangumi_id: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
}

export interface OverviewBody {
  bangumi_id: string;
  points_length: number;
  circles: { region: string; count: number; lat: number; lng: number }[];
  scenes: { id: string; shot_count: number; screenshot_url: string | null; city?: string }[];
  sample_routes: { region: string; point_ids: string[] }[];
}

export interface RouteBody {
  ordered_points: ApiPoint[];
  point_count: number;
  timed_itinerary: { stops: unknown[]; legs: unknown[]; total_minutes: number; total_distance_m: number };
}

/**
 * POST through the PLAIN-JSON / OpenAPI wire the contract + Python client use:
 * the body IS the raw input object and the response IS the raw output object
 * (no `{ json }` envelope). Optional `expectStatus` for non-200 assertions.
 */
export async function call<T>(method: string, payload: unknown, expectStatus = 200): Promise<T> {
  const res = await appRequest(method, payload);
  expect(res.status).toBe(expectStatus);
  return (await res.json());
}

async function appRequest(method: string, payload: unknown): Promise<Response> {
  return await app.request(
    `/catalog/${method}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
    { ENVIRONMENT: "test", DATABASE_URL: localDatabaseUrl() },
  );
}

/** GET through the public OpenAPI wire (anonymous, no body). Returns the raw
 * response so tests can assert both the JSON body and cache headers. */
export async function getPublic(path: string, expectStatus = 200): Promise<Response> {
  const res = await app.request(
    `/catalog/public/${path}`,
    { method: "GET" },
    { ENVIRONMENT: "test", DATABASE_URL: localDatabaseUrl() },
  );
  expect(res.status).toBe(expectStatus);
  return res;
}
