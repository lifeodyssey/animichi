import test from "node:test";
import assert from "node:assert/strict";
import {
  TURNSTILE_HEADER,
  createTurnstileGate,
  guardTurnstile,
  verifySiteverify,
} from "./turnstile.ts";

// The siteverify side of the Turnstile gate (issue #447): what happens when
// the secret is missing, the verdict body is malformed or not strictly
// `success: true`, and siteverify itself is unreachable (outage → fail-open,
// never cached, abort signal so a hang cannot stall a turn). The gate-level
// ACs (pass window, replay, retryable envelopes) live in turnstile.test.ts —
// split by concern to keep every test file at or below 200 lines.

const ENV = { TURNSTILE_SECRET: "test-secret-not-a-real-value" };
/** The anonymous identity the pass window is scoped to (issue #447). */
const ID = "anon_0123456789abcdef0123456789abcdef";

interface Call {
  readonly url: string;
  readonly contentType: string | null;
  readonly body: URLSearchParams;
}

/** A siteverify stub that records every call and answers with a fixed verdict. */
function stubFetch(calls: Call[], success: boolean, errorCodes: string[] = []): typeof fetch {
  return (input, init) => {
    const rawBody = init?.body;
    const body = new URLSearchParams(rawBody instanceof URLSearchParams ? rawBody.toString() : typeof rawBody === "string" ? rawBody : "");
    const headers = new Headers(init?.headers);
    calls.push({ url: input instanceof Request ? input.url : input.toString(), contentType: headers.get("Content-Type"), body });
    return Promise.resolve(Response.json({ success, "error-codes": errorCodes }));
  };
}

function request(token?: string): Request {
  const headers = new Headers({ "CF-Connecting-IP": "203.0.113.7" });
  if (token !== undefined) headers.set(TURNSTILE_HEADER, token);
  return new Request("https://animichi.test/v1/chat", { method: "POST", headers });
}

/** P2-1 (#447 review): an environment with anonymous access on and no secret
 * rejects everyone; that must be distinguishable from a bot wave in the logs. */
// test-type: unit
void test("a missing secret is recorded at the edge and never sent to siteverify", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => 0 });
  const { result, records } = await withErrorLog(() => guardTurnstile(request("t1"), { TURNSTILE_SECRET: "" }, gate, ID));
  assert.equal(result?.status, 403);
  assert.deepEqual(JSON.parse(String(records[0])), { event: "edge_turnstile_secret_missing" });
  assert.equal(calls.length, 0);
});

// test-type: unit
void test("the missing-secret rejection still discloses nothing to the caller", async () => {
  const gate = createTurnstileGate({ fetchImpl: stubFetch([], true), now: () => 0 });
  const { result } = await withErrorLog(() => guardTurnstile(request("t1"), { TURNSTILE_SECRET: "" }, gate, ID));
  assert.ok(result);
  const body = await result.text();
  assert.match(body, /"code":"turnstile_required"/);
  assert.doesNotMatch(body, /secret/i);
});

// test-type: unit
void test("a non-object siteverify body is treated as a failure", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(Response.json("nope"));
  const result = await verifySiteverify("t1", "203.0.113.7", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errorCodes, ["bad-siteverify-response"]);
});

// test-type: unit
void test("non-string siteverify error codes are dropped", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(Response.json({ success: false, "error-codes": ["bad-request", 42] }));
  const result = await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.deepEqual(result.errorCodes, ["bad-request"]);
});

// The gate must be strict about `success === true`, not merely non-false. A
// siteverify outage or contract drift can answer `{}` or `{"success":"true"}`;
// a loosened check (`!== false`) would let both through and open the gate on an
// upstream failure. Without these two cases that mutation survives every test.
// test-type: unit
void test("a siteverify body with no success field fails closed", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(Response.json({}));
  const result = await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.equal(result.ok, false);
});

// test-type: unit
void test("a stringly-typed success value fails closed", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(Response.json({ success: "true" }));
  const result = await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.equal(result.ok, false);
});

// ── siteverify outages (issue #447 review, P1-3) ───────────────────────────
// Before this, a rejected fetch or a 502 HTML body escaped `verifySiteverify`
// as an unhandled rejection and every anonymous turn became a bare 500.

/** Capture console.error while running an outage case. */
async function withErrorLog<T>(run: () => Promise<T>) {
  const records: string[] = [];
  const original = console.error;
  console.error = (line: unknown) => { records.push(String(line)); };
  try {
    return { result: await run(), records };
  } finally {
    console.error = original;
  }
}

const unreachable: typeof fetch = () => Promise.reject(new Error("network down"));
const htmlGateway: typeof fetch = () =>
  Promise.resolve(new Response("<html>502</html>", { status: 502 }));

/** A siteverify that fails once (outage) then answers a fixed denial; the
 * attempt counter is how the never-cached invariant is observable. */
function flakySiteverify() {
  let attempts = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    attempts += 1;
    return attempts === 1 ? unreachable(input, init) : Promise.resolve(Response.json({ success: false }));
  };
  return { fetchImpl, count: () => attempts };
}

// test-type: unit
void test("an unreachable siteverify fails OPEN rather than 500ing the turn", async () => {
  const { result, records } = await withErrorLog(() =>
    verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, unreachable),
  );
  assert.deepEqual(result, { ok: true, errorCodes: ["siteverify-unavailable"] });
  assert.deepEqual(JSON.parse(String(records[0])), {
    event: "edge_turnstile_siteverify_unavailable",
    reason: "unreachable",
  });
});

// test-type: unit
void test("a non-JSON siteverify body is an outage, not an unhandled rejection", async () => {
  const { result } = await withErrorLog(() =>
    verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, htmlGateway),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.errorCodes, ["siteverify-unavailable"]);
});

// test-type: unit
void test("an outage lets the turn through the guard instead of throwing", async () => {
  const gate = createTurnstileGate({ fetchImpl: unreachable, now: () => 0 });
  const { result } = await withErrorLog(() => guardTurnstile(request("t1"), ENV, gate, ID));
  assert.equal(result, null);
});

// test-type: unit
void test("the fail-open verdict is never cached — verification resumes at once", async () => {
  const { fetchImpl, count } = flakySiteverify();
  const gate = createTurnstileGate({ fetchImpl, now: () => 0 });
  const { result } = await withErrorLog(async () => {
    await guardTurnstile(request("t1"), ENV, gate, ID);
    return guardTurnstile(request("t1"), ENV, gate, ID);
  });
  assert.equal(result?.status, 403);
  assert.equal(count(), 2);
});

// test-type: unit
void test("siteverify is called with an abort signal so a hang cannot stall a turn", async () => {
  let signal: AbortSignal | null | undefined;
  const capture: typeof fetch = (_input, init) => {
    signal = init?.signal;
    return Promise.resolve(Response.json({ success: true }));
  };
  await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, capture);
  assert.ok(signal instanceof AbortSignal);
});
