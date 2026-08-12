// ── Anonymous identity (issue #274 / S1.8) ─────────────────────────────────
//
// Mechanism: a worker-signed, opaque, HttpOnly cookie. The edge mints a random
// id and an HMAC tag over it, so the id is stable per browser (survives IP
// changes and CGNAT, unlike an IP-derived hash) and cannot be forged into an
// arbitrary namespace or made to collide with another visitor's counters. No
// PII is derived or stored. Anonymous access is opt-in: without both
// ANON_ACCESS_ENABLED and ANON_ID_SECRET the edge keeps its existing 401.

const ANON_COOKIE = "aid";
const ANON_COOKIE_MAX_AGE_SECONDS = 31_536_000;
const ANON_ID_PATTERN = /^[0-9a-f]{32}$/;

export interface AnonymousEnv {
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: string;
}

/** Container-visible prefix of every anonymous `X-User-Id`. */
export const ANON_ID_PREFIX = "anon_";

export interface AnonymousIdentity {
  readonly userId: string;
  /** Set only when this request minted a new identity. */
  readonly setCookie: string | null;
}

export function anonymousEnabled(env: AnonymousEnv): boolean {
  return (
    env.ANON_ACCESS_ENABLED === "true" &&
    typeof env.ANON_ID_SECRET === "string" &&
    env.ANON_ID_SECRET.length > 0
  );
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function verifyAnonymousToken(token: string, secret: string): Promise<string | null> {
  const [id, signature] = token.split(".");
  if (id === undefined || signature === undefined || !ANON_ID_PATTERN.test(id)) return null;
  return constantTimeEqual(signature, await hmacHex(secret, id)) ? id : null;
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

async function verifiedCookie(request: Request, secret: string): Promise<string | null> {
  const cookie = readCookie(request, ANON_COOKIE);
  return cookie === null ? null : verifyAnonymousToken(cookie, secret);
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
  const secret = env.ANON_ID_SECRET;
  if (!anonymousEnabled(env) || secret === undefined) return null;
  const verified = await verifiedCookie(request, secret);
  if (verified === null) return mintAnonymousIdentity(secret);
  return { userId: `${ANON_ID_PREFIX}${verified}`, setCookie: null };
}

/**
 * Resolve-only variant for the session-adoption route (SESSION-2 #960,
 * re-P2-1): verifies an existing `aid` cookie but never mints one. A missing
 * or tampered cookie returns null rather than a fresh identity, so a request
 * with no anonymous history forwards no `X-Anon-Id` — minting here would
 * silently give the adoption endpoint side effects no other route has. The
 * route sets no cookie at all: it does not mint one, and (per the #507 owner
 * ruling reversing S1.7 rev5 P2-b) it no longer retires one either.
 */
export async function resolveAnonymousReadOnly(
  request: Request, env: AnonymousEnv,
): Promise<AnonymousIdentity | null> {
  const secret = env.ANON_ID_SECRET;
  if (!anonymousEnabled(env) || secret === undefined) return null;
  const verified = await verifiedCookie(request, secret);
  if (verified === null) return null;
  return { userId: `${ANON_ID_PREFIX}${verified}`, setCookie: null };
}
