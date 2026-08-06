import test from "node:test";
import assert from "node:assert/strict";
import { guardTurnstile, verifySiteverify } from "./turnstile.ts";
import { createTurnstileGate } from "./turnstile.ts";
import { ENV, ID, request, unreachable, htmlGateway, withErrorLog } from "./turnstile-doubles.ts";

// ── siteverify outages (issue #447 review, P1-3) ───────────────────────────
// Before this, a rejected fetch or a 502 HTML body escaped `verifySiteverify`
// as an unhandled rejection and every anonymous turn became a bare 500.

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
  assert.ok(result !== null && "errorCodes" in result);
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
    return attempts === 1
      ? unreachable(input, init)
      : Promise.resolve(Response.json({ success: false }));
  };
  const gate = createTurnstileGate({ fetchImpl: flaky, now: () => 0 });
  const { result } = await withErrorLog(async () => {
    await guardTurnstile(request("t1"), ENV, gate, ID);
    return guardTurnstile(request("t1"), ENV, gate, ID);
  });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 403);
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
