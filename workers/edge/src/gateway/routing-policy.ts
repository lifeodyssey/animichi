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

// ── W1-7 #1256: where a turn is served from ────────────────────────────────
//
// The agent tier moved into this Worker (spec §三), and the switch that puts
// traffic on it is a per-environment flag rather than a deploy: `container`
// keeps the Python container serving `/v1/chat`, `edge` serves it from the
// `AgentSession` Durable Object and reads the transcript straight out of Neon.
// Named for what it SELECTS, not for what it disables.
//
// Unlike `EDGE_SHOWCASE_MODE`, a malformed value here does not fail closed
// with a denial: the safe side of this flag is the surface that has been
// serving production all along, so anything but the literal "edge" is the
// container. There is nothing to warn about — an unset flag is the intended
// state of two of the three environments.

/** Which tier serves the two agent-turn routes. */
export type AgentTurnRoute = "container" | "edge";

/** The literal that moves a turn onto this Worker's own agent tier. */
export const EDGE_TURN_ROUTE: AgentTurnRoute = "edge";

/** The route the edge tier serves a request as, once the flag selected it.
 *
 * `probe` joined the two W1 routes in W2-3 (#1289): BYOK is served by whichever
 * tier serves the turn, because a credential the edge validated for `/v1/chat`
 * and a credential the container validated for `/v1/byok/probe` would be two
 * verdicts on one key. */
export type EdgeTierRoute =
  | { readonly kind: "turn" }
  | { readonly kind: "probe" }
  | { readonly kind: "transcript"; readonly sessionId: string };

/** Which `/v1` request the edge tier answers itself; `null` = the container. */
export interface TurnRoutePolicy {
  select(method: string, pathname: string): EdgeTierRoute | null;
}

const TURN_PATH = inventoryPath("/v1/chat");
const PROBE_PATH = inventoryPath("/v1/byok/probe");
const TRANSCRIPT_PATH = inventoryPath("/v1/conversations/{session_id}/messages");
const TRANSCRIPT = pathPattern(TRANSCRIPT_PATH);
const TRANSCRIPT_SESSION = /^\/v1\/conversations\/([^/]+)\/messages$/;

/** The session id the transcript path names, decoded, or none. */
function transcriptSessionId(pathname: string): string | null {
  const matched = TRANSCRIPT_SESSION.exec(pathname);
  if (matched?.[1] === undefined) return null;
  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return null;
  }
}

function edgeTierRoute(method: string, pathname: string): EdgeTierRoute | null {
  if (method === "POST" && pathname === TURN_PATH) return { kind: "turn" };
  if (method === "POST" && pathname === PROBE_PATH) return { kind: "probe" };
  if (method !== "GET" || !TRANSCRIPT.test(pathname)) return null;
  const sessionId = transcriptSessionId(pathname);
  return sessionId === null ? null : { kind: "transcript", sessionId };
}

/** Read the `AGENT_TURN_ROUTE` variable into the policy it selects. */
export function turnRoutePolicy(raw: string | undefined): TurnRoutePolicy {
  if (raw !== EDGE_TURN_ROUTE) return { select: () => null };
  return { select: edgeTierRoute };
}
