import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";

// SUT: when `nativeClient` validates the emitted data-plane contract (`src/native-client.ts`): on the
// first use that needs a client, once per isolate, never while the Worker's modules load. Prisma's
// `contractFromJson` is mocked to refuse the contract, so the modules load, the first session start
// rejects with the refusal, and a later one rejects with the same refusal without validating again.
// A refusal used to stop the Worker starting; it now fails the first request that opens the database,
// which `bundle-smoke/sealed-prisma-load.test.ts` drives in the sealed release.

const refusal = new Error("the emitted contract failed validation");
const validations = { count: 0 };
mock.module("@prisma/orm-postgres/static", { exports: { contractFromJson: () => {
  validations.count += 1;
  throw refusal;
} } });
const { bootstrapNativeSession } = await import("../src/agent/host/native-bootstrap.ts");

/** A loopback port nothing listens on, though no use here gets as far as a connection. */
const ENV = { AGENT_SVC_DATABASE_URL: "postgres://unit:unit@127.0.0.1:1/unit" } as never;
/** A use that never settles fails here rather than holding the lane. */
const HANG_BOUND_MS = 30_000;
const startSession = () => bootstrapNativeSession(ENV, "session", BACKGROUND_CONTEXT).catch((error: unknown) => error);

void test("the Worker's modules load without validating the contract", () => {
  assert.equal(validations.count, 0);
});

void test("the first session start rejects with the refusal, and a later one with the same, validating once", { timeout: HANG_BOUND_MS }, async () => {
  assert.equal(await startSession(), refusal);
  assert.equal(await startSession(), refusal);
  assert.equal(validations.count, 1);
});
