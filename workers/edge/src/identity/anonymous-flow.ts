import { type AnonymousIdentity, resolveAnonymous } from "./auth.ts";
import { budgetGuidanceResponse, budgetLatched, isBudgetRejection, latchBudget, utcDayKey } from "../protect/cost-breaker.ts";
import type { Env } from "../env.ts";
import { forwardV1 } from "../gateway/forward.ts";
import { rateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { classifyRatePolicy } from "../gateway/rate-policy.ts";
import { type TurnstileGate, guardTurnstile } from "../protect/turnstile.ts";

function withAnonymousCookie(response: Response, setCookie: string | null): Response {
  if (setCookie === null) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, { status: response.status, headers });
}

/** Normalize the container ingress's breaker rejection into the shared login
 * guidance, and latch it so the edge short-circuits for the rest of the day. */
async function guardBudget(env: Env, response: Response, dayKey: string): Promise<Response> {
  // Check the status BEFORE the body: on a healthy /v1/chat, `clone().text()`
  // would buffer the whole SSE turn and destroy its streaming.
  if (response.status !== 403) return response;
  if (!isBudgetRejection(response.status, await response.clone().text())) return response;
  await latchBudget(env.EDGE_GUARD, dayKey);
  return budgetGuidanceResponse();
}

async function limitedOrNull(env: Env, request: Request, identity: string): Promise<Response | null> {
  return guardPolicy(env, classifyRatePolicy(request.method, new URL(request.url).pathname), identity, rateLimitConfigFrom(env));
}

async function anonymousForward(
  env: Env, request: Request, identity: AnonymousIdentity, nowMs: number,
): Promise<Response> {
  const dayKey = utcDayKey(nowMs);
  if (await budgetLatched(env.EDGE_GUARD, dayKey)) return budgetGuidanceResponse();
  const forwarded = await forwardV1(env, request, { userId: identity.userId, userType: "anonymous" });
  return guardBudget(env, forwarded, dayKey);
}

/**
 * Mark this request as anonymously trusted and forward it, or return null when
 * anonymous access is not enabled (leaving the caller on the 401 path). The
 * durable limiter FAILS CLOSED (`#680` AC4): an anonymous chat turn is a
 * high-cost write, so one that cannot be metered is rejected (503) rather
 * than run unmetered on a limiter outage. The daily budget latch still fails
 * closed only on an explicit container verdict, and Turnstile stays the outer
 * wall.
 *
 * Issue #447 arms the S1.9 Turnstile gate here, and the order is the point:
 *  - AFTER `resolveAnonymous`, so a challenge is only ever raised for a caller
 *    we would otherwise have served anonymously (anonymous access off still
 *    means 401, never 403);
 *  - BEFORE the limiter and the container, because the challenge is the outer
 *    wall. Cookie-only identity is free to reset, which resets the per-identity
 *    bucket with it; an unsolved turn must therefore cost neither a bucket slot
 *    (legitimate visitors would pay for their own challenges) nor an LLM call.
 */
export async function handleAnonymousV1(env: Env, request: Request, nowMs: number, gate: TurnstileGate): Promise<Response | null> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return null;
  const challenged = await guardTurnstile(request, env, gate, identity.userId);
  if (challenged !== null) return challenged;
  const limited = await limitedOrNull(env, request, identity.userId);
  if (limited !== null) return limited;
  return withAnonymousCookie(await anonymousForward(env, request, identity, nowMs), identity.setCookie);
}
