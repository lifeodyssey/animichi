import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { stubCtx } from "./doubles/entry-env.ts";

// SUT: `nativeClient`'s one load of Prisma's runtime per isolate (`src/native-client.ts`), seen
// through two of its callers at once: the conversation list route and a session start. The load
// imports `src/prisma-runtime-surface.ts`, which fails to load here. Node's module mock evaluates a
// mocked module again on every import, so the slice's count is the number of loads asked for; one
// level down, a module whose evaluation threw would keep its error and count once either way.
// Concurrent first uses share one load, and a load that failed stays failed: a later use gets the
// first failure, and nothing is loaded again.

const loads = { asked: 0 };
mock.module("../src/prisma-runtime-surface.ts", { exports: { get postgres() {
  loads.asked += 1;
  throw new Error(`Prisma's runtime failed to load (attempt ${String(loads.asked)})`);
} } });
const { bootstrapNativeSession } = await import("../src/agent/host/native-bootstrap.ts");
const { createWorkerApp } = await import("../src/app.ts");

/** A loopback port nothing listens on, though no use here gets as far as a connection. */
const ENV = { EDGE_SHOWCASE_MODE: "false", AGENT_SVC_DATABASE_URL: "postgres://unit:unit@127.0.0.1:1/unit" } as never;
/** A use that never settles fails here rather than holding the lane. */
const HANG_BOUND_MS = 30_000;
const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: true, userId: "owner", userType: "human" } as const) });
const startSession = () => bootstrapNativeSession(ENV, "session", BACKGROUND_CONTEXT).catch((error: unknown) => error);

void test("importing the Worker's database callers loads nothing", () => {
  assert.equal(loads.asked, 0);
});

void test("concurrent first uses share one load, and a later use gets its failure without loading again", { timeout: HANG_BOUND_MS }, async () => {
  const [listed, firstFailure] = await Promise.all([app.request("/v1/conversations", {}, ENV, stubCtx), startSession()]);
  assert.equal(listed.status, 500);
  assert.ok(firstFailure instanceof Error);
  assert.equal(await startSession(), firstFailure);
  assert.equal(loads.asked, 1);
});
