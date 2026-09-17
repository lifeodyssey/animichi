import { AGENT_PATHS } from "@animichi/contract/agent-paths";

// Route classification tables (EDGE-1 #963). Every entry is a path the
// AGENT_PATHS inventory (CONTRACT-1 #938) must contain: the tables are
// references INTO the inventory, not a parallel hand-maintained vocabulary.
// A table entry the inventory no longer carries — a route retired by a later
// capability card — fails module load, so a retired path can never silently
// re-enter an allowlist.
//
// The RATE-limit classification (which route is cost-bearing/mutation and how
// it is metered) lives in ONE place: `rate-policy.ts` `classifyRatePolicy`.
// Those cells drive the guard seam.
//
// #1605 deleted this module's only identity-class table with the container
// forward it gated: `ANON_V1_PATHS` listed `/v1/chat` for the container path,
// while the native tier's anonymous surface is its own by-kind list
// (`agent-tier-route.ts` `ANONYMOUS_TIER_KINDS`). There is no credential-free
// `/v1` class left (#1597 retired the last three public reads), so all this
// module carries now is the native tier's route selection.

/** Require each table entry to exist in the inventory before it can match. */
function inventoryPath(path: string): string {
  if (AGENT_PATHS.some((entry) => entry.path === path)) return path;
  throw new Error(`route table entry "${path}" is not in the AGENT_PATHS inventory`);
}

/** Translate an inventory path template into an anchored matcher: every
 * `{param}` segment matches any non-slash run, so the edge classifies exactly
 * the routes the inventory advertises. */
function pathPattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parametric = escaped.replace(/\\\{[^}]*\\\}/g, "[^/]+");
  return new RegExp(`^` + parametric + `$`);
}

/** Native agent routes are always served by this Worker. `list` is the
 * conversation index (Card E of the #1317 decomposition) and carries no
 * session of its own; `transcript`/`stream` name one in their path. */
export type EdgeTierRoute =
  | { readonly kind: "turn" }
  | { readonly kind: "probe" }
  | { readonly kind: "list" }
  | { readonly kind: "transcript" | "stream"; readonly sessionId: string };

/** Classify the native agent surface; other APIs have their own gateway routes. */
export interface TurnRoutePolicy {
  select(method: string, pathname: string): EdgeTierRoute | null;
}

const TURN_PATH = inventoryPath("/v1/chat");
const PROBE_PATH = inventoryPath("/v1/byok/probe");
const LIST_PATH = inventoryPath("/v1/conversations");
const TRANSCRIPT_PATH = inventoryPath("/v1/conversations/{session_id}/messages");
const TRANSCRIPT = pathPattern(TRANSCRIPT_PATH);
const CONVERSATION_SESSION = /^\/v1\/conversations\/([^/]+)\/(?:messages|stream)$/;
const STREAM = pathPattern(inventoryPath("/v1/conversations/{session_id}/stream"));

/** The session id the transcript path names, decoded, or none. */
function conversationSessionId(pathname: string): string | null {
  const matched = CONVERSATION_SESSION.exec(pathname);
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
  if (method === "GET" && pathname === LIST_PATH) return { kind: "list" };
  return method === "GET" ? conversationReadRoute(pathname) : null;
}

function conversationReadRoute(pathname: string): EdgeTierRoute | null {
  if (!STREAM.test(pathname) && !TRANSCRIPT.test(pathname)) return null;
  const sessionId = conversationSessionId(pathname);
  return sessionId === null ? null : { kind: STREAM.test(pathname) ? "stream" : "transcript", sessionId };
}

/** The native production route policy has no runtime-switch setting. */
export function turnRoutePolicy(): TurnRoutePolicy {
  return { select: edgeTierRoute };
}
