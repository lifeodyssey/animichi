import { vi } from "vitest";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import {
  ANITABI_POINTS,
  MISS_POINTS,
  MISS_TITLE,
  MISS_WORK_ID,
  NEW_TITLE,
} from "./fixtures/integration-suite-seed";

/**
 * The anitabi arm of these stubs answers the EGRESS SERVICE's routes, not the
 * upstream's (#1792): the catalog no longer calls api.anitabi.cn directly, so a
 * stub that still routed on `/points/detail` would be answering a URL nothing
 * requests. Routing on the egress base keeps the stub honest about which hop it
 * is standing in for.
 */
function isEgress(url: string): boolean {
  return url.startsWith(ANITABI_EGRESS_BASE_URL);
}

/**
 * Route every upstream call to a canned response. The neon serverless driver
 * rides global fetch too (Phase B: the DB channel is HTTP), so its `/sql`
 * traffic passes through to the real fetch, init included.
 */
export function stubFetch(route: (url: string) => Response): void {
  const realFetch = globalThis.fetch;
  const stub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes("/sql")) return realFetch(input, init);
    return Promise.resolve(route(url));
  });
  vi.stubGlobal("fetch", stub);
}

/** Stub upstream JSON for the NEW work: a Bangumi subject + two Anitabi points. */
export function stubUpstream(): void {
  stubFetch(newWorkResponse);
}

function newWorkResponse(url: string): Response {
  if (url.includes("/v0/subjects/")) return jsonResponse({ name: NEW_TITLE, name_cn: "轻音少女" });
  if (isEgress(url) && url.includes("/anitabi/points/")) return relayedResponse(ANITABI_POINTS);
  throw new Error(`unexpected upstream url: ${url}`);
}

/**
 * Stub upstream JSON for the search-miss work: the Bangumi SEARCH (POST
 * /v0/search/subjects) resolves the title to MISS_WORK_ID, then the subject +
 * Anitabi points feed the on-demand ingest. Records calls so the test can prove
 * the SECOND search is an alias hit (no re-resolve, no re-ingest).
 */
export function stubSearchMiss(): { urls: string[] } {
  const urls: string[] = [];
  stubFetch((url) => {
    urls.push(url);
    return searchMissResponse(url);
  });
  return { urls };
}

/** Route a stubbed upstream URL to its canned response for the search-miss flow.
 * The miss path now resolves the id, fetches the Anitabi `/lite` preview, then
 * (synchronously here, since the Node harness has no ExecutionContext.waitUntil)
 * runs the full ingest off `/points/detail`. Both anitabi calls go through the
 * egress service, so both answers carry its relayed marker. */
function searchMissResponse(url: string): Response {
  if (url.includes("/v0/search/subjects")) return jsonResponse({ data: [{ id: Number(MISS_WORK_ID), name: MISS_TITLE }] });
  if (isEgress(url) && url.includes("/anitabi/lite/")) {
    return relayedResponse({ pointsLength: MISS_POINTS.length, litePoints: MISS_POINTS });
  }
  if (url.includes("/v0/subjects/")) return jsonResponse({ name: MISS_TITLE, name_cn: "吹响吧！上低音号" });
  if (isEgress(url) && url.includes("/anitabi/points/")) return relayedResponse(MISS_POINTS);
  throw new Error(`unexpected upstream url: ${url}`);
}

/** Build a minimal fetch `Response` carrying `body` as JSON. */
export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A response as the egress service relays it (#1792): the upstream's own status
 * and body, under the service's `relayed-upstream` marker. The catalog refuses
 * any anitabi answer without that marker — an answer that did not come through
 * the service is not one it will accept.
 */
function relayedResponse(body: unknown): Response {
  const response = jsonResponse(body);
  response.headers.set("x-egress-response", "relayed-upstream");
  return response;
}

export function unresolvableResponse(url: string): Response {
  if (url.includes("/v0/search/subjects")) return jsonResponse({ data: [] });
  throw new Error(`unexpected upstream url: ${url}`);
}
