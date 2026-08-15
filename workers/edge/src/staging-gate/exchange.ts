import type { Env } from "../env.ts";
import { notFoundResponse } from "../gateway/responses.ts";

/**
 * #1054 — the staging-gate OIDC exchange (CI channel of the staging gate).
 *
 * The CI channel's verifier endpoint. CI presents its GitHub OIDC identity
 * (a per-run, unforgeable token minted with the staging-gate audience); this
 * handler reuses the SAME @animichi/contract/oidc-github module the migrator
 * (#1051) uses — one implementation, two doors — with a DISTINCT audience so
 * the two doors never cross-accept (spec §"DISTINCT per-service audiences").
 *
 * On a valid OIDC identity the private smoke path is authorized: a
 * short-lived opaque gate session is minted and returned for the CI smoke to
 * present. On an invalid identity the exchange is rejected. The human browser
 * token channel (STAGING_GATE_TOKEN cookie/header) is untouched.
 *
 * The JWKS/get-key is constructor-injected (the same seam the migrator uses),
 * so tests sign with a local key pair while production points at GitHub's
 * remote JWKS. The session store is injected too, mirroring the EdgeGuard DO
 * seam; production binds a Durable Object.
 */

import { createGitHubOidcVerifier, type GitHubOidcVerifier } from "@animichi/contract/oidc-github";
import { createRemoteJWKSet } from "jose";
import {
  createGateSession,
  memoryGateSessionStore,
  STAGING_GATE_EXCHANGE_PATH,
  STAGING_GATE_SESSION_HEADER,
  type GateSession,
  type GateSessionStore,
} from "./session.ts";
import {
  GITHUB_OIDC_JWKS_URL,
  STAGING_GATE_OIDC_AUDIENCE,
  STAGING_GATE_OIDC_POLICY,
} from "./policy.ts";

/** The production JWKS source; injected elsewhere for tests (same as migrator). */
export const REMOTE_JWKS = createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL));

/** Result of an OIDC exchange attempt. */
export type ExchangeResult =
  | { kind: "granted"; session: GateSession }
  | { kind: "missing-token" }
  | { kind: "denied"; reason: string };

export interface ExchangeDeps {
  verifier?: GitHubOidcVerifier;
  store?: GateSessionStore;
  nowMs?: () => number;
}

/** Extract a Bearer OIDC token (same shape the migrator reads). */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const scheme = /^bearer[ 	]+/i.exec(header);
  if (scheme === null) return null;
  const token = header.slice(scheme[0].length).trim();
  return token.length > 0 ? token : null;
}

function defaultRemoteVerifier(): GitHubOidcVerifier {
  return createGitHubOidcVerifier(STAGING_GATE_OIDC_POLICY, REMOTE_JWKS);
}

/**
 * Verify the CI OIDC identity and mint a short-lived gate session on success.
 * Pure against the injected verifier + store so it runs under node:test with
 * no Cloudflare bindings.
 */
export async function exchangeForGateSession(
  request: Request,
  deps: ExchangeDeps,
): Promise<ExchangeResult> {
  const token = bearerToken(request);
  if (token === null) return { kind: "missing-token" };
  const verifier = deps.verifier ?? defaultRemoteVerifier();
  const verified = await verifier.verify(token);
  if (!verified.ok) return { kind: "denied", reason: verified.reason };
  const store = deps.store ?? memoryGateSessionStore();
  const nowMs = (deps.nowMs ?? Date.now)();
  const session = createGateSession(nowMs);
  await store.put(session.id, { expiresAtMs: session.expiresAtMs });
  return { kind: "granted", session };
}

/** HTTP status for a completed exchange. */
export function exchangeStatus(result: ExchangeResult): number {
  switch (result.kind) {
    case "granted":
      return 200;
    case "missing-token":
      return 401;
    case "denied":
      return 403;
  }
}

/** The staging-gate OIDC exchange (CI channel, #1054). The WAF passes
 * /staging-gate/exchange; the handler verifies the CI identity and on a valid
 * token mints a short-lived gate session (the private smoke path's credential)
 * returned to the caller; an invalid identity is rejected fail-closed. */
export function stagingGateExchangeResponse(
  env: Env, request: Request, deps: { stagingGateExchange?: (request: Request, env: Env) => Promise<Response> },
): Promise<Response> {
  if (deps.stagingGateExchange === undefined) {
    return Promise.resolve(notFoundResponse());
  }
  return deps.stagingGateExchange(request, env);
}

/**
 * Reused by app.ts so the default wiring stays in one place. During the OIDC
 * rollout the exchange runs with the default per-isolate in-memory session
 * store (the returned session proves the CI identity at exchange time and the
 * smoke carries it alongside the static WAF token until the coordinator's
 * STAGING_GATE_TOKEN deletion post-merge). The Durable-Object-backed store +
 * per-route session validation is the hardening path so the session survives
 * across isolates once the static token is gone. */
export function defaultStagingGateExchange(
  request: Request, _env: Env,
): Promise<Response> {
  return exchangeForGateSession(request, {}).then((result) => {
    if (result.kind === "granted") {
      return Response.json({ session: result.session.id, expiresInSeconds: 15 * 60 }, {
        status: exchangeStatus(result),
        headers: { [STAGING_GATE_SESSION_HEADER]: result.session.id },
      });
    }
    const status = exchangeStatus(result);
    const body = result.kind === "missing-token"
      ? { error: "missing oidc token" }
      : { error: "forbidden", message: result.reason };
    return Response.json(body, { status });
  });
}

export { STAGING_GATE_EXCHANGE_PATH, STAGING_GATE_SESSION_HEADER, STAGING_GATE_OIDC_AUDIENCE };
