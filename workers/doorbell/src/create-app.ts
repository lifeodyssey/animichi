import { createRemoteJWKSet } from "jose";
import { Hono, type Context } from "hono";
import {
  createGitHubOidcVerifier,
  type GitHubOidcClaims,
  type GitHubOidcVerifier,
} from "@animichi/contract/oidc-github";
import type { BuildsClient } from "./builds";
import { commitEligible } from "./commit";
import { bearerToken, parseStartBody, type StartBody } from "./http";
import { releaseManifestPinReader, type PinReader } from "./pin";
import {
  DOORBELL_COMPONENT,
  DOORBELL_OIDC_POLICY,
  GITHUB_OIDC_JWKS_URL,
  REPOSITORY,
  isBannedComponent,
} from "./policy";
import { mapForEnvironment, triggerIdFor } from "./triggers";

/**
 * #1073 — the doorbell's Hono application + environment, kept free of any
 * fetch-based live adapter import so the HTTP-seam tests run under plain
 * vitest. The live Builds client is wired at the composition root
 * (src/index.ts) or, failing that, /builds answers 503 (fail-closed).
 */

/** Doorbell Worker bindings (Builds token via Secrets Store, per-ring trigger maps). */
export interface Env {
  ENVIRONMENT?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  BUILDS_API_TOKEN?: string | SecretsStoreSecret;
  STAGING_TRIGGER_MAP?: string;
  PRODUCTION_TRIGGER_MAP?: string;
}

/** Injectable boundaries used by the worker HTTP-seam tests. */
export interface DoorbellDeps {
  verifier?: GitHubOidcVerifier;
  builds?: BuildsClient;
  readPin?: PinReader;
}

const REMOTE_JWKS = createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL));

function healthz(c: Context<{ Bindings: Env }>): Response {
  return c.json({ status: "ok", service: DOORBELL_COMPONENT, env: c.env.ENVIRONMENT ?? "unknown" });
}

type AuthResult =
  | { ok: true; claims: GitHubOidcClaims }
  | { ok: false; response: Response };

async function authorizedClaims(c: Context<{ Bindings: Env }>, deps: DoorbellDeps): Promise<AuthResult> {
  const token = bearerToken(c.req.raw);
  if (token === null) return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
  const verifier = deps.verifier ?? createGitHubOidcVerifier(DOORBELL_OIDC_POLICY, REMOTE_JWKS);
  const verified = await verifier.verify(token);
  if (!verified.ok) return { ok: false, response: c.json({ error: "forbidden", message: verified.reason }, 403) };
  return { ok: true, claims: verified.claims };
}

async function handleStart(c: Context<{ Bindings: Env }>, deps: DoorbellDeps): Promise<Response> {
  const auth = await authorizedClaims(c, deps);
  if (!auth.ok) return auth.response;
  const parsed = await parseStartBody(c.req.raw);
  if (!parsed.ok) return c.json({ error: "invalid request body" }, 400);
  return handleStartBody(c, deps, auth.claims, parsed.value);
}

async function handleStartBody(c: Context<{ Bindings: Env }>, deps: DoorbellDeps, claims: GitHubOidcClaims, body: StartBody): Promise<Response> {
  if (isBannedComponent(body.component)) return c.json({ error: "self-publish forbidden" }, 403);
  const builds = deps.builds;
  if (builds === undefined) return c.json({ error: "builds client not configured" }, 503);
  const triggerId = triggerIdFor(mapForEnvironment(c.env, claims.environment), body.component);
  if (triggerId === null) return c.json({ error: "unknown component" }, 404);
  return startBuild(c, builds, deps, claims, body, triggerId);
}

async function startBuild(c: Context<{ Bindings: Env }>, builds: BuildsClient, deps: DoorbellDeps, claims: GitHubOidcClaims, body: StartBody, triggerId: string): Promise<Response> {
  const readPin = deps.readPin ?? releaseManifestPinReader(REPOSITORY);
  const eligible = await commitEligible(claims, body.commit, readPin);
  if (!eligible) return c.json({ error: "commit not eligible" }, 403);
  const handle = await builds.start({ triggerId, commit: body.commit });
  return c.json({ ok: true, buildId: handle.buildId, component: body.component, commit: body.commit, triggerId });
}

async function handleStatus(c: Context<{ Bindings: Env }>, deps: DoorbellDeps): Promise<Response> {
  const auth = await authorizedClaims(c, deps);
  if (!auth.ok) return auth.response;
  const builds = deps.builds;
  if (builds === undefined) return c.json({ error: "builds client not configured" }, 503);
  const id = c.req.param("id");
  if (id === undefined) return c.json({ error: "invalid build id" }, 400);
  const report = await builds.status(id);
  return c.json(report);
}

async function guarded(
  c: Context<{ Bindings: Env }>,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch {
    return c.json({ error: "upstream unavailable" }, 503);
  }
}

/** Create an independently injectable doorbell Hono application. */
export function createDoorbellApp(deps: DoorbellDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/healthz", healthz);
  app.post("/builds", (c) => guarded(c, () => handleStart(c, deps)));
  app.get("/builds/:id", (c) => guarded(c, () => handleStatus(c, deps)));
  return app;
}
