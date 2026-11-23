/**
 * SUT: the budget latch's two calls to the guard, `budgetLatched` and
 * `latchBudget` (`src/protect/cost-breaker.ts`), when the guard's binding
 * (`EDGE_GUARD`) is missing, a configuration error. Each behaves as it does when
 * the guard is down: the read answers "not latched", the write is skipped, and
 * each writes the one record that names the binding and carries the request's
 * ID. No route reaches either call with the binding missing, because the durable
 * limiter answers first, so each runs in a one-route app behind the gateway's
 * request-ID middleware, on an env that binds nothing.
 *
 * test-type: unit
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Env } from "../src/env.ts";
import { requestIdScope } from "../src/gateway/request-id.ts";
import { budgetLatched, latchBudget } from "../src/protect/cost-breaker.ts";

const DAY = "2026-11-24";
const BINDING = "EDGE_GUARD";

/** Every line written from here on, through either console channel. */
function logged(t: TestContext): string[] {
  const lines: string[] = [];
  const keep = (line: unknown): void => { lines.push(String(line)); };
  t.mock.method(console, "warn", keep);
  t.mock.method(console, "error", keep);
  return lines;
}

/** The logged lines that name the binding, as the records they are. */
function namingTheBinding(lines: readonly string[]): Record<string, unknown>[] {
  return lines.filter((line) => line.includes(BINDING)).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** One request to an app that answers through `serve` behind the request-ID middleware, with no bindings at all. */
function unboundRequest(serve: (guard: Env["EDGE_GUARD"]) => Promise<Response>): Promise<Response> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", requestIdScope);
  app.get("/", (c) => serve(c.env.EDGE_GUARD));
  return Promise.resolve(app.request("/", {}, {}));
}

void test("the latch read with the guard binding missing answers not latched and logs one record", async (t) => {
  const lines = logged(t);
  const response = await unboundRequest(async (guard) => Response.json({ latched: await budgetLatched(guard, DAY) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { latched: false });
  const requestId = response.headers.get("X-Request-Id");
  assert.deepEqual(namingTheBinding(lines), [{ event: "edge_guard_binding_missing", binding: BINDING, request_id: requestId }]);
});

void test("the latch write with the guard binding missing is skipped and logs one record", async (t) => {
  const lines = logged(t);
  const response = await unboundRequest(async (guard) => { await latchBudget(guard, DAY); return new Response(null, { status: 204 }); });
  assert.equal(response.status, 204);
  const requestId = response.headers.get("X-Request-Id");
  assert.deepEqual(namingTheBinding(lines), [{ event: "edge_guard_binding_missing", binding: BINDING, request_id: requestId }]);
});
