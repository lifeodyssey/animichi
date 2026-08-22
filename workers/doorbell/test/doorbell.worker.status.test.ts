import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  getStatus,
  makeApp,
  recordingBuilds,
  testEnv,
} from "./doorbell.worker.helpers";

// #1073 — doorbell status reports: GET /builds/:id returns whatever the
// Builds client reports, including a failed build.

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("GET /builds/:id — status reports", () => {
  it("returns a failed build report as-is", async () => {
    const builds = recordingBuilds({ id: "build-9", status: "failed", outcome: "failure" });
    const { app, token } = await makeApp({ builds });
    const res = await app.request(getStatus("build-9", token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "build-9", status: "failed", outcome: "failure" });
    expect(builds.statuses).toEqual(["build-9"]);
  });

  it("returns a success build report as-is", async () => {
    const builds = recordingBuilds({ id: "build-2", status: "success" });
    const { app, token } = await makeApp({ builds });
    const res = await app.request(getStatus("build-2", token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "build-2", status: "success" });
    expect(builds.statuses).toEqual(["build-2"]);
  });
});
