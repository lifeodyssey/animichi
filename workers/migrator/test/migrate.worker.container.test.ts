import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  makeApp,
  post,
  testEnv,
  type ContainerOutcome,
} from "./migrate.worker.helpers";

// #1051 — migrator HTTP-seam container-outcome tests: exit-code mapping, the
// hung-container 504, the empty-ledger null head, and the health probe.

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate — container outcomes", () => {
  it("reports a non-zero container exit as a failure response", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> => Promise.resolve({ kind: "failure", exitCode: 3 }),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, exitCode: 3, appliedHead: null });
  });

  it("answers 504 when the container hangs past the timeout", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> => Promise.resolve({ kind: "timeout" }),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ success: false, error: "timeout" });
  });

  it("returns success with a null applied head when the ledger has no revisions row", async () => {
    const { app, token } = await makeApp({
      readAppliedHead: (): Promise<string | null> => Promise.resolve(null),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, exitCode: 0, appliedHead: null });
  });
});

it("exposes /healthz", async () => {
  const { app } = await makeApp();
  const res = await app.request("https://migrator.test/healthz", {}, testEnv());
  expect(res.status).toBe(200);
});

describe("GET /ledger-head - read-only applied-head report (post-staging smoke)", () => {
  // #1052 (AC5): the post-staging smoke compares the migrator's reported
  // applied head to the expected target. The endpoint is read-only (its only
  // capability is `SELECT version FROM public.atlas_schema_revisions ... LIMIT 1`
  // via the ledger reader) and the migration head equals the newest committed
  // migrations/neon basename, so it is unauthenticated - no stored credential,
  // no OIDC requirement on the smoke path.
  it("reports the applied head read from the ledger", async () => {
    const { app } = await makeApp({
      readAppliedHead: (): Promise<string | null> => Promise.resolve("20260814191301_turn_idempotency_outbox"),
    });
    const res = await app.request("https://migrator.test/ledger-head", {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ head: "20260814191301_turn_idempotency_outbox" });
  });

  it("reports a null head when the ledger has no revisions row", async () => {
    const { app } = await makeApp({
      readAppliedHead: (): Promise<string | null> => Promise.resolve(null),
    });
    const res = await app.request("https://migrator.test/ledger-head", {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ head: null });
  });

  it("answers 503 when the migrator DSN is not configured", async () => {
    const { app } = await makeApp();
    const res = await app.request("https://migrator.test/ledger-head", {}, {});
    expect(res.status).toBe(503);
  });
});
