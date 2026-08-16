import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGitHubOidcVerifier } from "@animichi/contract/oidc-github";
import { createDoorbellApp } from "../src/create-app";
import { DOORBELL_OIDC_POLICY, TRUSTED_RING_WORKFLOW, TRUSTED_WORKFLOW } from "../src/policy";
import {
  FIXED_NOW,
  OTHER_SHA,
  STAGING_SHA,
  issuedToken,
  joseEnv,
  makeApp,
  post,
  recordingBuilds,
  testEnv,
} from "./doorbell.worker.helpers";

// #1073 — doorbell staging ring: the token's sha claim must equal the
// requested commit for the allowlisted build to start.

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /builds — staging", () => {
  it("starts the allowlisted build when the token sha equals the commit", async () => {
    const { app, token, builds } = await makeApp();
    const res = await app.request(
      post({ component: "catalog", commit: STAGING_SHA }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      buildId: "build-1",
      component: "catalog",
      commit: STAGING_SHA,
      triggerId: "trig-catalog-stg",
    });
    expect(builds.starts).toEqual([{ triggerId: "trig-catalog-stg", commit: STAGING_SHA }]);
  });

  it("rejects a commit that does not match the token sha", async () => {
    const { app, token, builds } = await makeApp();
    const res = await app.request(
      post({ component: "catalog", commit: OTHER_SHA }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });

  it("accepts a token from the reusable ring-doorbell job via job_workflow_ref", async () => {
    const { token, jwk } = await issuedToken({
      workflow_ref: TRUSTED_WORKFLOW,
      job_workflow_ref: TRUSTED_RING_WORKFLOW,
    });
    const builds = recordingBuilds();
    const app = createDoorbellApp({
      verifier: createGitHubOidcVerifier(DOORBELL_OIDC_POLICY, joseEnv(jwk)),
      builds,
      readPin: () => Promise.resolve(null),
    });
    const res = await app.request(
      post({ component: "catalog", commit: STAGING_SHA }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(builds.starts).toEqual([{ triggerId: "trig-catalog-stg", commit: STAGING_SHA }]);
  });
});

describe("GET /healthz", () => {
  it("reports ok without authentication", async () => {
    const { app } = await makeApp();
    const res = await app.request(new Request("https://doorbell.test/healthz"), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "doorbell", env: "staging" });
  });
});
