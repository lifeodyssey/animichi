/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins the alert record (`edge_native_rate_limit_alert`) each metered
 * class writes about its coarse damper (`RATE_LIMITER`) today. A damper whose
 * call fails, or a binding that is not a rate limiter at all, is stepped over
 * and alerted once with the caller's key and the request's ID: on a durable
 * route before its shard is asked (whatever the shard then says), and on the
 * public catalog read. An absent binding is stepped over with no alert on
 * either route. How each class answers these outages is pinned in
 * `gateway-entry-limiter-outage.test.ts`.
 *
 * test-type: characterization
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN, VISITOR } from "./doubles/entry-seam.ts";
import { UNLIMITED, type LimiterPlan } from "./doubles/entry-seam-limiters.ts";

const ALERT = "edge_native_rate_limit_alert";
const DAMPER_DOWN: LimiterPlan = { coarse: "down", durable: Number.POSITIVE_INFINITY };
const BOTH_DOWN: LimiterPlan = { coarse: "down", durable: "down" };
const NOT_A_RATE_LIMITER = { RATE_LIMITER: {} };
const ABSENT = { RATE_LIMITER: undefined };
const CALLERS = { "a verified caller": HUMAN, "an admitted visitor": ADMITTED, "a reader": {} };
const USERS = "/v1/users/saved-routes";
const POPULAR = "/catalog/public/popular";

type DamperCase = readonly [damper: string, plan: LimiterPlan, vars: Readonly<Record<string, unknown>>, method: string,
  path: string, caller: keyof typeof CALLERS, status: number, alertedKeys: readonly string[]];

const CASES: readonly DamperCase[] = [
  ["down", DAMPER_DOWN, {}, "POST", "/v1/chat", "a verified caller", 200, ["authed:u1"]],
  ["down", DAMPER_DOWN, {}, "POST", "/v1/chat", "an admitted visitor", 200, [VISITOR]],
  ["down", DAMPER_DOWN, {}, "POST", USERS, "a verified caller", 200, ["authed:u1"]],
  ["down, and the durable shard too", BOTH_DOWN, {}, "POST", "/v1/chat", "a verified caller", 503, ["authed:u1"]],
  ["down", DAMPER_DOWN, {}, "GET", POPULAR, "a reader", 200, ["public-read"]],
  ["not a rate limiter", UNLIMITED, NOT_A_RATE_LIMITER, "POST", "/v1/chat", "a verified caller", 200, ["authed:u1"]],
  ["not a rate limiter", UNLIMITED, NOT_A_RATE_LIMITER, "GET", POPULAR, "a reader", 200, ["public-read"]],
  ["absent", UNLIMITED, ABSENT, "POST", "/v1/chat", "a verified caller", 200, []],
  ["absent", UNLIMITED, ABSENT, "POST", "/v1/chat", "an admitted visitor", 200, []],
  ["absent", UNLIMITED, ABSENT, "GET", POPULAR, "a reader", 200, []],
];

/** Every line the gateway logs through `console.warn` from here on. */
function warnings(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, "warn", (line: unknown) => { lines.push(String(line)); });
  return lines;
}

/** The damper alert records among the logged lines. */
function alerts(lines: readonly string[]): unknown[] {
  return lines.map((line) => JSON.parse(line) as { event: string }).filter((record) => record.event === ALERT);
}

for (const [damper, plan, vars, method, path, caller, status, alertedKeys] of CASES) {
  void test(`with the damper ${damper}, ${method} ${path} from ${caller} answers ${String(status)}, alerting [${alertedKeys.join(", ")}]`, async (t) => {
    const lines = warnings(t);
    const seam = entrySeam(t, plan, vars);
    const response = await seam.send(method, path, CALLERS[caller]);
    assert.equal(response.status, status);
    const requestId = response.headers.get("X-Request-Id");
    assert.deepEqual(alerts(lines), alertedKeys.map((key) => ({ event: ALERT, key, request_id: requestId })));
  });
}
