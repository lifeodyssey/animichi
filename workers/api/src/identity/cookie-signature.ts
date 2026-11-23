import { timingSafeEqual } from "node:crypto";

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
