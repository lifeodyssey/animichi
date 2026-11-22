/**
 * SUT: the gateway's request ID (`src/gateway/request-id.ts`, wired in `src/app.ts`). Every request
 * gets one ID at entry; every structured record the gateway writes for it carries that ID as
 * `request_id`; the users and public catalog forwards send it to the service on `X-Request-Id`; the
 * response returns it under the same name. A caller's own `X-Request-Id` or `cf-ray` is never it.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { forwardUsers } from "../src/gateway/forward.ts";
import { alertNativeRateLimitOutage } from "../src/protect/native-limiter.ts";
import { createTurnstileGate } from "../src/protect/turnstile.ts";
import { collectingCtx, gatewayEnv, stubCtx } from "./doubles/entry-env.ts";
import { withCacheDouble, type CacheApiDouble } from "./doubles/cache-api-double.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";

const HEADER = "X-Request-Id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a caller may send: a well-formed ID of its own choosing, and a ray of its own choosing. */
const CALLER_CHOSEN = { [HEADER]: "0f0f0f0f-0000-4000-8000-000000000000", "cf-ray": "8f1f0b0c3d5e6a7b-NRT" };

const verified = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
const rejected = () => Promise.resolve({ ok: false, reason: "invalid" } as const);

type GatewayRecord = Record<string, unknown>;

/** Runs `run` with both console channels the gateway writes its records to captured, in order. */
async function withRecords<T>(run: () => Promise<T> | T): Promise<{ value: T; records: GatewayRecord[] }> {
  const lines: string[] = [];
  const { warn, error } = console;
  console.warn = (line: unknown) => { lines.push(String(line)); };
  console.error = (line: unknown) => { lines.push(String(line)); };
  try {
    const value = await run();
    return { value, records: lines.map((line) => JSON.parse(line) as GatewayRecord) };
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

function idOf(response: Response): string {
  return response.headers.get(HEADER) ?? "";
}

/** A service binding that records what the gateway sent it and answers 200. */
function recordingBinding(forwarded: Request[]) {
  return { fetch: (request: Request) => { forwarded.push(request); return Promise.resolve(new Response("ok")); } };
}

void test("every record of one request carries the ID its response returns, not the caller's", async () => {
  const app = createWorkerApp({ authenticate: rejected });
  const { value: response, records } = await withRecords(() =>
    app.request("/v1/users/saved-routes", { headers: CALLER_CHOSEN }, gatewayEnv(), stubCtx));
  assert.match(idOf(response), UUID);
  assert.notEqual(idOf(response), CALLER_CHOSEN[HEADER]);
  assert.deepEqual(records.map((record) => [record.event, record.request_id]), [
    ["edge_gateway_request_start", idOf(response)],
    ["edge_auth_invalid_credential", idOf(response)],
    ["edge_gateway_request", idOf(response)],
  ]);
});

void test("users never receives a caller's X-Request-Id, even from a forward with no request around it", async () => {
  const forwarded: Request[] = [];
  const request = new Request("https://animichi.test/v1/users/saved-routes", { headers: CALLER_CHOSEN });
  await forwardUsers(gatewayEnv({ USERS: recordingBinding(forwarded) }), request, { userId: "u1", userType: "human" });
  assert.equal(forwarded[0]?.headers.get(HEADER), null);
});

void test("users receives the gateway's ID in place of the caller's", async () => {
  const forwarded: Request[] = [];
  const env = gatewayEnv({ USERS: recordingBinding(forwarded) });
  const response = await createWorkerApp({ authenticate: verified })
    .request("/v1/users/saved-routes", { headers: CALLER_CHOSEN }, env, stubCtx);
  assert.match(idOf(response), UUID);
  assert.equal(forwarded[0]?.headers.get(HEADER), idOf(response));
});

void test("the public catalog read sends catalog the same ID", async () => {
  const forwarded: Request[] = [];
  const env = gatewayEnv({ CATALOG: recordingBinding(forwarded) });
  const response = await createWorkerApp({}).request("/catalog/public/popular", { headers: CALLER_CHOSEN }, env, stubCtx);
  assert.match(idOf(response), UUID);
  assert.equal(forwarded[0]?.headers.get(HEADER), idOf(response));
});

// The users read below is held open on its answer while a second request runs start to finish, so
// the records interleave: an ID kept anywhere but the request's own scope would cross over.
void test("two overlapping requests each keep their own ID", async () => {
  const usersAnswer = Promise.withResolvers<Response>();
  const app = createWorkerApp({ authenticate: verified });
  const env = gatewayEnv({ USERS: { fetch: () => usersAnswer.promise } });
  const { value: [held, quick], records } = await withRecords(async () => {
    const pending = app.request("/v1/users/saved-routes", {}, env, stubCtx);
    const answered = await app.request("/healthz", {}, env, stubCtx);
    usersAnswer.resolve(new Response("ok"));
    return [await pending, answered] as const;
  });
  assert.notEqual(idOf(held), idOf(quick));
  assert.deepEqual(records.map((record) => record.request_id), [idOf(held), idOf(quick), idOf(quick), idOf(held)]);
});

/** A cache that keeps every entry it is given and answers each lookup with the first one. */
function keepingCache(stored: Response[]): CacheApiDouble {
  return {
    match: () => Promise.resolve(stored[0]?.clone()),
    put: (_key, response) => { stored.push(response); return Promise.resolve(); },
  };
}

const TILES = { MAP_TILES: { get: () => Promise.resolve({ body: new Response("mvt").body, etag: "t", size: 3 }) } };

void test("a cache hit answers with its own request's ID, and the cache entry carries none", async () => {
  const stored: Response[] = [];
  const settled: Promise<unknown>[] = [];
  const tile = () => withCacheDouble(keepingCache(stored), () =>
    edgeAppRequest("/tiles/14/135/892.mvt", TILES, {}, collectingCtx(settled)));
  const first = await tile();
  await Promise.all(settled);
  const hit = await tile();
  assert.match(idOf(hit), UUID);
  assert.notEqual(idOf(hit), idOf(first));
  assert.equal(stored.length, 1, "the second request was answered from the cache");
  assert.equal(stored[0]?.headers.get(HEADER), null);
});

const absent = () => Promise.resolve({ ok: false, reason: "absent" } as const);
const ANONYMOUS = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000" };
const unreachableSiteverify = createTurnstileGate({ fetchImpl: () => Promise.reject(new Error("network down")), now: () => 0 });

/** Records written deep inside a request — by the limiter and the Turnstile gate — each with a
 * request that makes its site write it. */
const DEEP_RECORDS: [string, () => Promise<Response> | Response][] = [
  ["edge_native_rate_limit_alert", () => createWorkerApp({}).request("/catalog/public/popular", {}, gatewayEnv({
    RATE_LIMITER: { limit: () => Promise.reject(new Error("binding down")) }, CATALOG: recordingBinding([]),
  }), stubCtx)],
  ["edge_turnstile_secret_missing", () => createWorkerApp({ authenticate: absent })
    .request("/v1/chat", { method: "POST" }, gatewayEnv({ ...ANONYMOUS, TURNSTILE_SECRET: "" }), stubCtx)],
  ["edge_turnstile_siteverify_unavailable", () => createWorkerApp({ authenticate: absent, turnstileGate: unreachableSiteverify })
    .request("/v1/chat", { method: "POST", headers: { "cf-turnstile-response": "token-fixture-000" } },
      gatewayEnv({ ...ANONYMOUS, TURNSTILE_SECRET: "test-secret-not-a-real-value" }), stubCtx)],
];

for (const [event, run] of DEEP_RECORDS) {
  void test(`the ${event} record carries its request's ID`, async () => {
    const { value: response, records } = await withRecords(run);
    assert.match(idOf(response), UUID);
    assert.equal(records.find((record) => record.event === event)?.request_id, idOf(response));
  });
}

void test("a record written after its request has ended carries no ID", async () => {
  const { records } = await withRecords(async () => {
    await createWorkerApp({}).request("/healthz", {}, gatewayEnv(), stubCtx);
    alertNativeRateLimitOutage("public-read");
  });
  assert.match(String(records[0]?.request_id), UUID);
  assert.deepEqual(records.at(-1), { event: "edge_native_rate_limit_alert", key: "public-read" });
});
