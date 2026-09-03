/**
 * W1-4 (#1253): the production `CatalogClient` over the private `CATALOG`
 * service binding.
 *
 * Spec Appendix D forbids reaching our own infrastructure by URL, so this
 * adapter is asserted on the hop it makes — binding, method, path, body — and
 * on the failures it is allowed to degrade. The clock is mocked: `sleep` is
 * injected exactly as `gateway/forward.ts` injects it, so the retry backoff is
 * recorded rather than waited on.
 *
 * test-type: unit (no network, no real clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CatalogUnavailableError } from "../src/agent/tools/catalog-client.ts";
import {
  CATALOG_REQUEST_TIMEOUT_MS,
  CATALOG_TOOL_TIMEOUT_MS,
  CATALOG_TOTAL_TIMEOUT_MS,
} from "../src/agent/tools/catalog-timeouts.ts";
import { retryDelayMs, serviceBindingCatalog } from "../src/agent/tools/service-binding-catalog.ts";
import { WASHINOMIYA } from "./doubles/catalog-payloads.ts";

/** One request the adapter made, as the binding saw it. */
interface SeenRequest {
  method: string;
  pathname: string;
  body: string;
}

/** A binding that answers from a queue and records what it was asked. */
function recordingBinding(responses: Response[]) {
  const seen: SeenRequest[] = [];
  const waits: number[] = [];
  const binding = {
    fetch: async (request: Request): Promise<Response> => {
      seen.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        body: await request.text(),
      });
      const next = responses.shift();
      assert.ok(next, "the adapter made more requests than the test scripted");
      return next;
    },
  };
  const sleep = (ms: number): Promise<void> => {
    waits.push(ms);
    return Promise.resolve();
  };
  return { binding, sleep, seen, waits };
}

/** A JSON response with the given status. */
function json(body: object, status = 200): Response {
  return Response.json(body, { status });
}

void test("the timeout ladder stays strictly nested, as Python asserted it", () => {
  const ladder: number[] = [CATALOG_REQUEST_TIMEOUT_MS, CATALOG_TOTAL_TIMEOUT_MS, CATALOG_TOOL_TIMEOUT_MS];
  assert.deepEqual([...ladder].sort((left, right) => left - right), ladder);
  assert.equal(new Set(ladder).size, ladder.length);
});

void test("the backoff grows exponentially and is capped where tenacity capped it", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(retryDelayMs), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
});

void test("a resolve goes to the binding as a POST on the allowlisted path", async () => {
  const scripted = recordingBinding([json({ outcome: "not_found", reason: "anime_not_found" })]);
  await serviceBindingCatalog(scripted.binding, scripted.sleep).resolve("らき☆すた");
  assert.deepEqual(scripted.seen, [
    { method: "POST", pathname: "/catalog/resolve", body: '{"query":"らき☆すた"}' },
  ]);
});

void test("nearby unwraps the rows the catalog wraps them in", async () => {
  const scripted = recordingBinding([json({ rows: [WASHINOMIYA] })]);
  const rows = await serviceBindingCatalog(scripted.binding, scripted.sleep).nearby({ lat: 36.1, lng: 139.6 }, 5_000);
  assert.deepEqual(rows, [WASHINOMIYA]);
  assert.equal(scripted.seen[0]?.body, '{"lat":36.1,"lng":139.6,"radius_m":5000}');
});

void test("an itinerary without pacing sends no pacing field at all", async () => {
  const scripted = recordingBinding([json({ ordered_points: [], point_count: 1, timed_itinerary: {} })]);
  await serviceBindingCatalog(scripted.binding, scripted.sleep).planItinerary(["spot-1"], undefined);
  assert.equal(scripted.seen[0]?.body, '{"point_ids":["spot-1"]}');
});

void test("a 503 is retried up to the attempt budget, then degrades", async () => {
  const scripted = recordingBinding([json({}, 503), json({}, 503), json({}, 503)]);
  const catalog = serviceBindingCatalog(scripted.binding, scripted.sleep);
  await assert.rejects(() => catalog.resolve("らき☆すた"), CatalogUnavailableError);
  assert.equal(scripted.seen.length, 3);
  assert.deepEqual(scripted.waits, [1_000, 2_000]);
});

void test("a 429 is retried and the retry can succeed", async () => {
  const scripted = recordingBinding([json({}, 429), json({ outcome: "not_found", reason: "anime_not_found" })]);
  const outcome = await serviceBindingCatalog(scripted.binding, scripted.sleep).resolve("らき☆すた");
  assert.equal(outcome.outcome, "not_found");
  assert.deepEqual(scripted.waits, [1_000]);
});

void test("a 400 is the catalog's answer, not a hiccup, and is never retried", async () => {
  const scripted = recordingBinding([json({ error: "bad request" }, 400)]);
  const catalog = serviceBindingCatalog(scripted.binding, scripted.sleep);
  await assert.rejects(() => catalog.resolve(""), CatalogUnavailableError);
  assert.equal(scripted.seen.length, 1);
  assert.deepEqual(scripted.waits, []);
});

void test("an outcome the tools cannot branch on fails instead of reaching the model", async () => {
  const scripted = recordingBinding([json({ outcome: "maybe" })]);
  const catalog = serviceBindingCatalog(scripted.binding, scripted.sleep);
  await assert.rejects(() => catalog.resolve("らき☆すた"), /could not answer/);
});

void test("a geocode answer without candidates fails rather than reporting no places", async () => {
  const scripted = recordingBinding([json({})]);
  const catalog = serviceBindingCatalog(scripted.binding, scripted.sleep);
  await assert.rejects(() => catalog.geocode("久喜", 5), CatalogUnavailableError);
});

void test("an aborted turn stops the adapter instead of spending its retries", async () => {
  const scripted = recordingBinding([]);
  const controller = new AbortController();
  controller.abort();
  const catalog = serviceBindingCatalog(scripted.binding, scripted.sleep);
  await assert.rejects(() => catalog.resolve("らき☆すた", controller.signal));
  assert.deepEqual(scripted.seen, []);
});
