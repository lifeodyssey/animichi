import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  makeApp,
  post,
  testEnv,
  type ApplyOutcome,
} from "./migrate.worker.helpers";

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate bounded apply", () => {
  it("reports a non-zero apply exit as a failure response", async () => {
    const { app, token } = await makeApp({
      applyChain: (): Promise<ApplyOutcome> => Promise.resolve({ kind: "failure", exitCode: 3 }),
    });
    const response = await app.request(post({}, token), {}, testEnv());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, exitCode: 3, appliedHead: null });
  });

  it("returns success with a null applied head when the ledger is empty", async () => {
    const { app, token } = await makeApp({
      readAppliedHead: (): Promise<string | null> => Promise.resolve(null),
    });
    const response = await app.request(post({}, token), {}, testEnv());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, exitCode: 0, appliedHead: null, pathVerification: "verified",
    });
  });

  it("sanitizes an unexpected apply failure", async () => {
    const { app, token } = await makeApp({
      applyChain: (): Promise<ApplyOutcome> => Promise.reject(new Error("password=fixture")),
    });
    const response = await app.request(post({}, token), {}, testEnv());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "migration_unavailable" });
  });
});
