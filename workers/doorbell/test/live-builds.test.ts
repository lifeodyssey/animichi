import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/create-app";
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

describe("live Builds client failures", () => {
  it("classifies a Cloudflare non-2xx without retaining its message", async () => {
    const body = { success: false, errors: [{ code: 10000, message: "token value leaked" }] };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(403, body))));
    await expect(liveBuildsClient(testEnv()).status("build-9")).rejects.toMatchObject({
      message: "builds api unavailable",
      stage: "non_2xx",
      status: 403,
      code: 10000,
    });
  });

  it("keeps a non-JSON Cloudflare error classified by HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("bad gateway", { status: 502 }))));
    await expect(liveBuildsClient(testEnv()).status("build-9")).rejects.toMatchObject({
      message: "builds api unavailable",
      stage: "non_2xx",
      status: 502,
    });
  });

  it("rejects a non-2xx start instead of parsing an error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { success: false }))));
    await expect(
      liveBuildsClient(testEnv()).start({ triggerId: "trig", commit: "abc" }),
    ).rejects.toThrow(/builds api unavailable/);
  });

  it("classifies an unreadable Secrets Store binding", async () => {
    const secret: SecretsStoreSecret = { get: () => Promise.reject(new Error("secret value leaked")) };
    const env: Env = { ...testEnv(), BUILDS_API_TOKEN: secret };
    await expect(liveBuildsClient(env).status("build-9")).rejects.toMatchObject({
      message: "builds api unavailable",
      stage: "secret_read",
    });
  });

  it("classifies a Builds network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network detail leaked"))));
    await expect(liveBuildsClient(testEnv()).status("build-9")).rejects.toMatchObject({
      message: "builds api unavailable",
      stage: "fetch",
    });
  });

  it("classifies a successful response with no build id", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { result: {} }))));
    await expect(
      liveBuildsClient(testEnv()).start({ triggerId: "trig", commit: "abc" }),
    ).rejects.toMatchObject({ stage: "bad_envelope", status: 200 });
  });
});

describe("live Builds client responses", () => {
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
        Promise.resolve(jsonResponse(200, { result: { status: "stopped", build_outcome: "success" } })),
      ),
    );
    await expect(liveBuildsClient(testEnv()).status("build-1")).resolves.toEqual({
      id: "build-1",
      status: "stopped",
      outcome: "success",
    });
  });
});
