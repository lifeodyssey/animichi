/**
 * EG-06 (#1343): what an UNEXPECTED throw does to the gateway.
 *
 * Anything thrown past the tier's own refusal handling — a failing secret-store
 * read, an unbound namespace, a Durable Object stub rejection — used to become Hono's
 * default plain-text 500, outside every envelope, and `observe()` never ran: the
 * request that failed was exactly the one with no `edge_gateway_request` line. These
 * cases pin the opposite — the shared envelope, a completion record, and one
 * structured `edge_gateway_error` that names the failure without repeating its
 * message.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "./doubles/entry-env.ts";

/** A server-side message of exactly the kind that must never reach a client. */
const THROWN_MESSAGE = "connect ECONNREFUSED postgres://svc:hunter2@db.internal/agent";

/** The native transcript read resolves its DSN from the bound secret before it opens
 * anything. #1604 deleted the container-forwarded route this file used to drive (and
 * #1605 takes `forwardV1` and the `CONTAINER` binding with it), so the surviving
 * dependency whose rejection reaches `app.onError` is that secret read: the binding
 * below fails the way a real one does when the store is unreachable. The typed uuid
 * keeps the request past the route's own validation, so the throw is the one under
 * test rather than a deliberate 404. */
const TRANSCRIPT = "/v1/conversations/6f1a4c2e-8f3b-4d5a-9c7e-2b1d0a4e5f60/messages";

function throwingEnv(): never {
  return {
    EDGE_SHOWCASE_MODE: "false",
    AGENT_SVC_DATABASE_URL: { get: () => Promise.reject(new TypeError(THROWN_MESSAGE)) },
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

/** The edge's own verdict for a verified caller. The transcript GET is an unmanaged
 * read, so nothing (no guard binding, no container) stands between the tier and the
 * failing secret read. */
const verified = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);

async function failingRequest(): Promise<Response> {
  return createWorkerApp({ authenticate: verified }).request(
    TRANSCRIPT, { method: "GET" }, throwingEnv(), stubCtx,
  );
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
