import { TURNSTILE_WINDOW_MS } from "@animichi/contract/constants";
import { firstVerifiedCookie } from "./cookie-header.ts";
import { hmacHex, SIGNATURE_PATTERN, signaturesMatch } from "./cookie-signature.ts";

const PASS_COOKIE = "turnstile_pass";
/** A whole pass value: its expiry in milliseconds, a dot and its signature, with nothing after it. */
const PASS_PATTERN = new RegExp(`^(\\d+)\\.(${SIGNATURE_PATTERN.source})$`);

interface Pass {
  readonly expiresAt: number;
  readonly signature: string;
}

function payload(identity: string, expiresAt: number): string {
  return `${identity}\n${String(expiresAt)}`;
}

function cookie(value: string): string {
  const maxAge = Math.floor(TURNSTILE_WINDOW_MS / 1_000);
  return `${PASS_COOKIE}=${value}; Path=/; Max-Age=${String(maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}

/** Issue an aid-bound proof; the single-use Turnstile token is never stored. */
export async function issueTurnstilePass(
  identity: string, secret: string, nowMs: number,
): Promise<string> {
  const expiresAt = nowMs + TURNSTILE_WINDOW_MS;
  const signature = await hmacHex(secret, payload(identity, expiresAt));
  return cookie(`${String(expiresAt)}.${signature}`);
}

function parsePass(value: string): Pass | null {
  const match = PASS_PATTERN.exec(value);
  if (match === null) return null;
  const expiresAt = Number(match[1]);
  const signature = match[2];
  if (!Number.isSafeInteger(expiresAt) || signature === undefined) return null;
  return { expiresAt, signature };
}

/** The pass `value` holds, when it verifies for `identity` at `nowMs`. */
async function verifiedPass(value: string, identity: string, secret: string, nowMs: number): Promise<Pass | null> {
  const pass = parsePass(value);
  if (pass === null || pass.expiresAt <= nowMs) return null;
  const expected = await hmacHex(secret, payload(identity, pass.expiresAt));
  return signaturesMatch(pass.signature, expected) ? pass : null;
}

/** Validate the proof in any isolate against the resolved anonymous identity:
 * the request holds one when any of its passes the reader tries verifies. */
export async function verifyTurnstilePass(
  request: Request, identity: string, secret: string, nowMs: number,
): Promise<boolean> {
  const pass = await firstVerifiedCookie(request, PASS_COOKIE, (value) => verifiedPass(value, identity, secret, nowMs));
  return pass !== null;
}
