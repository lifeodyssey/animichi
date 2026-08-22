import { afterEach, describe, expect, it, vi } from "vitest";
import { liveBuildsClient } from "../src/live-builds";
import { testEnv } from "./doorbell.worker.helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("live Builds client", () => {
  it("rejects a non-2xx status instead of reporting unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(502, { success: false }))));
    await expect(liveBuildsClient(testEnv()).status("build-9")).rejects.toThrow(/builds api unavailable/);
  });

  it("rejects a non-2xx start instead of parsing an error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { success: false }))));
    await expect(
      liveBuildsClient(testEnv()).start({ triggerId: "trig", commit: "abc" }),
    ).rejects.toThrow(/builds api unavailable/);
  });

  it("accepts documented build_uuid on start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { result: { build_uuid: "build-uuid-1" } }))),
    );
    await expect(
      liveBuildsClient(testEnv()).start({ triggerId: "trig", commit: "abc" }),
    ).resolves.toEqual({ buildId: "build-uuid-1" });
  });

  it("accepts documented build_outcome on status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse(200, { result: { status: "completed", build_outcome: "success" } })),
      ),
    );
    await expect(liveBuildsClient(testEnv()).status("build-1")).resolves.toEqual({
      id: "build-1",
      status: "completed",
      outcome: "success",
    });
  });
});
