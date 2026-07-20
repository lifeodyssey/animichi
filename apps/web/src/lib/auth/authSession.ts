import { fetchAuthToken } from "./neonAuth";

/**
 * In-memory Neon Auth JWT cache.
 *
 * `fetchAuthToken` exchanges the Better Auth session cookie for a fresh
 * 15-minute EdDSA JWT; caching it here avoids a network round trip to the
 * Neon Auth origin on every outgoing chat/history/users request. Module
 * state only (no storage) — a page reload re-derives it from the cookie.
 */
interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

const REFRESH_MARGIN_MS = 60_000;
const TOKEN_TTL_MS = 15 * 60_000 - REFRESH_MARGIN_MS;

let cached: CachedToken | undefined;

function isFresh(entry: CachedToken | undefined, now: number): entry is CachedToken {
  return entry !== undefined && entry.expiresAt > now;
}

async function refreshToken(now: number): Promise<string | undefined> {
  const token = await fetchAuthToken();
  cached = token ? { token, expiresAt: now + TOKEN_TTL_MS } : undefined;
  return token;
}

/** The current session's bearer token, refetched once the cache goes stale. */
export async function getAuthToken(now: number = Date.now()): Promise<string | undefined> {
  if (isFresh(cached, now)) return cached.token;
  return refreshToken(now);
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
