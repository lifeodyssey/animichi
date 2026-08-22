import { createAuthClient } from "better-auth/client";
import { jwtClient, magicLinkClient } from "better-auth/client/plugins";
import { currentRuntimeConfig } from "../runtime-config/provider";

/**
 * Neon Auth magic-link client, pointed at the per-branch `…/neondb/auth` URL.
 *
 * Magic-link verify redirects to our callback with `neon_auth_session_verifier`
 * (the session cookie stays on the Neon origin). `attachVerifier` forwards
 * that query onto `/token` and `/get-session`. Base URL is `neonAuthBaseUrl`
 * (#1013 AC1); absent means "not configured".
 */
export type MagicLinkResult = "sent" | "not_configured" | "error";

export interface MagicLinkRequest {
  email: string;
  callbackURL: string;
}

const VERIFIER_PARAM = "neon_auth_session_verifier";

function baseUrl(): string | undefined {
  // The runtime-config loader guarantees the field is undefined-or-valid-URL,
  // so an absent field is the documented "auth not configured" shape.
  return currentRuntimeConfig().neonAuthBaseUrl;
}

export function isNeonAuthConfigured(): boolean {
  return baseUrl() !== undefined;
}

function verifierFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(VERIFIER_PARAM) ?? undefined;
}

function attachVerifier<T extends { url: URL | string }>(ctx: T): T | undefined {
  const verifier = verifierFromLocation();
  if (!verifier) return undefined;
  const url = typeof ctx.url === "string" ? new URL(ctx.url) : ctx.url;
  url.searchParams.set(VERIFIER_PARAM, verifier);
  return { ...ctx, url };
}

function dropVerifierFromLocation(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(VERIFIER_PARAM)) return;
  url.searchParams.delete(VERIFIER_PARAM);
  history.replaceState(history.state, "", url.href);
}

export function neonAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    fetchOptions: { credentials: "include", onRequest: attachVerifier, onSuccess: dropVerifierFromLocation },
    plugins: [magicLinkClient(), jwtClient()],
  });
}

export async function sendMagicLink(request: MagicLinkRequest): Promise<MagicLinkResult> {
  const base = baseUrl();
  if (!base) return "not_configured";
  try {
    const { error } = await neonAuthClient(base).signIn.magicLink(request);
    return error ? "error" : "sent";
  } catch {
    return "error";
  }
}

/**
 * Exchanges the Neon Auth session (cookie and/or `neon_auth_session_verifier`)
 * for an EdDSA JWT. The edge worker verifies this token against the branch JWKS.
 */
export async function fetchAuthToken(): Promise<string | undefined> {
  const base = baseUrl();
  if (!base) return undefined;
  try {
    const { data, error } = await neonAuthClient(base).token();
    // No null-guard on `data`: better-auth types the success branch as
    // non-nullable with a required `token`, and type-aware oxlint rejects the
    // check as provably dead (`no-unnecessary-condition`). A review bot asked
    // for one; the type system says the shape it fears cannot occur here.
    return error ? undefined : data.token;
  } catch {
    return undefined;
  }
}
