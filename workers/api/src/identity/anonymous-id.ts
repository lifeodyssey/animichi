// ── Anonymous identity (issue #274 / S1.8) ─────────────────────────────────
//
// Mechanism: a worker-signed, opaque, HttpOnly cookie. The edge mints a random
// id and an HMAC tag over it, so the id is stable per browser (survives IP
// changes and CGNAT, unlike an IP-derived hash) and cannot be forged into an
// arbitrary namespace or made to collide with another visitor's counters. No
// PII is derived or stored. Anonymous access is opt-in: without both
// ANON_ACCESS_ENABLED and ANON_ID_SECRET the edge keeps its existing 401.

import { readStoreOrString, type Env } from "../env.ts";
import { firstVerifiedCookie } from "./cookie-header.ts";
import { hmacHex, signaturesMatch } from "./cookie-signature.ts";

const ANON_COOKIE = "aid";
const ANON_COOKIE_MAX_AGE_SECONDS = 31_536_000;
const ANON_ID_PATTERN = /^[0-9a-f]{32}$/;

export type AnonymousEnv = Pick<Env, "ANON_ACCESS_ENABLED" | "ANON_ID_SECRET">;

/** Prefix of every anonymous identity the edge mints (`anon_`), carried on the
 * internal `X-User-Id` header. */
export const ANON_ID_PREFIX = "anon_";

export interface AnonymousIdentity {
  readonly userId: string;
  /** Set only when this request minted a new identity. */
  readonly setCookie: string | null;
}

async function anonymousSecret(env: AnonymousEnv): Promise<string | undefined> {
  if (env.ANON_ACCESS_ENABLED !== "true") return undefined;
  return readStoreOrString(env.ANON_ID_SECRET);
}

export async function anonymousEnabled(env: AnonymousEnv): Promise<boolean> {
  return await anonymousSecret(env) !== undefined;
}

async function verifyAnonymousToken(token: string, secret: string): Promise<string | null> {
  const [id, signature] = token.split(".");
  if (id === undefined || signature === undefined || !ANON_ID_PATTERN.test(id)) return null;
  return signaturesMatch(signature, await hmacHex(secret, id)) ? id : null;
}

function anonymousCookie(token: string): string {
  return `${ANON_COOKIE}=${token}; Path=/; Max-Age=${String(ANON_COOKIE_MAX_AGE_SECONDS)}; HttpOnly; Secure; SameSite=Lax`;
}

async function mintAnonymousIdentity(secret: string): Promise<AnonymousIdentity> {
  const id = crypto.randomUUID().replaceAll("-", "");
  return {
    userId: `${ANON_ID_PREFIX}${id}`,
    setCookie: anonymousCookie(`${id}.${await hmacHex(secret, id)}`),
  };
}

/**
 * `response` carrying the identity this request minted, as every anonymous
 * answer does, whether it serves, verifies or refuses the visitor: a visitor
 * refused on a first request keeps the identity the next request presents. A
 * copy rather than an in-place write, since an answer from another object can
 * arrive with immutable headers. A returning visitor (`setCookie` null) gets
 * the answer as it is.
 */
export function withAnonymousCookie(response: Response, setCookie: string | null): Response {
  if (setCookie === null) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, { status: response.status, headers });
}

/** The id of the first `aid` the request carries that verifies, or null. */
function verifiedCookie(request: Request, secret: string): Promise<string | null> {
  return firstVerifiedCookie(request, ANON_COOKIE, (token) => verifyAnonymousToken(token, secret));
}

/**
 * Resolve (or mint) this browser's anonymous identity. A brand-new visitor
 * with zero history is issued one immediately — there is no minimum-history
 * threshold and no first-request penalty. Returns null when anonymous access
 * is not enabled, which leaves the caller on the authenticated path.
 */
export async function resolveAnonymous(
  request: Request, env: AnonymousEnv,
): Promise<AnonymousIdentity | null> {
  const secret = await anonymousSecret(env);
  if (secret === undefined) return null;
  const verified = await verifiedCookie(request, secret);
  if (verified === null) return mintAnonymousIdentity(secret);
  return { userId: `${ANON_ID_PREFIX}${verified}`, setCookie: null };
}

/**
 * Resolve-only variant for the session-adoption route (SESSION-2 #960,
 * re-P2-1): verifies an existing `aid` cookie but never mints one. A missing
 * or tampered cookie returns null rather than a fresh identity, so a request
 * with no anonymous history adopts nothing (the route answers
 * `no_anonymous_identity` without a write) — minting here would silently give
 * the adoption endpoint side effects no other route has. The route sets no
 * cookie at all: it does not mint one, and (per the #507 owner ruling
 * reversing S1.7 rev5 P2-b) it no longer retires one either.
 */
export async function resolveAnonymousReadOnly(
  request: Request, env: AnonymousEnv,
): Promise<AnonymousIdentity | null> {
  const secret = await anonymousSecret(env);
  if (secret === undefined) return null;
  const verified = await verifiedCookie(request, secret);
  if (verified === null) return null;
  return { userId: `${ANON_ID_PREFIX}${verified}`, setCookie: null };
}
