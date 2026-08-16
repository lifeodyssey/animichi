import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { GITHUB_OIDC_ISSUER, createGitHubOidcVerifier } from "@animichi/contract/oidc-github";
import { createDoorbellApp } from "../src/create-app";
import { DOORBELL_OIDC_AUDIENCE, DOORBELL_OIDC_POLICY } from "../src/policy";
import {
  FIXED_NOW,
  STAGING_CLAIMS,
  STAGING_SHA,
  STAGING_TRIGGERS,
  issuedToken,
  joseEnv,
  makeApp,
  post,
  testEnv,
} from "./doorbell.worker.helpers";

// #1073 — doorbell rejections: wrong identity, unknown/self component, and
// request guards. Every case must leave the Builds client untouched.

const DEPENDABOT_WORKFLOW = "lifeodyssey/animichi/.github/workflows/dependabot.yml@refs/heads/main";

const SELF_PUBLISH_MAP = JSON.stringify({
  ...(JSON.parse(STAGING_TRIGGERS) as Record<string, string>),
  doorbell: "trig-self",
});

async function mintToken(
  claims: Record<string, unknown>,
  options: { audience: string; expirationTime: string | number },
): Promise<{ token: string; jwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "doorbell-test-key" } as JWK;
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "doorbell-test-key", typ: "JWT" })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(options.audience)
    .setExpirationTime(options.expirationTime)
    .sign(privateKey);
  return { token, jwk };
}

function verifiedApp(jwk: JWK) {
  return makeApp({ verifier: createGitHubOidcVerifier(DOORBELL_OIDC_POLICY, joseEnv(jwk)) });
}

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /builds — invalid identities", () => {
  it("rejects an expired token with 403", async () => {
    const { token, jwk } = await mintToken({ ...STAGING_CLAIMS }, {
      audience: DOORBELL_OIDC_AUDIENCE,
      expirationTime: Math.floor(FIXED_NOW.getTime() / 1000) - 60,
    });
    const { app, builds } = await verifiedApp(jwk);
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });

  it("rejects a token from the wrong repository with 403", async () => {
    const { token, jwk } = await issuedToken({ repository: "attacker/other" });
    const { app, builds } = await verifiedApp(jwk);
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });

  it("rejects a token minted for the staging-gate audience with 403", async () => {
    const { token, jwk } = await mintToken({ ...STAGING_CLAIMS }, {
      audience: "staging-gate-audience",
      expirationTime: "5m",
    });
    const { app, builds } = await verifiedApp(jwk);
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });

  it("rejects a token minted for the migrator audience with 403", async () => {
    const { token, jwk } = await mintToken({ ...STAGING_CLAIMS }, {
      audience: "animichi:github-actions:migrator",
      expirationTime: "5m",
    });
    const { app, builds } = await verifiedApp(jwk);
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });

  it("rejects a token carrying an untrusted workflow with 403", async () => {
    const { token, jwk } = await issuedToken({
      workflow_ref: DEPENDABOT_WORKFLOW,
      job_workflow_ref: DEPENDABOT_WORKFLOW,
    });
    const { app, builds } = await verifiedApp(jwk);
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });
});

describe("POST /builds — component guards", () => {
  it("answers 404 for an unknown component", async () => {
    const { app, token, builds } = await makeApp();
    const res = await app.request(post({ component: "not-a-worker", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(404);
    expect(builds.starts).toEqual([]);
  });

  it("answers 403 for the doorbell itself even when the map names it", async () => {
    const { app, token, builds } = await makeApp();
    const env = { ...testEnv(), STAGING_TRIGGER_MAP: SELF_PUBLISH_MAP };
    const res = await app.request(post({ component: "doorbell", commit: STAGING_SHA }, token), {}, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "self-publish forbidden" });
    expect(builds.starts).toEqual([]);
  });
});

describe("POST /builds — request guards", () => {
  it("answers 401 when no bearer token is supplied", async () => {
    const { app, builds } = await makeApp();
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, ""), {}, testEnv());
    expect(res.status).toBe(401);
    expect(builds.starts).toEqual([]);
  });

  it("answers 400 for an invalid JSON body", async () => {
    const { app, token, builds } = await makeApp();
    const req = new Request("https://doorbell.test/builds", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{ invalid",
    });
    const res = await app.request(req, {}, testEnv());
    expect(res.status).toBe(400);
    expect(builds.starts).toEqual([]);
  });

  it("answers 400 for a commit that is not 40-char lowercase hex", async () => {
    const { app, token, builds } = await makeApp();
    const res = await app.request(post({ component: "catalog", commit: "not-a-sha" }, token), {}, testEnv());
    expect(res.status).toBe(400);
    expect(builds.starts).toEqual([]);
  });

  it("answers 503 when the builds client is not configured", async () => {
    const { token, jwk } = await issuedToken();
    const app = createDoorbellApp({
      verifier: createGitHubOidcVerifier(DOORBELL_OIDC_POLICY, joseEnv(jwk)),
    });
    const res = await app.request(post({ component: "catalog", commit: STAGING_SHA }, token), {}, testEnv());
    expect(res.status).toBe(503);
  });
});

describe("doorbell audience contract", () => {
  it("keeps the doorbell audience distinct from the migrator audience", () => {
    expect(DOORBELL_OIDC_AUDIENCE).toBe("animichi:github-actions:doorbell");
    expect(DOORBELL_OIDC_AUDIENCE).not.toBe("animichi:github-actions:migrator");
  });
});
