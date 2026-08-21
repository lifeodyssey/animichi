import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import {
  GITHUB_OIDC_ISSUER,
  createGitHubOidcVerifier,
} from "@animichi/contract/oidc-github";
import type { BuildHandle, BuildsClient, BuildStatus, StartBuildInput } from "../src/builds";
import { createDoorbellApp, type DoorbellDeps, type Env } from "../src/create-app";
import {
  DOORBELL_OIDC_AUDIENCE,
  DOORBELL_OIDC_POLICY,
  TRUSTED_DEPLOY_WORKFLOW,
  TRUSTED_WORKFLOW,
} from "../src/policy";

// #1073 — shared HTTP-seam fixtures for the doorbell worker tests: injected
// JWKS + recording Builds client + pin reader (spec §Testing). jose resolves
// exp against the wall clock, so the clock is pinned to a fixed instant.
export const FIXED_NOW = new Date("2026-03-01T00:00:00.000Z");
export const STAGING_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const TOKEN_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const PINNED_REVISION = "b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf";
export const OTHER_SHA = "cccccccccccccccccccccccccccccccccccccccc";

export const STAGING_TRIGGERS = JSON.stringify({
  catalog: "trig-catalog-stg",
  users: "trig-users-stg",
  web: "trig-web-stg",
  root: "trig-root-stg",
  jobs: "trig-jobs-stg",
});

export const PRODUCTION_TRIGGERS = JSON.stringify({
  catalog: "trig-catalog-prd",
  users: "trig-users-prd",
  web: "trig-web-prd",
  root: "trig-root-prd",
  jobs: "trig-jobs-prd",
});

/** Default staging claims for test tokens (per-test overridable). */
export const STAGING_CLAIMS = {
  repository: "lifeodyssey/animichi",
  ref: "refs/heads/main",
  environment: "staging",
  workflow_ref: TRUSTED_WORKFLOW,
  job_workflow_ref: TRUSTED_WORKFLOW,
  sub: "repo:lifeodyssey/animichi:environment:staging",
  sha: STAGING_SHA,
};

/** Default production claims for test tokens (per-test overridable). */
export const PRODUCTION_CLAIMS = {
  environment: "production",
  sub: "repo:lifeodyssey/animichi:environment:production",
  sha: TOKEN_SHA,
  workflow_ref: TRUSTED_DEPLOY_WORKFLOW,
  job_workflow_ref: TRUSTED_DEPLOY_WORKFLOW,
};

export async function issuedToken(overrides: Record<string, unknown> = {}): Promise<{
  token: string;
  jwk: JWK;
  privateKey: CryptoKey;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "doorbell-test-key" } as JWK;
  const token = await new SignJWT({ ...STAGING_CLAIMS, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "doorbell-test-key", typ: "JWT" })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(DOORBELL_OIDC_AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, jwk, privateKey };
}

export function joseEnv(jwk: JWK) {
  return createLocalJWKSet({ keys: [jwk] });
}

export interface RecordingBuilds extends BuildsClient {
  starts: StartBuildInput[];
  statuses: string[];
}

export function recordingBuilds(
  report: BuildStatus = { id: "build-1", status: "success" },
): RecordingBuilds {
  const starts: StartBuildInput[] = [];
  const statuses: string[] = [];
  return { starts, statuses, start: recordStart(starts), status: recordStatus(statuses, report) };
}

function recordStart(starts: StartBuildInput[]): (input: StartBuildInput) => Promise<BuildHandle> {
  return (input: StartBuildInput): Promise<BuildHandle> => {
    starts.push(input);
    return Promise.resolve({ buildId: "build-1" });
  };
}

function recordStatus(
  statuses: string[],
  report: BuildStatus,
): (buildId: string) => Promise<BuildStatus> {
  return (buildId: string): Promise<BuildStatus> => {
    statuses.push(buildId);
    return Promise.resolve({ ...report, id: buildId });
  };
}

function pinReaderFor(tokenSha: string): Promise<string | null> {
  return Promise.resolve(tokenSha === TOKEN_SHA ? PINNED_REVISION : null);
}

export async function makeApp(
  overrides: Partial<DoorbellDeps> = {},
  claims: Record<string, unknown> = {},
) {
  const { token, jwk } = await issuedToken(claims);
  const builds = overrides.builds ?? recordingBuilds();
  const deps: DoorbellDeps = {
    verifier: createGitHubOidcVerifier(DOORBELL_OIDC_POLICY, joseEnv(jwk)),
    builds,
    readPin: pinReaderFor,
    ...overrides,
  };
  return { app: createDoorbellApp(deps), token, builds: builds as RecordingBuilds };
}

export function testEnv(): Env {
  return {
    ENVIRONMENT: "staging",
    CLOUDFLARE_ACCOUNT_ID: "acct-test",
    BUILDS_API_TOKEN: "builds-token-not-a-dsn",
    STAGING_TRIGGER_MAP: STAGING_TRIGGERS,
    PRODUCTION_TRIGGER_MAP: PRODUCTION_TRIGGERS,
  };
}

export function post(body: Record<string, unknown>, token: string): Request {
  return new Request("https://doorbell.test/builds", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function getStatus(id: string, token: string): Request {
  return new Request(`https://doorbell.test/builds/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}
