import { readStoreOrString, type Env } from "../env.ts";
import type { TurnstileGate } from "../protect/turnstile.ts";
import { guardTurnstile } from "../protect/turnstile.ts";
import { credentialsRequired } from "../gateway/responses.ts";
import { resolveAnonymous } from "./auth.ts";
import { withAnonymousCookie } from "./anonymous-id.ts";
import { issueTurnstilePass } from "./turnstile-pass.ts";

function verifiedResponse(setCookie: string | null, passCookie: string): Response {
  const headers = new Headers();
  if (setCookie !== null) headers.append("Set-Cookie", setCookie);
  headers.append("Set-Cookie", passCookie);
  return new Response(null, { status: 204, headers });
}

/** Verify and establish the stable anonymous identity used by the first turn.
 * A refused verification still carries the identity it minted, so the retry
 * presents it rather than being issued another. */
export async function verifyAnonymousEntry(
  env: Env, request: Request, gate: TurnstileGate,
): Promise<Response> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return credentialsRequired();
  const challenged = await guardTurnstile(request, env, gate, identity.userId);
  if (challenged !== null) return withAnonymousCookie(challenged, identity.setCookie);
  const secret = await readStoreOrString(env.ANON_ID_SECRET);
  if (secret === undefined) return credentialsRequired();
  return verifiedResponse(identity.setCookie, await issueTurnstilePass(identity.userId, secret, Date.now()));
}
