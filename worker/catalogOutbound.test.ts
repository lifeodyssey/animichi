import test from "node:test";
import assert from "node:assert/strict";
import { catalogOutbound } from "./app.ts";
import { CATALOG_OUTBOUND_ALLOWLIST } from "./catalogPolicy.ts";

const EXPECTED_CATALOG_CALLS = [
  "POST /catalog/search",
  "POST /catalog/resolve",
  "POST /catalog/points-by-work-id",
  "POST /catalog/spots",
  "POST /catalog/nearby",
  "POST /catalog/geocode",
  "POST /catalog/route",
];

function catalogEnv(received: Request[]): never {
  return {
    CATALOG: {
      fetch: (request: Request) => {
        received.push(request);
        return Promise.resolve(new Response("catalog"));
      },
    },
  } as never;
}

void test("catalog outbound policy exactly matches the agent client", () => {
  assert.deepEqual([...CATALOG_OUTBOUND_ALLOWLIST], EXPECTED_CATALOG_CALLS);
});

void test("catalog outbound forwards every allowlisted method and path", async () => {
  const received: Request[] = [];
  for (const route of EXPECTED_CATALOG_CALLS) {
    const [method, pathname] = route.split(" ");
    const request = new Request(`http://catalog.internal${pathname}`, { method });
    assert.equal((await catalogOutbound(request, catalogEnv(received))).status, 200);
  }
  assert.equal(received.length, EXPECTED_CATALOG_CALLS.length);
});

void test("catalog outbound rejects a write path outside the allowlist", async () => {
  const received: Request[] = [];
  const request = new Request("http://catalog.internal/catalog/publish", { method: "POST" });
  const response = await catalogOutbound(request, catalogEnv(received));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "catalog_request_forbidden" });
  assert.equal(received.length, 0);
});

void test("catalog outbound matches method as well as path", async () => {
  const received: Request[] = [];
  const request = new Request("http://catalog.internal/catalog/search", { method: "GET" });
  assert.equal((await catalogOutbound(request, catalogEnv(received))).status, 403);
  assert.equal(received.length, 0);
});
