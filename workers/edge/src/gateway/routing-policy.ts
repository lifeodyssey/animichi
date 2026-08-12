import { AGENT_PATHS } from "@animichi/contract/agent-contract";

// Route classification tables (EDGE-1 #963). Every entry is a path the
// AGENT_PATHS inventory (CONTRACT-1 #938) must contain: the tables are
// references INTO the inventory, not a parallel hand-maintained vocabulary.
// A table entry the inventory no longer carries — a route retired by a later
// capability card — fails module load, so a retired path can never silently
// re-enter an allowlist.

/** Identity-class tables: subsets of the AGENT_PATHS inventory. */
export const PUBLIC_V1_PATHS = [
  "/v1/search/preview",
  "/v1/bangumi/{bangumi_id}/guide",
] as const;

/** Cost-free read surfaces the edge serves without a credential. */
export const ANON_V1_PATHS = [
  "/v1/chat",
  "/v1/photo-search",
  "/v1/photo-search/confirm",
] as const;

/** Authenticated cost-bearing routes, per-identity limited (issue #284). */
export const AUTH_RATE_LIMITED_PATHS = ["/v1/chat"] as const;

/** Require each table entry to exist in the inventory before it can match. */
function inventoryPath(path: string): string {
  if (AGENT_PATHS.some((entry) => entry.path === path)) return path;
  throw new Error(`route table entry "${path}" is not in the AGENT_PATHS inventory`);
}

/** Translate an inventory path template into an anchored matcher: every
 * `{param}` segment matches any non-slash run, mirroring the container's
 * router so the edge classifies exactly the routes the container serves. */
function pathPattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parametric = escaped.replace(/\\\{[^}]*\\\}/g, "[^/]+");
  return new RegExp(`^${parametric}$`);
}

const PUBLIC_V1 = PUBLIC_V1_PATHS.map(inventoryPath).map(pathPattern);
const ANON_V1 = ANON_V1_PATHS.map(inventoryPath).map(pathPattern);
const AUTH_RATE_LIMITED_EXACT = AUTH_RATE_LIMITED_PATHS.map(inventoryPath).map(pathPattern);

/** The BYOK prefix is derived from the inventory's byok route, so future
 * /v1/byok/* routes stay covered without an edit here (P2-5). */
function byokPrefixFromInventory(): string {
  const probe = AGENT_PATHS.find((entry) => entry.path.startsWith("/v1/byok/"));
  if (probe === undefined) {
    throw new Error("AGENT_PATHS has no /v1/byok/ route; cannot derive the BYOK rate-limit prefix");
  }
  return probe.path.slice(0, probe.path.lastIndexOf("/") + 1);
}

export const AUTH_RATE_LIMITED_PREFIX = byokPrefixFromInventory();

/** Strip one trailing slash so "/v1/chat/" counts as "/v1/chat" — a bare
 * exact-match let a trailing slash skip the limiter outright (P2-5). */
function normalizeV1Path(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Percent-decode for routing decisions only (review follow-up, #479 P1-1 /
 * #464): `URL.pathname` does NOT decode `%XX` escapes, but the container's
 * ASGI router (uvicorn/Starlette) does before matching its own routes. That
 * split-brain let `/v1/%62yok/probe` read as "not `/v1/byok/`" here — zero
 * `checkRateLimit` calls — while still landing on `handle_byok_probe` in the
 * container: an authenticated caller could burst an unbounded number of real
 * outbound probe calls by percent-encoding one letter per request. Returns
 * `null` on a malformed `%` escape so the caller can fail CLOSED: an
 * unparseable path is exactly the shape an evasion attempt produces, so
 * treating it as "not rate-limited" would recreate the same hole this fixes.
 */
function decodedForRouting(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.some((pattern) => pattern.test(pathname));
}

export function isAnonymousV1(pathname: string): boolean {
  return ANON_V1.some((pattern) => pattern.test(pathname));
}

/** BYOK routes match by prefix, not an exact list — every route under
 * /v1/byok/ is an outbound relay by construction (P2-5). */
export function isAuthRateLimited(pathname: string): boolean {
  const decoded = decodedForRouting(pathname);
  if (decoded === null) return true;
  const normalized = normalizeV1Path(decoded);
  return AUTH_RATE_LIMITED_EXACT.some((pattern) => pattern.test(normalized)) ||
    normalized.startsWith(AUTH_RATE_LIMITED_PREFIX);
}
