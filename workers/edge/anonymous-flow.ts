import { type AnonymousIdentity, resolveAnonymous } from "./auth.ts";
import { budgetGuidanceResponse, budgetLatched, isBudgetRejection, latchBudget, utcDayKey } from "./costBreaker.ts";
import type { Env } from "./env.ts";
import { forwardV1 } from "./forward.ts";
import { checkRateLimit, rateLimitConfigFrom } from "./rateLimiter.ts";
import { rateLimitedResponse } from "./responses.ts";
import { type TurnstileGate, guardTurnstile } from "./turnstile.ts";

function withAnonymousCookie(response: Response, setCookie: string | null): Response {
  if (setCookie === null) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, { status: response.status, headers });
}

/** Normalize the container ingress's breaker rejection into the shared login
 * guidance, and latch it so the edge short-circuits for the rest of the day. */
async function guardBudget(env: Env, response: Response, dayKey: string): Promise<Response> {
  // Check the status BEFORE touching the body. `/v1/chat` answers with an SSE
  // StreamingResponse, so reading a clone waits for the container to finish the
  // whole turn — passing `await response.clone().text()` as an argument would
  // evaluate it on every response, including healthy 200s, and silently destroy
  // streaming for every anonymous turn (while buffering it twice in memory).
  if (response.status !== 403) return response;
  if (!isBudgetRejection(response.status, await response.clone().text())) return response;
  await latchBudget(env.EDGE_GUARD, dayKey);
  return budgetGuidanceResponse();
}

async function anonymousForward(
  env: Env, request: Request, identity: AnonymousIdentity, dayKey: string,
): Promise<Response> {
  if (await budgetLatched(env.EDGE_GUARD, dayKey)) return budgetGuidanceResponse();
  const forwarded = await forwardV1(env, request, { userId: identity.userId, userType: "anonymous" });
  return guardBudget(env, forwarded, dayKey);
}

/**
 * Mark this request as anonymously trusted and forward it, or return null when
 * anonymous access is not enabled (leaving the caller on the 401 path). The
 * limiter fails open — a guard outage must not take chat down — while the
 * budget breaker fails closed only on an explicit container verdict.
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
export async function handleAnonymousV1(
  env: Env, request: Request, nowMs: number, gate: TurnstileGate,
): Promise<Response | null> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return null;
  const challenged = await guardTurnstile(request, env, gate, identity.userId);
  if (challenged !== null) return challenged;
  const limit = await checkRateLimit(env.EDGE_GUARD, identity.userId, rateLimitConfigFrom(env));
  if (limit !== null && !limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const response = await anonymousForward(env, request, identity, utcDayKey(nowMs));
  return withAnonymousCookie(response, identity.setCookie);
}
