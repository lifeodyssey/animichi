import { type AnonymousIdentity, resolveAnonymous } from "./auth.ts";
import { withAnonymousCookie } from "./anonymous-id.ts";
import { budgetGuidanceResponse, budgetLatched, isBudgetRejection, latchBudget, utcDayKey } from "../protect/cost-breaker.ts";
import { readStoreOrString, type Env } from "../env.ts";
import { rateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import type { RatePolicy } from "../gateway/rate-policy.ts";
import { type TurnstileGate, guardTurnstile } from "../protect/turnstile.ts";
import { verifyTurnstilePass } from "./turnstile-pass.ts";

/** The methods that only read: a HEAD is its GET without the body (RFC 9110 §9.3.2). */
const READ_METHODS: readonly string[] = ["GET", "HEAD"];

/** Normalize the ingress's breaker rejection into the shared login guidance,
 * and latch it so the edge short-circuits for the rest of the day. */
async function guardBudget(env: Env, response: Response, dayKey: string): Promise<Response> {
  // Check the status BEFORE the body: on a healthy /v1/chat, `clone().text()`
  // would buffer the whole SSE turn and destroy its streaming.
  if (response.status !== 403) return response;
  if (!isBudgetRejection(response.status, await response.clone().text())) return response;
  await latchBudget(env.EDGE_GUARD, dayKey);
  return budgetGuidanceResponse();
}

async function limitedOrNull(env: Env, rate: RatePolicy, identity: string): Promise<Response | null> {
  return guardPolicy(env, rate, identity, rateLimitConfigFrom(env));
}

/**
 * What an admitted anonymous caller is finally served (W1-7 #1256). The walls
 * above it — Turnstile, the per-identity limiter, the daily budget latch — are
 * the same whichever tier answers, so the service is the only thing that
 * varies; the agent tier passes the route it already selected.
 *
 * #1605 deleted the default this parameter used to carry: it was the container
 * forward, and the edge carries no container any more, so there is nothing else
 * an anonymous caller could be served by. */
export type AnonymousV1Service = (identity: AnonymousIdentity) => Promise<Response>;

/** One anonymous `/v1` request on its way through the walls. */
interface AnonymousCall {
  readonly env: Env;
  readonly request: Request;
  readonly nowMs: number;
  readonly gate: TurnstileGate;
  readonly rate: RatePolicy;
  readonly serve: AnonymousV1Service;
}

async function servedAnonymously(call: AnonymousCall, identity: AnonymousIdentity): Promise<Response> {
  const dayKey = utcDayKey(call.nowMs);
  if (await budgetLatched(call.env.EDGE_GUARD, dayKey)) return budgetGuidanceResponse();
  return guardBudget(call.env, await call.serve(identity), dayKey);
}

/** The Turnstile refusal, or null when the visitor holds a live pass for this
 * identity or solves the challenge. */
async function challengedOrNull(call: AnonymousCall, identity: AnonymousIdentity): Promise<Response | null> {
  const secret = await readStoreOrString(call.env.ANON_ID_SECRET) ?? "";
  if (await verifyTurnstilePass(call.request, identity.userId, secret, call.nowMs)) return null;
  return guardTurnstile(call.request, call.env, call.gate, identity.userId);
}

/** What the walls and the service answer this identity: a refusal, or what it is served. */
async function wallsAnswer(call: AnonymousCall, identity: AnonymousIdentity): Promise<Response> {
  const challenged = await challengedOrNull(call, identity);
  if (challenged !== null) return challenged;
  const limited = await limitedOrNull(call.env, call.rate, identity.userId);
  if (limited !== null) return limited;
  const readOnly = READ_METHODS.includes(call.request.method) && call.rate.cost === "low";
  return readOnly ? call.serve(identity) : servedAnonymously(call, identity);
}

/**
 * Mark this request as anonymously trusted and hand it to `serve`, or return
 * null when anonymous access is not enabled (leaving the caller on the 401
 * path). `rate` is the matched route's cell: it picks the limiter, and a cheap
 * read, a GET or its HEAD, skips the budget latch. The durable limiter FAILS
 * CLOSED (`#680` AC4): an anonymous chat turn is a high-cost write, so one that
 * cannot be metered is rejected (503) rather than run unmetered on a limiter
 * outage. The daily budget latch fails closed only on an explicit budget
 * verdict, and Turnstile stays the outer wall.
 *
 * Issue #447 arms the S1.9 Turnstile gate here, and the order is the point:
 *  - AFTER `resolveAnonymous`, so a challenge is only ever raised for a caller
 *    we would otherwise have served anonymously (anonymous access off still
 *    means 401, never 403);
 *  - BEFORE the limiter and the service, because the challenge is the outer
 *    wall. Cookie-only identity is free to reset, which resets the per-identity
 *    bucket with it; an unsolved turn must therefore cost neither a bucket slot
 *    (legitimate visitors would pay for their own challenges) nor a model call.
 *
 * Whatever answers, a wall's refusal or the service, carries the identity this
 * request minted, so a new visitor refused on a first request is not issued
 * another identity on the next.
 */
export async function handleAnonymousV1(
  env: Env, request: Request, nowMs: number, gate: TurnstileGate, rate: RatePolicy,
  serve: AnonymousV1Service,
): Promise<Response | null> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return null;
  const answer = await wallsAnswer({ env, request, nowMs, gate, rate, serve }, identity);
  return withAnonymousCookie(answer, identity.setCookie);
}
