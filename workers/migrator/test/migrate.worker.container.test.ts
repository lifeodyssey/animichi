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
