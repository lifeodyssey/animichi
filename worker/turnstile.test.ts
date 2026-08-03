import test from "node:test";
import assert from "node:assert/strict";
import {
  TURNSTILE_HEADER,
  type TurnstileResult,
  createTurnstileGate,
  guardTurnstile,
  verifySiteverify,
} from "./turnstile.ts";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
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
    const bodyText = rawBody instanceof URLSearchParams ? rawBody.toString() : typeof rawBody === "string" ? rawBody : "";
    const body = new URLSearchParams(bodyText);
    const headers = new Headers(init?.headers);
    const inputUrl = input instanceof Request ? input.url : input.toString();
    calls.push({ url: inputUrl, contentType: headers.get("Content-Type"), body });
    return Promise.resolve(Response.json({ success, "error-codes": errorCodes }));
  };
}

function request(token?: string): Request {
  const headers = new Headers({ "CF-Connecting-IP": "203.0.113.7" });
  if (token !== undefined) headers.set(TURNSTILE_HEADER, token);
  return new Request("https://animichi.test/v1/chat", { method: "POST", headers });
}

/** The composition S1.8 (#274) will mount: guard first, forward only on pass. */
async function anonymousV1(
  req: Request,
  gate: ReturnType<typeof createTurnstileGate>,
  forward: () => Response,
): Promise<Response> {
  const denied = await guardTurnstile(req, ENV, gate, ID);
  return denied ?? forward();
}

void test("AC1: a solved token verifies at siteverify and the turn is forwarded", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => 0 });
  let forwarded = 0;
  const res = await anonymousV1(request("solved-token"), gate, () => {
    forwarded += 1;
    return new Response("container");
  });
  assert.equal(await res.text(), "container");
  assert.equal(forwarded, 1);
  assert.equal(calls.length, 1);
});

void test("AC1: the siteverify call matches the canonical contract exactly", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => 0 });
  await guardTurnstile(request("solved-token"), ENV, gate, ID);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, SITEVERIFY_URL);
  assert.equal(call.contentType, "application/x-www-form-urlencoded");
  assert.equal(call.body.get("secret"), ENV.TURNSTILE_SECRET);
  assert.equal(call.body.get("response"), "solved-token");
  assert.equal(call.body.get("remoteip"), "203.0.113.7");
});

void test("AC3: an invalid token is rejected 403 and never reaches the container", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({
    fetchImpl: stubFetch(calls, false, ["invalid-input-response"]),
    now: () => 0,
  });
  let forwarded = 0;
  const res = await anonymousV1(request("forged-token"), gate, () => {
    forwarded += 1;
    return new Response("container");
  });
  assert.equal(res.status, 403);
  assert.equal(forwarded, 0);
});

void test("AC3: the rejection envelope is retryable and leaks no siteverify codes", async () => {
  const gate = createTurnstileGate({
    fetchImpl: stubFetch([], false, ["invalid-input-secret"]),
    now: () => 0,
  });
  const res = await guardTurnstile(request("expired-token"), ENV, gate, ID);
  assert.ok(res);
  const body = await res.text();
  assert.match(body, /"code":"turnstile_required"/);
  assert.match(body, /"retryable":true/);
  assert.doesNotMatch(body, /invalid-input-secret/);
});

void test("AC3: a missing token is rejected without calling siteverify at all", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => 0 });
  const res = await guardTurnstile(request(), ENV, gate, ID);
  assert.equal(res?.status, 403);
  assert.equal(calls.length, 0);
});

/** Mocked clock: the window is measured against `now`, never real time. */
function clockGate(clock: { ms: number }, calls: Call[]) {
  return createTurnstileGate({
    fetchImpl: stubFetch(calls, true),
    now: () => clock.ms,
    windowMs: 60_000,
  });
}

void test("AC2: the same token is not re-verified for later turns inside the window", async () => {
  const clock = { ms: 1_000 };
  const calls: Call[] = [];
  const gate = clockGate(clock, calls);
  assert.equal(await guardTurnstile(request("t1"), ENV, gate, ID), null);
  clock.ms = 30_000;
  assert.equal(await guardTurnstile(request("t1"), ENV, gate, ID), null);
  clock.ms = 60_000;
  assert.equal(await guardTurnstile(request("t1"), ENV, gate, ID), null);
  assert.equal(calls.length, 1);
});

void test("AC2: once the window closes the token is verified again", async () => {
  const clock = { ms: 1_000 };
  const calls: Call[] = [];
  const gate = clockGate(clock, calls);
  await guardTurnstile(request("t1"), ENV, gate, ID);
  clock.ms = 61_001;
  await guardTurnstile(request("t1"), ENV, gate, ID);
  assert.equal(calls.length, 2);
});

void test("AC2: a different token inside the window is verified on its own", async () => {
  const clock = { ms: 1_000 };
  const calls: Call[] = [];
  const gate = clockGate(clock, calls);
  await guardTurnstile(request("t1"), ENV, gate, ID);
  await guardTurnstile(request("t2"), ENV, gate, ID);
  assert.equal(calls.length, 2);
});

/** P1-1 (#447 review): the window must not be a cross-identity pass. */
void test("another identity replaying the same token is verified again", async () => {
  const clock = { ms: 1_000 };
  const calls: Call[] = [];
  const gate = clockGate(clock, calls);
  assert.equal(await guardTurnstile(request("t1"), ENV, gate, ID), null);
  await guardTurnstile(request("t1"), ENV, gate, "anon_ffffffffffffffffffffffffffffffff");
  assert.equal(calls.length, 2);
});

void test("a replay whose siteverify verdict is timeout-or-duplicate is rejected", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({
    fetchImpl: stubFetch(calls, false, ["timeout-or-duplicate"]),
    now: () => 0,
  });
  const res = await guardTurnstile(request("t1"), ENV, gate, "anon_ffffffffffffffffffffffffffffffff");
  assert.equal(res?.status, 403);
});

/** P2-1 (#447 review): an environment with anonymous access on and no secret
 * rejects everyone; that must be distinguishable from a bot wave in the logs. */
void test("a missing secret is recorded at the edge and never sent to siteverify", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => 0 });
  const records: string[] = [];
  const original = console.error;
  console.error = (line: unknown) => { records.push(String(line)); };
  try {
    const res = await guardTurnstile(request("t1"), { TURNSTILE_SECRET: "" }, gate, ID);
    assert.equal(res?.status, 403);
  } finally {
    console.error = original;
  }
  assert.deepEqual(JSON.parse(String(records[0])), { event: "edge_turnstile_secret_missing" });
  assert.equal(calls.length, 0);
});

void test("the missing-secret rejection still discloses nothing to the caller", async () => {
  const gate = createTurnstileGate({ fetchImpl: stubFetch([], true), now: () => 0 });
  const original = console.error;
  console.error = () => undefined;
  try {
    const res = await guardTurnstile(request("t1"), { TURNSTILE_SECRET: "" }, gate, ID);
    assert.ok(res);
    const body = await res.text();
    assert.match(body, /"code":"turnstile_required"/);
    assert.doesNotMatch(body, /secret/i);
  } finally {
    console.error = original;
  }
});

void test("a failed verification is never cached", async () => {
  const clock = { ms: 0 };
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, false), now: () => clock.ms });
  await guardTurnstile(request("t1"), ENV, gate, ID);
  await guardTurnstile(request("t1"), ENV, gate, ID);
  assert.equal(calls.length, 2);
});

void test("a non-object siteverify body is treated as a failure", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(Response.json("nope"));
  const result = await verifySiteverify("t1", "203.0.113.7", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errorCodes, ["bad-siteverify-response"]);
});

void test("non-string siteverify error codes are dropped", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(Response.json({ success: false, "error-codes": ["bad-request", 42] }));
  const result = await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.deepEqual(result.errorCodes, ["bad-request"]);
});

void test("a request without CF-Connecting-IP still verifies with an empty remoteip", async () => {
  const calls: Call[] = [];
  const gate = createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => 0 });
  const req = new Request("https://animichi.test/v1/chat", {
    method: "POST",
    headers: { [TURNSTILE_HEADER]: "t1" },
  });
  await guardTurnstile(req, ENV, gate, ID);
  assert.equal(calls[0]?.body.get("remoteip"), "");
});

// The gate must be strict about `success === true`, not merely non-false. A
// siteverify outage or contract drift can answer `{}` or `{"success":"true"}`;
// a loosened check (`!== false`) would let both through and open the gate on an
// upstream failure. Without these two cases that mutation survives every test.
void test("a siteverify body with no success field fails closed", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(Response.json({}));
  const result = await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.equal(result.ok, false);
});

void test("a stringly-typed success value fails closed", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(Response.json({ success: "true" }));
  const result = await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, fetchImpl);
  assert.equal(result.ok, false);
});

// Pin the shared contract value to Cloudflare's canonical wire name.
void test("the token header is literally cf-turnstile-response", () => {
  assert.equal(TURNSTILE_HEADER, "cf-turnstile-response");
});

// ── siteverify outages (issue #447 review, P1-3) ───────────────────────────
// Before this, a rejected fetch or a 502 HTML body escaped `verifySiteverify`
// as an unhandled rejection and every anonymous turn became a bare 500.

/** Capture console.error while running an outage case. */
async function withErrorLog(run: () => Promise<TurnstileResult | Response | null>) {
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

void test("a non-JSON siteverify body is an outage, not an unhandled rejection", async () => {
  const { result } = await withErrorLog(() =>
    verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, htmlGateway),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.errorCodes, ["siteverify-unavailable"]);
});

void test("an outage lets the turn through the guard instead of throwing", async () => {
  const gate = createTurnstileGate({ fetchImpl: unreachable, now: () => 0 });
  const { result } = await withErrorLog(() => guardTurnstile(request("t1"), ENV, gate, ID));
  assert.equal(result, null);
});

void test("the fail-open verdict is never cached — verification resumes at once", async () => {
  let attempts = 0;
  const flaky: typeof fetch = (input, init) => {
    attempts += 1;
    return attempts === 1 ? unreachable(input, init) : Response.json({ success: false });
  };
  const gate = createTurnstileGate({ fetchImpl: flaky, now: () => 0 });
  const { result } = await withErrorLog(async () => {
    await guardTurnstile(request("t1"), ENV, gate, ID);
    return guardTurnstile(request("t1"), ENV, gate, ID);
  });
  assert.equal((result as Response | null)?.status, 403);
  assert.equal(attempts, 2);
});

void test("siteverify is called with an abort signal so a hang cannot stall a turn", async () => {
  let signal: AbortSignal | null | undefined;
  const capture: typeof fetch = (_input, init) => {
    signal = init?.signal;
    return Promise.resolve(Response.json({ success: true }));
  };
  await verifySiteverify("t1", "", ENV.TURNSTILE_SECRET, capture);
  assert.ok(signal instanceof AbortSignal);
});
