import { createCatalogClient } from '@animichi/agent/tools';
import type { GeocodeResult } from '@animichi/contract/contract';
import type { Itinerary, Point, ResolveOutcome } from '@animichi/contract/models';

/**
 * A deterministic catalog data plane for prefix tests: the production
 * `createCatalogClient` reaches it over its configured origin, so every tool
 * keeps its real argument validation, projection and retry behaviour.
 */
export interface CatalogFixture {
  readonly resolve?: Readonly<Record<string, ResolveOutcome>>;
  readonly geocode?: Readonly<Record<string, GeocodeResult>>;
  readonly pointsById?: Readonly<Record<string, Point>>;
  /** bangumi_id -> offered point ids. */
  readonly works?: Readonly<Record<string, readonly string[]>>;
  /** "lat,lng" -> offered point ids. */
  readonly nearby?: Readonly<Record<string, readonly string[]>>;
}

export function fixtureCatalog(calls: Request[], fixture: CatalogFixture) {
  return createCatalogClient(fixtureFetch(fixture, calls));
}

/** The same deterministic data plane as a fetch function, so a local HTTP origin can serve it. */
export function fixtureFetch(fixture: CatalogFixture, calls: Request[] = []): (input: Request | string | URL) => Promise<Response> {
  return (input) => respond(calls, fixture, input);
}

/** How the fixture answers one route of the catalog contract. */
type CatalogRoute = (fixture: CatalogFixture, body: Record<string, unknown>) => unknown;

const CATALOG_ROUTES: Readonly<Record<string, CatalogRoute>> = {
  '/catalog/resolve': (fixture, body) => resolveFor(fixture, body),
  '/catalog/geocode': (fixture, body) => fixture.geocode?.[text(body.query)] ?? { candidates: [] },
  '/catalog/points-by-bangumi-id': (fixture, body) => pointsResult(rowsFor(fixture, fixture.works?.[text(body.bangumi_id)])),
  '/catalog/nearby': (fixture, body) => ({ rows: rowsFor(fixture, fixture.nearby?.[`${text(body.lat)},${text(body.lng)}`]) }),
  '/catalog/itinerary': (fixture, body) => itineraryFor(fixture, body.point_ids),
};

async function respond(calls: Request[], fixture: CatalogFixture, input: Request | string | URL): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input);
  calls.push(request);
  const route = CATALOG_ROUTES[new URL(request.url).pathname];
  if (route === undefined) throw new Error(`prefix test catalog received an unexpected request: ${request.url}`);
  return Response.json(route(fixture, objectOf(await request.clone().json())));
}

function resolveFor(fixture: CatalogFixture, body: Record<string, unknown>): ResolveOutcome {
  return fixture.resolve?.[text(body.query)] ?? { outcome: 'not_found', reason: 'anime_not_found' };
}

function rowsFor(fixture: CatalogFixture, ids: readonly string[] | undefined): Point[] {
  return (ids ?? []).map((id) => requirePoint(fixture, id));
}

function requirePoint(fixture: CatalogFixture, id: string): Point {
  const point = fixture.pointsById?.[id];
  if (point === undefined) throw new Error(`prefix test catalog has no point "${id}"`);
  return point;
}

function pointsResult(rows: Point[]): Record<string, unknown> {
  return { rows, synced_at: '2026-09-17T00:00:00.000Z' };
}

function itineraryFor(fixture: CatalogFixture, ids: unknown): Itinerary {
  const ordered = (Array.isArray(ids) ? ids : []).map((id) => requirePoint(fixture, text(id)));
  return { ordered_points: ordered, point_count: ordered.length,
    timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: 'normal' } };
}

function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('catalog request body must be an object');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`expected a scalar request field, got ${JSON.stringify(value)}`);
  return String(value);
}
