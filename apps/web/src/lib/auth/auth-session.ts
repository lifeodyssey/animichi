import { fetchAuthToken, redeemAuthToken } from "./neon-auth";

/**
 * In-memory Neon Auth JWT cache.
 *
 * `fetchAuthToken` exchanges the session cookie for an EdDSA JWT; caching it
 * until shortly before its own `exp` avoids a network round trip to the Neon
 * Auth origin on every outgoing chat/history/users request. Module state only
 * (no storage) — a page reload re-derives it from the cookie.
 */
interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

const REFRESH_MARGIN_MS = 60_000;

let cached: CachedToken | undefined;

function isFresh(entry: CachedToken | undefined, now: number): entry is CachedToken {
  return entry !== undefined && entry.expiresAt > now;
}

function decodePayload(segment: string): unknown {
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function expiryClaim(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null || !("exp" in payload)) return undefined;
  return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : undefined;
}

function expiresAt(token: string): number | undefined {
  const segment = token.split(".")[1];
  if (!segment) return undefined;
  try {
    const expiry = expiryClaim(decodePayload(segment));
    return expiry === undefined ? undefined : expiry * 1_000 - REFRESH_MARGIN_MS;
  } catch {
    return undefined;
  }
}

function cacheToken(token: string): void {
  const expiry = expiresAt(token);
  cached = expiry === undefined ? undefined : { token, expiresAt: expiry };
}

async function refreshToken(): Promise<string | undefined> {
  const token = await fetchAuthToken();
  if (token === undefined) {
    cached = undefined;
    return undefined;
  }
  cacheToken(token);
  return token;
}

/** The current session's bearer token, refetched once the cache goes stale. */
export async function getAuthToken(now: number = Date.now()): Promise<string | undefined> {
  if (isFresh(cached, now)) return cached.token;
  return refreshToken();
}

/**
 * Callback redeem: same cache as `getAuthToken`, but a failed SDK `/token`
 * throws `error.message` so the callback screen can render it verbatim.
 */
export async function establishAuthSession(): Promise<string> {
  const result = await redeemAuthToken();
  if ("token" in result) {
    cacheToken(result.token);
    return result.token;
  }
  cached = undefined;
  throw new Error(result.error.message);
}

/** Drop the cached token, forcing the next call to re-derive it from the cookie. */
export function clearAuthToken(): void {
  cached = undefined;
}

/** `{}` when signed out, `{ Authorization: "Bearer <jwt>" }` when signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
