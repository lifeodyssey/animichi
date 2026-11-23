import { timingSafeEqual } from "node:crypto";

/** The shape of every signature `hmacHex` returns, and so the only shape a
 * cookie's signature can match: 64 lower-case hex characters. Unanchored, so
 * each cookie builds its whole-value pattern from it. */
export const SIGNATURE_PATTERN = /[0-9a-f]{64}/;

/** The lower-case hex HMAC-SHA-256 of `message` under `secret`: the signature
 * the `aid` cookie and the Turnstile pass carry. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a signed cookie's presented signature equals the one the Worker
 * computes, compared by `node:crypto`'s `timingSafeEqual`, which workerd
 * provides under this Worker's `nodejs_compat` flag. It compares bytes and
 * throws on unequal lengths, so unequal lengths answer false before it is
 * asked: the length of an HMAC-SHA-256 hex signature is public. The bytes are
 * the strings' UTF-8, and the expected signature is ASCII hex, so a presented
 * signature holding any non-ASCII character never matches, whatever its length.
 */
export function signaturesMatch(presented: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(presented);
  const right = encoder.encode(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
