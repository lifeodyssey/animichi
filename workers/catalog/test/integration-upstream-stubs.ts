import { vi } from "vitest";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import { ANITABI_POINTS, NEW_TITLE } from "./fixtures/integration-suite-seed";

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
 * Route every upstream call to a canned response. The database is not one of
 * them: `pg` speaks to it over its own socket, never through `fetch`.
 */
export function stubFetch(route: (url: string) => Response): void {
  const stub = vi.fn((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
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
export function relayedResponse(body: unknown): Response {
  const response = jsonResponse(body);
  response.headers.set("x-egress-response", "relayed-upstream");
  return response;
}
