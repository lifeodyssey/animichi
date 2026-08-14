import { AGENT_PATHS } from "@animichi/contract/agent-contract";

// Route classification tables (EDGE-1 #963). Every entry is a path the
// AGENT_PATHS inventory (CONTRACT-1 #938) must contain: the tables are
// references INTO the inventory, not a parallel hand-maintained vocabulary.
// A table entry the inventory no longer carries — a route retired by a later
// capability card — fails module load, so a retired path can never silently
// re-enter an allowlist.
//
// The RATE-limit classification (which route is cost-bearing/mutation and how
// it is metered) lives in ONE place: `rate-policy.ts` `classifyRatePolicy`.
// Those cells drive the guard seam; this module is only the identity-class
// routing tables (public vs anonymous) the request surface needs to decide
// whether it must authenticate before forwarding.

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
  return new RegExp(`^` + parametric + `$`);
}

const PUBLIC_V1 = PUBLIC_V1_PATHS.map(inventoryPath).map(pathPattern);
const ANON_V1 = ANON_V1_PATHS.map(inventoryPath).map(pathPattern);

export function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.some((pattern) => pattern.test(pathname));
}

export function isAnonymousV1(pathname: string): boolean {
  return ANON_V1.some((pattern) => pattern.test(pathname));
}
