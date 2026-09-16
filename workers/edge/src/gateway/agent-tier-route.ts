/// <reference types="@cloudflare/workers-types" />

/**
 * The identity ladder in front of this Worker's own agent tier (W1-7 #1256).
 *
 * It is the same ladder the served `/v1` surface has climbed since AUTH-2 #950 —
 * a verified Neon bearer first, else the anonymous pipeline (Turnstile →
 * limiter → budget latch), else a flat 401 — and that is the point of reusing it
 * rather than reimplementing it beside the tier: moving a route onto the new
 * tier must not move it out from behind a wall. Nothing below re-verifies
 * anything; the identity resolved here is the one the intake commits.
 *
 * ONE DELIBERATE WIDENING, and it is the card's whole reason to exist. Both
 * routes reach the anonymous pipeline here, while the tier's anonymous list
 * (`ANONYMOUS_TIER_KINDS` below) is what decides whether an absent credential
 * reaches it at all — so the transcript read is reachable anonymously, where the
 * container path's own table (`ANON_V1_PATHS`, deleted with the container in
 * #1605) listed only `/v1/chat` and answered an anonymous
 * `GET /v1/conversations/{id}/messages` with a 401. W1's exit criterion is
 * "staging 匿名可完整对话；切走再回来拉到完整结果" (spec §五), which is precisely a
 * visitor with no account reading their own transcript back, so under `edge`
 * that GET must be reachable anonymously or the wave has no exit.
 *
 * What makes it safe is not the route table but `ConversationRetrieval`'s
 * ownership check: the page is returned only when `sessions.user_id` equals the
 * caller's identity, and an anonymous identity is an HMAC of a cookie
 * (`identity/anonymous-id.ts`), so knowing a conversation id buys nothing.
 * Missing and forbidden collapse to the same 404.
 *
 * It lives beside `request.ts` instead of inside it because that file is the
 * whole-Worker dispatcher and is already at its size budget, and because these
 * three functions change for exactly one reason — how a turn reaches the agent
 * tier — which is not the dispatcher's reason to change.
 */
import type { Env, WorkerExecutionContext } from "../env.ts";
import type { AuthResult } from "../identity/auth.ts";
import { handleAnonymousV1 } from "../identity/anonymous-flow.ts";
import type { TurnstileGate } from "../protect/turnstile.ts";
import { authenticatedRateLimitKey, authRateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { classifyRatePolicy } from "./rate-policy.ts";
import { credentialsRequired, unauthorized } from "./responses.ts";
import type { EdgeTierRoute } from "./routing-policy.ts";
import type { AgentTurnTier, TurnIdentity } from "./agent-turn.ts";

/** What serving the agent tier needs from the gateway's composed gates — the
 * subset of `GatewayDeps`, which extends this rather than restating it. */
export interface AgentTierGates {
  authenticate: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate: TurnstileGate;
  /** This Worker's native agent tier. Tests may supply the gateway boundary
   * without constructing a database or Durable Object. */
  agentTurns: AgentTurnTier;
}

/** One route of the agent tier, served for one already-verified identity. */
function servedByTier(
  env: Env, request: Request, identity: TurnIdentity, route: EdgeTierRoute, gates: AgentTierGates,
): Promise<Response> {
  switch (route.kind) {
    case "turn": return gates.agentTurns.chat(env, request, identity);
    case "probe": return gates.agentTurns.probe(request, identity);
    case "list": return gates.agentTurns.list(env, request, identity);
    case "transcript": return gates.agentTurns.transcript(env, request, identity, route.sessionId);
    case "stream": return gates.agentTurns.stream(env, request, identity, route.sessionId);
  }
}

/** The authenticated limiter still runs first: moving a turn onto this tier
 * must not be a way to stop metering it (`#680` AC4 — a high-cost write that
 * cannot be metered does not run). */
async function authenticatedTierResponse(
  env: Env, request: Request, auth: { userId: string; userType: string }, pathname: string,
  route: EdgeTierRoute, gates: AgentTierGates,
): Promise<Response> {
  const guarded = await guardPolicy(
    env, classifyRatePolicy(request.method, pathname), authenticatedRateLimitKey(auth.userId), authRateLimitConfigFrom(env),
  );
  const identity = { userId: auth.userId, userType: auth.userType };
  return guarded ?? servedByTier(env, request, identity, route, gates);
}

/**
 * The tier routes an unauthenticated caller may still reach: the anonymous
 * pipeline below runs Turnstile, the limiter and the budget latch on the way
 * to them. That is the deliberate widening this module documents — a turn,
 * the transcript read and its stream.
 *
 * Everything else answers a flat 401 before anything opens a database.
 * `/v1/byok/probe` was already behind that wall (#1289: spending a caller's key
 * is the opposite of a cost-free read), and `list` joins it (Card E of #1317):
 * the conversation index is one account's own list, so an unauthenticated
 * caller gets the 401 BEFORE anything opens the database it would have been
 * scoped by.
 */
const ANONYMOUS_TIER_KINDS: readonly EdgeTierRoute["kind"][] = ["turn", "transcript", "stream"];

function admitsAnonymous(route: EdgeTierRoute): boolean {
  return ANONYMOUS_TIER_KINDS.includes(route.kind);
}

/**
 * Serve one agent-tier route to whichever identity the ladder resolves.
 *
 * Nothing below re-verifies anything; the identity resolved here is the one
 * the intake commits, and `admitsAnonymous` is the only thing that decides
 * whether an absent credential reaches the pipeline at all.
 */
export async function agentTierResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, pathname: string,
  route: EdgeTierRoute, gates: AgentTierGates,
): Promise<Response> {
  const auth = await gates.authenticate(request, env, ctx);
  if (auth.ok) return authenticatedTierResponse(env, request, auth, pathname, route, gates);
  if (auth.reason === "invalid") return unauthorized(pathname);
  if (!admitsAnonymous(route)) return credentialsRequired();
  const anonymous = await handleAnonymousV1(
    env, request, Date.now(), gates.turnstileGate,
    (identity) => servedByTier(env, request, { userId: identity.userId, userType: "anonymous" }, route, gates),
  );
  return anonymous ?? credentialsRequired();
}
