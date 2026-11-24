/**
 * A returning anonymous visitor's cookie header, signed with the Worker's own signing code: an `aid`
 * naming the visitor, and a Turnstile pass for that identity, so the visitor reaches the anonymous
 * reads without a challenge. The pass is issued at the start of 2100, so no clock enters the test.
 */
import { hmacHex } from "../src/identity/cookie-signature.ts";
import { issueTurnstilePass } from "../src/identity/turnstile-pass.ts";

const VISITOR = "0123456789abcdef0123456789abcdef";
const PASS_ISSUED_AT = Date.UTC(2100, 0, 1);

/** `secret` is the Worker's `ANON_ID_SECRET`, which signs both cookies. */
export async function anonymousVisitorCookie(secret: string): Promise<string> {
  const aid = `aid=${VISITOR}.${await hmacHex(secret, VISITOR)}`;
  const setPass = await issueTurnstilePass(`anon_${VISITOR}`, secret, PASS_ISSUED_AT);
  return `${aid}; ${setPass.slice(0, setPass.indexOf(";"))}`;
}
