import { describe, expect, it, afterAll, beforeAll, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import {
  GITHUB_OIDC_ISSUER,
  createGitHubOidcVerifier,
  type GitHubOidcPolicy,
} from "@animichi/contract/oidc-github";
import { createMigratorApp, type Env as MigratorEnv, type MigratorDeps } from "../src/create-app";
import { TRUSTED_WORKFLOW, MIGRATOR_OIDC_AUDIENCE } from "../src/policy";

// #1051 — migrator worker HTTP seam tests: drive the worker through its HTTP
// interface with a faked container binding + injected JWKS (spec §Testing
// Decisions 1). jose resolves exp against the wall clock, so pin the clock.
const FIXED_NOW = new Date("2026-03-01T00:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

type ContainerOutcome =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number }
  | { kind: "timeout" };

const DSN = "postgresql://fake:migrator@db.test/neondb";

const policy: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: MIGRATOR_OIDC_AUDIENCE,
  repository: "lifeodyssey/animichi",
  refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
  subAllow: [],
  trustedWorkflowRefs: [TRUSTED_WORKFLOW],
};

function testEnv(): MigratorEnv {
  return { ENVIRONMENT: "staging", MIGRATOR_DATABASE_URL: DSN } as MigratorEnv;
}

async function issuedToken(overrides: Record<string, unknown> = {}): Promise<{
  token: string; jwk: JWK; privateKey: CryptoKey;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "migrator-test-key" } as JWK;
  const token = await new SignJWT({
    repository: "lifeodyssey/animichi",
    ref: "refs/heads/main",
    environment: "staging",
    workflow_ref: TRUSTED_WORKFLOW,
    job_workflow_ref: TRUSTED_WORKFLOW,
    sub: "repo:lifeodyssey/animichi:environment:staging",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "migrator-test-key", typ: "JWT" })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(MIGRATOR_OIDC_AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, jwk, privateKey };
}

function joseEnv(jwk: JWK) {
  return createLocalJWKSet({ keys: [jwk] });
}

async function makeApp(overrides: Partial<MigratorDeps> = {}) {
  const { token, jwk } = await issuedToken();
  const deps: MigratorDeps = {
    verifier: createGitHubOidcVerifier(policy, joseEnv(jwk)),
    runContainer: (): Promise<ContainerOutcome> => Promise.resolve({ kind: "success", exitCode: 0 }),
    readAppliedHead: (): Promise<string | null> => Promise.resolve("20260814191301_turn_idempotency_outbox"),
    ...overrides,
  };
  return { app: createMigratorApp(deps), token };
}

function post(body: Record<string, unknown>, token: string): Request {
  return new Request("https://migrator.test/migrate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ expectedHead: "20260814191301_turn_idempotency_outbox", ...body }),
  });
}

describe("POST /migrate — valid identity", () => {
  it("returns success with the applied head when the container exits 0", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: "20260814191301_turn_idempotency_outbox",
    });
  });

  it("injects the migrator DSN into the container run", async () => {
    let seenDsn: string | undefined;
    const { app, token } = await makeApp({
      runContainer: (dsn: string): Promise<ContainerOutcome> => {
        seenDsn = dsn;
        return Promise.resolve({ kind: "success", exitCode: 0 });
      },
    });
    await app.request(post({}, token), {}, testEnv());
    expect(seenDsn).toBe(DSN);
  });
});

describe("POST /migrate — invalid identities", () => {
  it("rejects a token from the wrong repository with 403", async () => {
    const { token, jwk } = await issuedToken({ repository: "attacker/other" });
    const { app } = await makeApp({ verifier: createGitHubOidcVerifier(policy, joseEnv(jwk)) });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(403);
  });

  it("rejects a token minted for another audience with 403", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk2 = { ...(await exportJWK(publicKey)), kid: "other" } as JWK;
    const wrongAudToken = await new SignJWT({
      repository: "lifeodyssey/animichi",
      ref: "refs/heads/main",
      environment: "staging",
      workflow_ref: TRUSTED_WORKFLOW,
      job_workflow_ref: TRUSTED_WORKFLOW,
    })
      .setProtectedHeader({ alg: "RS256", kid: "other", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience("staging-gate-audience")
      .setExpirationTime("5m")
      .sign(privateKey);
    const { app } = await makeApp({ verifier: createGitHubOidcVerifier(policy, joseEnv(jwk2)) });
    const res = await app.request(post({}, wrongAudToken), {}, testEnv());
    expect(res.status).toBe(403);
  });

  it("rejects an expired token with 403", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "expired" } as JWK;
    const expiredToken = await new SignJWT({
      repository: "lifeodyssey/animichi",
      ref: "refs/heads/main",
      environment: "staging",
      workflow_ref: TRUSTED_WORKFLOW,
      job_workflow_ref: TRUSTED_WORKFLOW,
    })
      .setProtectedHeader({ alg: "RS256", kid: "expired", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(MIGRATOR_OIDC_AUDIENCE)
      .setExpirationTime(Math.floor(FIXED_NOW.getTime() / 1000) - 60)
      .sign(privateKey);
    const { app } = await makeApp({ verifier: createGitHubOidcVerifier(policy, joseEnv(jwk)) });
    const res = await app.request(post({}, expiredToken), {}, testEnv());
    expect(res.status).toBe(403);
  });
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

describe("POST /migrate — request guards", () => {
  it("answers 401 when no bearer token is supplied", async () => {
    const { app } = await makeApp();
    const res = await app.request(post({}, ""), {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("rejects a missing/invalid JSON body as a 400", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(new Request("https://migrator.test/migrate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{ invalid",
    }), {}, testEnv());
    expect(res.status).toBe(400);
  });
});

it("exposes /healthz", async () => {
  const { app } = await makeApp();
  const res = await app.request("https://migrator.test/healthz", {}, testEnv());
  expect(res.status).toBe(200);
});