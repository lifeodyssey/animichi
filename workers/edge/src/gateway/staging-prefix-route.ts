/// <reference types="@cloudflare/workers-types" />

/**
 * Where the staging-only prefix seeding is MOUNTED (E-1 #1380, spec §十 10.1).
 *
 * TWO DOORS, AND `APP_ENV` IS ONLY THE FIRST. The mount is `APP_ENV ===
 * "staging"` and fails closed on everything else — `"production"`, unset, empty,
 * any other string — which is what keeps the procedure from existing on
 * production at all: on any other deployment `select` answers null, the request
 * falls through the `/v1` dispatcher unchanged and reaches a tier that has never
 * served this path. But an environment variable is a MOUNT SWITCH, not an
 * authorisation: everyone who can reach staging shares that variable's value.
 * So the caller must also present the credential the product itself reads a
 * session by, and the session they name must be theirs — the ownership check
 * lives past this file, inside the Durable Object where the write happens
 * (`agent/session/prefix-seeding.ts`).
 *
 * ANONYMOUS IS NOT ADMITTED. The transcript READ was deliberately widened to
 * anonymous callers under the `edge` tier (`agent-tier-route.ts`), because
 * reading your own conversation back is W1's exit criterion and costs nothing.
 * This is the opposite kind of request — it MUTATES a session — and an
 * anonymous identity is an HMAC of a cookie the caller controls the lifetime of,
 * so it is exactly the identity a seeded session must not be attributable to.
 *
 * It lives beside `agent-tier-route.ts` rather than inside it because it changes
 * for a different reason: that file is the identity ladder in front of the three
 * PRODUCT routes, and this is one procedure that exists on one deployment.
 */
import {
  PREFIX_MAX_BYTES,
  STAGING_APP_ENV,
  STAGING_PREFIX_PATH_ROOT,
  STAGING_PREFIX_PATH_TAIL,
} from "@animichi/contract/staging-prefix-path";
import type { Env, WorkerExecutionContext } from "../env.ts";
import type { NamedStubs } from "../agent/durable-namespace.ts";
import { prefixSeedRequest } from "../agent/session/session-prefix.ts";
import type { AgentTierGates } from "./agent-tier-route.ts";
import { credentialsRequired, gatewayRejection, unauthorized } from "./responses.ts";

/** One seeding request, once the mount admitted it: which session it names. */
export interface StagingPrefixRoute {
  readonly sessionId: string;
}

/** The session id the pathname names, decoded, or none — a segment that is not
 * valid percent-encoding names no session. */
function seededSessionId(pathname: string): string | null {
  const inner = pathname.slice(STAGING_PREFIX_PATH_ROOT.length, -STAGING_PREFIX_PATH_TAIL.length);
  if (inner === "" || inner.includes("/")) return null;
  try {
    return decodeURIComponent(inner);
  } catch {
    return null;
  }
}

/** Whether the pathname is shaped like this procedure's at all. */
function seedingPath(pathname: string): boolean {
  return pathname.startsWith(STAGING_PREFIX_PATH_ROOT) && pathname.endsWith(STAGING_PREFIX_PATH_TAIL);
}

/**
 * The seeding this request is, or `null` — which is every request on every
 * deployment whose `APP_ENV` is not exactly `staging`.
 */
export function stagingPrefixRoute(
  appEnv: string | undefined, method: string, pathname: string,
): StagingPrefixRoute | null {
  if (appEnv !== STAGING_APP_ENV || method !== "POST" || !seedingPath(pathname)) return null;
  const sessionId = seededSessionId(pathname);
  return sessionId === null ? null : { sessionId };
}

function boundSessions(binding: NamedStubs | undefined): NamedStubs {
  if (binding === undefined) throw new Error("AGENT_SESSION is not bound");
  return binding;
}

/**
 * Serve one seeding: verify the bearer, then hand the caller's own body to the
 * session's Durable Object with the identity that verified.
 *
 * The body is forwarded as TEXT rather than parsed here. This module decides
 * who may write, not what is written; the prefix is read once, by the writer,
 * out of `trajectory-prefix.ts` — so there is exactly one place a malformed
 * prefix is refused and exactly one shape it is refused against.
 *
 * No rate-limit cell, and therefore a SIZE bound instead. `classifyRatePolicy`
 * derives its cells from the published `AGENT_PATHS` inventory, which this path
 * is deliberately absent from, so there is nothing to classify — which leaves
 * the body itself as the one thing a caller past the staging perimeter can make
 * arbitrarily expensive. `PREFIX_MAX_BYTES` is that bound, and it is checked
 * here rather than at the writer because this is the last point before the body
 * is read into memory and handed to a Durable Object.
 */
async function boundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > PREFIX_MAX_BYTES) return null;
  const body = await request.text();
  return new TextEncoder().encode(body).length > PREFIX_MAX_BYTES ? null : body;
}

const TOO_LARGE_MESSAGE = `A seeding body may not exceed ${String(PREFIX_MAX_BYTES)} bytes.`;

export async function stagingPrefixResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext,
  route: StagingPrefixRoute, gates: AgentTierGates,
): Promise<Response> {
  const auth = await gates.authenticate(request, env, ctx);
  if (!auth.ok) {
    return auth.reason === "invalid" ? unauthorized(new URL(request.url).pathname) : credentialsRequired();
  }
  const body = await boundedBody(request);
  if (body === null) return gatewayRejection("prefix_too_large", 413, TOO_LARGE_MESSAGE);
  const sessions = boundSessions(env.AGENT_SESSION);
  return await sessions.get(sessions.idFromName(route.sessionId)).fetch(
    prefixSeedRequest(route.sessionId, auth.userId, body),
  );
}
