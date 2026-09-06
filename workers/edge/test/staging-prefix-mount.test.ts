/**
 * E-1 (#1380): where the prefix-seeding procedure exists, and who reaches it.
 *
 * Two doors, and this file is the first one plus the credential. `APP_ENV`
 * decides whether the route exists at all — anything but the literal `staging`
 * leaves the request on the ordinary `/v1` path, which on production is a
 * container that has never served it — and a verified Neon Auth bearer decides
 * whether a caller may use it. The OWNERSHIP door is past this seam, inside the
 * Durable Object (`trajectory-prefix-seed.test.ts`), and the SIZE bound on the
 * body admitted here is `staging-prefix-body-bound.test.ts`.
 *
 * test-type: api (routing contract of the deployed request surface).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { WorkerDeps } from "../src/app.ts";
import { stagingPrefixRoute } from "../src/gateway/staging-prefix-route.ts";
import { AUTHED, makeStagingPrefixHarness, SEED_PATH } from "./doubles/make-staging-prefix-harness.ts";
import { makePrefixBody } from "./doubles/make-trajectory-prefix.ts";

const BODY = JSON.stringify(makePrefixBody());

const ANONYMOUS_CALLER: WorkerDeps = {
  authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
};

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
  const harness = makeStagingPrefixHarness("staging", AUTHED);

  const response = await harness.post(SEED_PATH, BODY);

  assert.equal(response.status, 200);
  assert.equal(harness.seeded.length, 1);
  assert.deepEqual(harness.forwarded, []);
});

void test("the durable object is handed the verified identity and the caller's own body", async () => {
  const harness = makeStagingPrefixHarness("staging", AUTHED);

  await harness.post(SEED_PATH, BODY);

  const seeding = harness.seeded.at(0);
  assert.ok(seeding !== undefined, "the session was handed one request");
  assert.equal(seeding.headers.get("X-Seed-Identity-Id"), "qa-neon-user");
  assert.equal(seeding.headers.get("X-Seed-Session-Id"), "session-42");
  assert.equal(await seeding.text(), BODY);
});

void test("a caller with no verified bearer is refused and reaches no session", async () => {
  const harness = makeStagingPrefixHarness("staging", ANONYMOUS_CALLER);

  const response = await harness.post(SEED_PATH, BODY);

  assert.equal(response.status, 401);
  assert.deepEqual(harness.seeded, []);
});

void test("on production the path is not this Worker's and reaches no session", async () => {
  const harness = makeStagingPrefixHarness("production", AUTHED);

  await harness.post(SEED_PATH, BODY);

  assert.deepEqual(harness.seeded, []);
  assert.equal(harness.forwarded.length, 1);
});

void test("on production the request answers whatever the container says, which is 404", async () => {
  const harness = makeStagingPrefixHarness("production", AUTHED);

  const response = await harness.post(SEED_PATH, BODY);

  assert.equal(response.status, 404);
});
