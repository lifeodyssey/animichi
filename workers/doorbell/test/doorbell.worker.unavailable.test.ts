import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BuildsApiError, type BuildsClient } from "../src/builds";
import type { DoorbellDiagnostic } from "../src/create-app";
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

function rejectedBuilds(error: Error): BuildsClient {
  return {
    start: () => Promise.reject(error),
    status: () => Promise.reject(error),
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

  it("returns and logs only safe Cloudflare error fields", async () => {
    const reports: DoorbellDiagnostic[] = [];
    const error = new BuildsApiError("non_2xx", 403, 10000);
    const { app, token } = await makeApp({
      builds: rejectedBuilds(error),
      reportError: (report) => reports.push(report),
    });
    const res = await app.request(post({ component: "web", commit: STAGING_SHA }, token), {}, testEnv());
    expect(await res.json()).toEqual({
      error: "upstream unavailable",
      diagnostic: { stage: "non_2xx", status: 403, code: 10000 },
    });
    expect(reports).toEqual([{
      event: "doorbell_upstream_error",
      operation: "start",
      stage: "non_2xx",
      upstreamStatus: 403,
      upstreamCode: 10000,
    }]);
  });
});
