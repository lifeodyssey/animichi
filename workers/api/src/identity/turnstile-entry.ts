import { readStoreOrString, type Env } from "../env.ts";
import { TURNSTILE_HEADER, type TurnstileGate, guardTurnstile } from "../protect/turnstile.ts";
import { credentialsRequired } from "../gateway/responses.ts";
import { type AnonymousIdentity, resolveAnonymous } from "./auth.ts";
import { withAnonymousCookie } from "./anonymous-id.ts";
import { issueTurnstilePass, verifyTurnstilePass } from "./turnstile-pass.ts";

/** A verified visitor's answer, as a solved challenge has always had it: 204
 * with no body, writing the identity this request minted, then the pass it was
 * issued, when one was. */
function verifiedResponse(setCookie: string | null, passCookie: string | null): Response {
  const headers = new Headers();
  if (setCookie !== null) headers.append("Set-Cookie", setCookie);
  if (passCookie !== null) headers.append("Set-Cookie", passCookie);
  return new Response(null, { status: 204, headers });
}

/** Whether a request that presents no token holds a live pass for this
 * identity. One that presents a token is checked as it always has been, and a
 * solved token earns a new pass, held pass or not. */
async function holdsLivePass(env: Env, request: Request, identity: AnonymousIdentity): Promise<boolean> {
  if (request.headers.has(TURNSTILE_HEADER)) return false;
  const secret = await readStoreOrString(env.ANON_ID_SECRET) ?? "";
  return verifyTurnstilePass(request, identity.userId, secret, Date.now());
}

/**
 * Verify and establish the stable anonymous identity used by the first turn.
 *
 * A visitor with no token who holds a live pass for this identity is answered
 * as a solved challenge is, without asking the gate and without a new pass: a
 * pass is never renewed without a challenge, so it still ends when it was due
 * to. A refused verification still carries the identity it minted, so the
 * retry presents it rather than being issued another.
 */
export async function verifyAnonymousEntry(
  env: Env, request: Request, gate: TurnstileGate,
): Promise<Response> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return credentialsRequired();
  if (await holdsLivePass(env, request, identity)) return verifiedResponse(identity.setCookie, null);
  const challenged = await guardTurnstile(request, env, gate, identity.userId);
  if (challenged !== null) return withAnonymousCookie(challenged, identity.setCookie);
  const secret = await readStoreOrString(env.ANON_ID_SECRET);
  if (secret === undefined) return credentialsRequired();
  return verifiedResponse(identity.setCookie, await issueTurnstilePass(identity.userId, secret, Date.now()));
}
