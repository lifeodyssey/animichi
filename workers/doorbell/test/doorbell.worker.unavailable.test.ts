import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BuildsClient } from "../src/builds";
import {
  FIXED_NOW,
  STAGING_SHA,
  getStatus,
  makeApp,
  post,
  testEnv,
} from "./doorbell.worker.helpers";

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

function boom(): Promise<never> {
  return Promise.reject(new Error("jwks timeout leaked"));
}

function unavailableStartBuilds(): BuildsClient {
  return {
    start: boom,
    status: () => Promise.resolve({ id: "x", status: "success" }),
  };
}

function unavailableStatusBuilds(): BuildsClient {
  return {
    start: () => Promise.resolve({ buildId: "build-1" }),
    status: boom,
  };
}

describe("upstream failures fail closed", () => {
  it("maps a throwing Builds start to 503 without leaking the error", async () => {
    const { app, token } = await makeApp({ builds: unavailableStartBuilds() });
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream unavailable" });
  });

  it("maps a throwing Builds status to 503 without leaking the error", async () => {
    const { app, token } = await makeApp({ builds: unavailableStatusBuilds() });
    const res = await app.request(getStatus("build-9", token), {}, testEnv());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream unavailable" });
  });
});
