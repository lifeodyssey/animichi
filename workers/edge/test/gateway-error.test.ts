/**
 * EG-06 (#1343): what an UNEXPECTED throw does to the gateway.
 *
 * Anything thrown past `refusable()` — an unbound namespace, a missing DSN, a
 * Durable Object stub rejection — used to become Hono's default plain-text 500,
 * outside every envelope, and `observe()` never ran: the request that failed
 * was exactly the one with no `edge_gateway_request` line. These cases pin the
 * opposite — the shared envelope, a completion record, and one structured
 * `edge_gateway_error` that names the failure without repeating its message.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";

/** A server-side message of exactly the kind that must never reach a client. */
const THROWN_MESSAGE = "connect ECONNREFUSED postgres://svc:hunter2@db.internal/agent";

function throwingEnv(): never {
  return {
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => Promise.reject(new TypeError(THROWN_MESSAGE)) }),
    },
  } as never;
}

async function withWarnSpy(
  run: () => Promise<Response>,
): Promise<{ response: Response; lines: string[] }> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { lines.push(String(line)); };
  try {
    return { response: await run(), lines };
  } finally {
    console.warn = original;
  }
}

function recordsIn(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function failingRequest(): Promise<Response> {
  return createWorkerApp({}).request("/v1/search/preview?q=chichibu", {}, throwingEnv(), stubCtx);
}

void test("an unexpected throw answers the shared envelope, not Hono's plain-text 500", async () => {
  const { response } = await withWarnSpy(failingRequest);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "internal_error", message: "The gateway could not complete this request." },
  });
});

void test("the request that failed still leaves a completion record", async () => {
  const { lines } = await withWarnSpy(failingRequest);
  const completion = recordsIn(lines).find((record) => record.event === "edge_gateway_request");
  assert.ok(completion, "a thrown dispatch must not be the one request with no completion line");
  assert.equal(completion.class, "v1");
  assert.equal(completion.status, 500);
  assert.equal(typeof completion.duration_ms, "number");
});

void test("the failure is logged once as a structured error naming class, status and error name", async () => {
  const { lines } = await withWarnSpy(failingRequest);
  const failures = recordsIn(lines).filter((record) => record.event === "edge_gateway_error");
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0], { event: "edge_gateway_error", class: "v1", status: 500, error: "TypeError" });
});

void test("neither the answer nor the log repeats the thrown message", async () => {
  const { response, lines } = await withWarnSpy(failingRequest);
  assert.equal(lines.join("\n").includes("hunter2"), false, "a thrown message may name a DSN or a stack");
  assert.equal((await response.text()).includes("hunter2"), false);
});
