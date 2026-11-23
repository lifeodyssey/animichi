/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins today's `X-Request-Id` on every class of answer the gateway gives —
 * success, forward, origin answer, 404, HEAD, 405, every refusal, a limiter
 * outage, an unexpected failure (500) and a streamed body still open — each
 * sent with a well-formed `X-Request-Id` of the caller's own choosing. Every
 * answer carries exactly one ID: a fresh lowercase UUID that is never the
 * caller's, even when the upstream answer carried an ID of its own.
 *
 * What the gateway sends its services, and what its log records carry, is
 * pinned in `gateway-request-id.test.ts`.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN, SOLVED, UNVERIFIABLE } from "./doubles/entry-seam.ts";
import { LIMITED, UNLIMITED, type LimiterPlan } from "./doubles/entry-seam-limiters.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CALLERS_OWN = "0f0f0f0f-0000-4000-8000-000000000000";
const UPSTREAMS_OWN = "1e1e1e1e-0000-4000-8000-000000000000";
const SHARD_DOWN: LimiterPlan = { coarse: Number.POSITIVE_INFINITY, durable: "down" };
const UNREACHABLE_USERS = { USERS: { fetch: () => Promise.reject(new TypeError("binding unreachable")) } };

type Answer = readonly [answer: string, method: string, path: string, headers: Readonly<Record<string, string>>,
  vars: Readonly<Record<string, unknown>>, plan: LimiterPlan, status: number];

const ANSWERS: readonly Answer[] = [
  ["a success", "GET", "/healthz", {}, {}, UNLIMITED, 200],
  ["a forward", "GET", "/v1/users/saved-routes", HUMAN, {}, UNLIMITED, 200],
  ["an agent-tier answer", "POST", "/v1/chat", HUMAN, {}, UNLIMITED, 200],
  ["a new visitor's turn, whose answer gains an aid", "POST", "/v1/chat", SOLVED, {}, UNLIMITED, 200],
  ["an origin answer that carried its own ID", "GET", "/img/a.jpg?plan=h160", {}, {}, UNLIMITED, 200],
  ["an empty tile", "GET", "/tiles/14/135/893.mvt", {}, {}, UNLIMITED, 204],
  ["a verification with no body", "POST", "/v1/turnstile/verify", HUMAN, {}, UNLIMITED, 204],
  ["a 404", "GET", "/unknown", {}, {}, UNLIMITED, 404],
  ["a HEAD of the readiness probe", "HEAD", "/healthz", {}, {}, UNLIMITED, 200],
  ["a 405", "GET", "/v1/sessions/adopt", HUMAN, {}, UNLIMITED, 405],
  ["an asset arm's refusal", "GET", "/tiles/", {}, {}, UNLIMITED, 404],
  ["a credential refusal", "GET", "/v1/users/saved-routes", {}, {}, UNLIMITED, 401],
  ["an uncheckable credential", "GET", "/v1/users/saved-routes", UNVERIFIABLE, {}, UNLIMITED, 503],
  ["a Turnstile refusal", "POST", "/v1/chat", {}, {}, UNLIMITED, 403],
  ["a showcase refusal", "POST", "/v1/chat", HUMAN, { EDGE_SHOWCASE_MODE: "true" }, UNLIMITED, 403],
  ["a rate limit", "POST", "/v1/chat", HUMAN, {}, LIMITED, 429],
  ["a limiter outage", "POST", "/v1/chat", HUMAN, {}, SHARD_DOWN, 503],
  ["an unexpected failure", "GET", "/v1/users/saved-routes", HUMAN, UNREACHABLE_USERS, UNLIMITED, 500],
];

for (const [answer, method, path, headers, vars, plan, status] of ANSWERS) {
  void test(`${answer} (${String(status)}) carries one fresh request ID, never the caller's`, async (t) => {
    const seam = entrySeam(t, plan, vars);
    const response = await seam.send(method, path, { ...headers, "X-Request-Id": CALLERS_OWN });
    assert.equal(response.status, status);
    assert.match(response.headers.get("X-Request-Id") ?? "", UUID);
    assert.notEqual(response.headers.get("X-Request-Id"), CALLERS_OWN);
    assert.notEqual(response.headers.get("X-Request-Id"), UPSTREAMS_OWN);
  });
}

void test("two requests carry two different IDs", async (t) => {
  const seam = entrySeam(t);
  const first = await seam.send("GET", "/healthz");
  const second = await seam.send("GET", "/healthz");
  assert.notEqual(first.headers.get("X-Request-Id"), second.headers.get("X-Request-Id"));
});

/** A server-sent stream that has sent its first frame and never closes on its own. */
function openEventStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start: (controller) => { controller.enqueue(new TextEncoder().encode("data: first\n\n")); } });
}

void test("a streamed answer carries its ID while its body is still open, and its first frame arrives unbuffered", async (t) => {
  const answer = new Response(openEventStream(), { headers: { "Content-Type": "text/event-stream" } });
  const seam = entrySeam(t, UNLIMITED, { USERS: { fetch: () => Promise.resolve(answer) } });
  const response = await seam.send("GET", "/v1/users/saved-routes", { ...HUMAN, "X-Request-Id": CALLERS_OWN });
  assert.match(response.headers.get("X-Request-Id") ?? "", UUID);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.ok(response.body);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.ok(first.value instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
  await reader.cancel();
});
