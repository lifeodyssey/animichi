import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { alwaysAllowGuard, envWithContainer, stubCtx } from "../src/container/entry-env.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { signedAidCookie } from "./doubles/signed-anonymous-cookie.ts";
import { ADOPTION_ANON_ENV, DEFAULT_ADOPTION_RESULT, adoptionStore } from "./doubles/session-adoption-doubles.ts";
import { type SessionAdoptionResult } from "../src/identity/session-adopt.ts";

const ADOPTION_URL = "/v1/sessions/adopt";
const authOk = () => Promise.resolve({ ok: true, userId: "real-user-1", userType: "human" } as const);

/** The native route's env. No CONTAINER binding is supplied on purpose: the
 * adoption and chat tiers answer in process, so a forward would surface instead
 * of passing unnoticed. The 405 case supplies one to prove it stays untouched. */
function nativeRouteEnv() {
  return { ...ADOPTION_ANON_ENV, EDGE_GUARD: alwaysAllowGuard } as never;
}

/** One test's adoption route: the real worker app wired to a store double that
 * counts writes and records every `adopt(fromAnonId, toUserId)` pair, plus the
 * two POST drivers bound to it. */
function adoptionRoute(result: SessionAdoptionResult = DEFAULT_ADOPTION_RESULT) {
  const writes = { count: 0 };
  const calls: [string, string][] = [];
  const app = createWorkerApp({ authenticate: authOk, sessionAdoption: adoptionStore(writes, result, calls) });
  const post = (headers: Record<string, string>) =>
    app.request(ADOPTION_URL, { method: "POST", headers }, nativeRouteEnv(), stubCtx);
  const postAs = async (anonId: string, extraHeaders: Record<string, string> = {}) =>
    post({ Cookie: await signedAidCookie(anonId), ...extraHeaders });
  return { writes, calls, post, postAs };
}

void test("a valid aid cookie is resolved as the adoption source, exactly", async () => {
  const route = adoptionRoute();
  const anonId = "anon_" + "a".repeat(32);
  const res = await route.postAs(anonId);
  assert.equal(res.status, 200);
  assert.deepEqual(route.calls, [[anonId, "real-user-1"]]);
});

void test("a non-POST adopt request answers 405 and is never forwarded (SESSION-2 #960)", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const res = await app.request(ADOPTION_URL, { method: "GET" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 405);
  assert.equal(cap.req, undefined);
});

// The missing-identity branch is its own unit seam: it must answer the distinct
// `no_anonymous_identity` class without opening the store at all, so a
// fall-through that writes (or replays) fails here before any database.
void test("no aid cookie answers no_anonymous_identity with zero store writes", async () => {
  const route = adoptionRoute();
  const res = await route.post({});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { adopted: 0, noop_class: "no_anonymous_identity", revisions_bumped: 0 });
  assert.equal(route.writes.count, 0);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("a tampered aid cookie is a no-op, and no Set-Cookie is added", async () => {
  const route = adoptionRoute();
  const res = await route.post({ Cookie: `aid=${"a".repeat(32)}.${"b".repeat(64)}` });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { adopted: 0, noop_class: "no_anonymous_identity", revisions_bumped: 0 });
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("a client-forged X-Anon-Id cannot replace the cookie identity", async () => {
  const route = adoptionRoute();
  const anonId = "anon_" + "c".repeat(32);
  await route.postAs(anonId, { "X-Anon-Id": "anon_" + "f".repeat(32) });
  assert.deepEqual(route.calls, [[anonId, "real-user-1"]]);
});

// Owner ruling (#507) REVERSING S1.7 rev5 P2-b: the adoption no longer retires
// the `aid` cookie. Retiring it minted a fresh identity on the next anonymous
// turn and reset the per-identity quota, making "exhaust quota -> free login ->
// log out -> new allowance" a loop the D12 banner walks visitors into. After a
// successful adoption the anonymous identity owns nothing anyway, so what a
// shared browser inherits is an empty identity plus the day's quota count --
// which is the point. Asserted on BOTH outcomes so a re-introduction fails here.

void test("a successful adoption does NOT retire the aid cookie (#507 reversal)", async () => {
  const route = adoptionRoute();
  const res = await route.postAs("anon_" + "d".repeat(32));
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("the surviving identity keeps working: a later anonymous turn reuses it", async () => {
  const route = adoptionRoute();
  const anonId = "anon_" + "d".repeat(32);
  const adopted = await route.postAs(anonId);
  assert.equal(adopted.headers.get("Set-Cookie"), null);
  await route.postAs(anonId);
  assert.deepEqual(route.calls, [[anonId, "real-user-1"], [anonId, "real-user-1"]]);
});

void test("a no-op adoption (adopted: 0, noop_class: no_rows) sets no cookie either", async () => {
  const route = adoptionRoute({ adopted: 0, noop_class: "no_rows", revisions_bumped: 0 });
  const res = await route.postAs("anon_" + "e".repeat(32));
  assert.deepEqual(await res.json(), { adopted: 0, noop_class: "no_rows", revisions_bumped: 0 });
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("an adoption-only X-Anon-Id header cannot replace the native chat identity", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: authOk, agentTurns: nativeAgentReceiver(calls) });
  const anonId = "anon_" + "b".repeat(32);
  const res = await app.request(
    "/v1/chat", { method: "POST", headers: { Cookie: await signedAidCookie(anonId), "X-Anon-Id": anonId } },
    nativeRouteEnv(), stubCtx,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0]?.identity, { userId: "real-user-1", userType: "human" });
});
