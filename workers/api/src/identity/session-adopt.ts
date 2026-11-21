import { gatewayRejection } from "../gateway/responses.ts";
import type { Env } from "../env.ts";
import { ANON_ID_PREFIX, resolveAnonymousReadOnly } from "./auth.ts";
import { rejectClientSessionId } from "./session-adoption-boundary.ts";
import {
  createSessionAdoptionStore,
  type SessionAdoptionResult,
  type SessionAdoptionStore,
} from "./session-adoption-store.ts";

export { ADOPT_TURN_KEY_PREFIX } from "./session-adoption-marker.ts";
export { MAX_BODY_BYTES, rejectClientSessionId } from "./session-adoption-boundary.ts";
export { adoptSessions } from "./session-adoption-store.ts";
export type { AdoptionNoopClass, SessionAdoptionResult, SessionAdoptionStore } from "./session-adoption-store.ts";

// ── Session adoption (SESSION-2 #960) ──────────────────────────────
//
// The edge resolves (never mints) the caller's `aid` cookie and performs the
// identity-dimensional ownership update itself. The cookie is deliberately
// not retired afterwards (#507): the anonymous identity keeps its quota bucket
// even though it no longer owns any sessions.

export const SESSION_ADOPT_PATH = "/v1/sessions/adopt";

function verifiedAccount(auth: { userId: string; userType: string }): boolean {
  return auth.userType === "human" && auth.userId.length > 0 && !auth.userId.startsWith(ANON_ID_PREFIX);
}

function noAnonymousIdentityResponse(): Response {
  return Response.json({ adopted: 0, noop_class: "no_anonymous_identity", revisions_bumped: 0 });
}

async function adoptionRequestRejection(
  request: Request, auth: { userId: string; userType: string },
): Promise<Response | null> {
  const rejected = await rejectClientSessionId(request);
  if (rejected) return rejected;
  return verifiedAccount(auth) ? null : gatewayRejection("forbidden", 403, "Anonymous identity cannot adopt sessions.");
}

async function adoptIdentity(
  env: Env, request: Request, auth: { userId: string; userType: string }, store?: SessionAdoptionStore,
): Promise<SessionAdoptionResult | null> {
  const identity = await resolveAnonymousReadOnly(request, env);
  if (!identity) return null;
  return (store ?? createSessionAdoptionStore(env)).adopt(identity.userId, auth.userId);
}

export async function handleSessionAdopt(
  env: Env, request: Request, auth: { userId: string; userType: string }, store?: SessionAdoptionStore,
): Promise<Response> {
  const rejected = await adoptionRequestRejection(request, auth);
  if (rejected) return rejected;
  const result = await adoptIdentity(env, request, auth, store);
  return result ? Response.json(result) : noAnonymousIdentityResponse();
}
