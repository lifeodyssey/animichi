/**
 * Request authentication (#1792): the caller signs, the service verifies — a
 * shared key never crosses the wire.
 *
 * The scheme, shared with the catalog caller (`workers/catalog`'s egress
 * request module):
 *   timestamp  unix seconds, header `x-egress-timestamp`
 *   message    `${timestamp}\n${path}` — the request path exactly as the
 *              service receives it (one of the two operation routes)
 *   signature  lowercase-hex HMAC-SHA256 of the message, header `x-egress-signature`
 *
 * A captured request cannot be replayed past the window, and no credential
 * can land in a log. Two keys are accepted — a current and a previous — so
 * rotation needs no coordinated cut-over: add the new key to the service,
 * switch the caller, drop the old one. Comparison goes through
 * `crypto.timingSafeEqual`: a naive string comparison would leak the
 * signature byte by byte.
 */
import crypto from "node:crypto";

/** How far a signature's timestamp may sit from now, in seconds (five minutes). */
export const SIGNATURE_WINDOW_SECONDS = 300;

export const TIMESTAMP_HEADER = "x-egress-timestamp";
export const SIGNATURE_HEADER = "x-egress-signature";

/** The two signature headers, as the request carries them. */
export interface SignatureHeaders {
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
}

/** The keys a signature may verify against: the current key, and optionally the previous one. */
export interface SigningKeys {
  readonly current: string;
  readonly previous: string | null;
}

/** The outcome of one verification: a bare boolean — no reason an attacker could profile. */
export type SignatureVerdict = { ok: true } | { ok: false };

/** Verify a request's signature headers against the signing keys. */
export function verifyRequestSignature(
  keys: SigningKeys,
  headers: SignatureHeaders,
  path: string,
  nowSeconds: number,
): SignatureVerdict {
  const timestamp = parseTimestamp(headers.timestamp);
  if (timestamp === null || !withinWindow(timestamp, nowSeconds)) return { ok: false };
  if (typeof headers.signature !== "string") return { ok: false };
  const message = `${String(timestamp)}\n${path}`;
  if (matches(keys.current, message, headers.signature)) return { ok: true };
  if (keys.previous !== null && matches(keys.previous, message, headers.signature)) return { ok: true };
  return { ok: false };
}

/** Decimal unix seconds only — no floats, no exponents, no whitespace. */
function parseTimestamp(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,12}$/.test(raw)) return null;
  return Number(raw);
}

function withinWindow(timestampSeconds: number, nowSeconds: number): boolean {
  return Math.abs(nowSeconds - timestampSeconds) <= SIGNATURE_WINDOW_SECONDS;
}

/** Constant-time comparison of the provided signature against the computed digest. */
function matches(key: string, message: string, provided: string): boolean {
  const expected = crypto.createHmac("sha256", key).update(message).digest("hex");
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length !== providedBytes.length) return false;
  return crypto.timingSafeEqual(expectedBytes, providedBytes);
}
