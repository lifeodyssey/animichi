/**
 * E-1 (#1380): where the prefix-seeding procedure exists, and who reaches it.
 *
 * Two doors, and this file is the first one plus the credential. `APP_ENV`
 * decides whether the route exists at all — anything but the literal `staging`
 * leaves the request on the ordinary `/v1` path, which on production is a
 * container that has never served it — and a verified Neon Auth bearer decides
 * whether a caller may use it. The OWNERSHIP door is past this seam, inside the
 * Durable Object (`trajectory-prefix-seed.test.ts`).
 *
 * test-type: api (routing contract of the deployed request surface).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, type WorkerDeps } from "../src/app.ts";
import { PREFIX_MAX_BYTES } from "@animichi/contract/staging-prefix-path";
import { stagingPrefixRoute } from "../src/gateway/staging-prefix-route.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { makePrefixBody } from "./doubles/make-trajectory-prefix.ts";

const NOW = Date.UTC(2026, 8, 6, 9, 0, 0);
const SEED_PATH = "/v1/staging/sessions/session-42/prefix";
const BODY = JSON.stringify(makePrefixBody());

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

const AUTHED: WorkerDeps = {
  authenticate: () => Promise.resolve({ ok: true, userId: "qa-neon-user", userType: "human" } as const),
};

const ANONYMOUS_CALLER: WorkerDeps = {
  authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
};

interface Harness {
  readonly post: (path: string, body: string) => Promise<Response>;
  /** Every request the session's Durable Object was handed. */
  readonly seeded: Request[];
  /** Every request forwarded to the Python container instead. */
  readonly forwarded: Request[];
}

function makeHarness(appEnv: string | undefined, deps: WorkerDeps): Harness {
  const seeded: Request[] = [];
  const forwarded: Request[] = [];
  const app = createWorkerApp(deps);
  const env = {
    APP_ENV: appEnv,
    AGENT_TURN_ROUTE: "edge",
    EDGE_SHOWCASE_MODE: "false",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_GUARD: fakeGuard(NOW).namespace,
    AGENT_SESSION: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          seeded.push(request);
          return Promise.resolve(Response.json({ session_id: "session-42", seeded: true }));
        },
      }),
    },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (request: Request) => {
          forwarded.push(request);
          return Promise.resolve(new Response("container", { status: 404 }));
        },
      }),
    },
  } as never;
  const post = async (path: string, body: string): Promise<Response> =>
    await app.request(path, { method: "POST", body }, env, stubCtx);
  return { seeded, forwarded, post };
}

void test("only the literal staging mounts the route", () => {
  const mounted = stagingPrefixRoute("staging", "POST", SEED_PATH);
  assert.deepEqual(mounted, { sessionId: "session-42" });
});

void test("production, unset, empty and a case variant all mount nothing", () => {
  const positions = ["production", undefined, "", "Staging", "staging-2"];
  const mounted = positions.map((position) => stagingPrefixRoute(position, "POST", SEED_PATH));
  assert.deepEqual(mounted, [null, null, null, null, null]);
});

void test("the route is a POST on the exact path shape and nothing else", () => {
  assert.equal(stagingPrefixRoute("staging", "GET", SEED_PATH), null);
  assert.equal(stagingPrefixRoute("staging", "POST", "/v1/staging/sessions//prefix"), null);
  assert.equal(stagingPrefixRoute("staging", "POST", "/v1/staging/sessions/a/b/prefix"), null);
  assert.equal(stagingPrefixRoute("staging", "POST", "/v1/staging/sessions/session-42/prefix/more"), null);
});

void test("the session id is decoded out of the path", () => {
  const mounted = stagingPrefixRoute("staging", "POST", "/v1/staging/sessions/a%2Fb/prefix");
  assert.deepEqual(mounted, { sessionId: "a/b" });
});

void test("on staging an authenticated seeding reaches the session's durable object", async () => {
  const harness = makeHarness("staging", AUTHED);

  const response = await harness.post(SEED_PATH, BODY);

  assert.equal(response.status, 200);
  assert.equal(harness.seeded.length, 1);
  assert.deepEqual(harness.forwarded, []);
});

void test("the durable object is handed the verified identity and the caller's own body", async () => {
  const harness = makeHarness("staging", AUTHED);

  await harness.post(SEED_PATH, BODY);

  const seeding = harness.seeded.at(0);
  assert.ok(seeding !== undefined, "the session was handed one request");
  assert.equal(seeding.headers.get("X-Seed-Identity-Id"), "qa-neon-user");
  assert.equal(seeding.headers.get("X-Seed-Session-Id"), "session-42");
  assert.equal(await seeding.text(), BODY);
});

void test("a caller with no verified bearer is refused and reaches no session", async () => {
  const harness = makeHarness("staging", ANONYMOUS_CALLER);

  const response = await harness.post(SEED_PATH, BODY);

  assert.equal(response.status, 401);
  assert.deepEqual(harness.seeded, []);
});

void test("on production the path is not this Worker's and reaches no session", async () => {
  const harness = makeHarness("production", AUTHED);

  await harness.post(SEED_PATH, BODY);

  assert.deepEqual(harness.seeded, []);
  assert.equal(harness.forwarded.length, 1);
});

void test("on production the request answers whatever the container says, which is 404", async () => {
  const harness = makeHarness("production", AUTHED);

  const response = await harness.post(SEED_PATH, BODY);

  assert.equal(response.status, 404);
});

/** A body over `PREFIX_MAX_BYTES`, padded inside the seeded user text. */
function makeOversizedBody(): string {
  const prefix = { ...(makePrefixBody() as Record<string, unknown>), user_text: "あ".repeat(PREFIX_MAX_BYTES) };
  return JSON.stringify(prefix);
}

void test("a seeding body over the cap is refused before any session sees it", async () => {
  const harness = makeHarness("staging", AUTHED);

  const response = await harness.post(SEED_PATH, makeOversizedBody());

  assert.equal(response.status, 413);
  assert.deepEqual(harness.seeded, []);
});

void test("the cap counts bytes, so a body under it in characters can still be refused", async () => {
  const harness = makeHarness("staging", AUTHED);
  const body = makeOversizedBody();

  await harness.post(SEED_PATH, body);

  assert.ok(body.length < PREFIX_MAX_BYTES * 2, "the body is well under the cap in characters");
  assert.ok(new TextEncoder().encode(body).length > PREFIX_MAX_BYTES, "and over it in bytes");
});
