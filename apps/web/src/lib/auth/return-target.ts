/**
 * Post-login return-target validation (issue #284 Task 8, threat T14).
 *
 * The BYOK journey carries the "I was setting up my key" intent through the
 * magic-link callback URL as a `next` parameter — the link may open in a
 * different tab or browser, so per-tab storage cannot carry it. That makes
 * `next` caller-influenceable, i.e. an open-redirect sink: this module is the
 * single guard between it and `navigate()`. Only a same-origin **relative**
 * path survives — a single leading `/`, no scheme, no protocol-relative `//`,
 * no backslash in any position (browsers normalise `\` to `/`, so `/\evil.test`
 * is `//evil.test` in disguise), no dot segment after one percent-decode, and
 * no raw whitespace, C0/C1 control or DEL character. Everything else falls
 * back to `/`, never to an error.
 */
import { BYOK_SETUP_TARGET } from "../byok/byok-target";

const FALLBACK = "/";

/** Every Unicode whitespace (including the U+2028/U+2029 separators). */
const UNICODE_WHITESPACE = /\s/u;

/** C0 controls, DEL, and C1 controls (U+0080–U+009F, including NEL). */
function isControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function hasUnsafeChar(value: string): boolean {
  if (UNICODE_WHITESPACE.test(value)) return true;
  for (const char of value) {
    if (isControlCode(char.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

/** `decodeURIComponent` throws on a malformed `%` sequence; that is a
 * rejection, never a pass-through. */
function decodeOnce(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function hasDotSegment(value: string): boolean {
  return value.split("/").includes("..");
}

/** The shape checks that apply to the raw value and again to its once-decoded
 * form: a single leading `/`, no protocol-relative `//`, no backslash, no
 * `..`. Whitespace is checked separately — only on the raw value, since a
 * legitimate deep link may carry a percent-encoded space. */
function hasSafeShape(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") &&
    !value.includes("\\") && !hasDotSegment(value);
}

/** The raw value AND its once-decoded form: `%2e` becomes a `.` only after the
 * decode, so checking the raw string alone lets `/.%2e//evil.test` through to
 * a `new URL()` that normalises it to the rejected `//` shape. Rejecting the
 * decoded form keeps the "the honoured value IS the final path" invariant. */
function isSameOriginPath(value: string): boolean {
  const decoded = decodeOnce(value);
  return decoded !== undefined && hasSafeShape(value) && !hasUnsafeChar(value) && hasSafeShape(decoded);
}

/** Trim only the ASCII whitespace a hand-written link might carry; any other
 * whitespace or control is a rejection, not a trim. */
const ASCII_EDGE_WHITESPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/gu;

/** The validated relative path, or `/` for anything that is not one. */
export function sanitizeReturnTarget(next: unknown): string {
  if (typeof next !== "string") return FALLBACK;
  const value = next.replace(ASCII_EDGE_WHITESPACE, "");
  return isSameOriginPath(value) ? value : FALLBACK;
}

/**
 * Does this return target resume the BYOK setup journey, as opposed to merely
 * restoring a location? The dedicated settings section is the one such path.
 *
 * The distinction exists because of #480 P1-2: a failed create-on-login replay
 * must not strand a visitor who was mid-way through BYOK setup, so that case
 * navigates instead of showing the retry surface. Once the save wall started
 * carrying its own return target (#507 review P1-1), deriving "has a return
 * intent" from `next !== "/"` would have applied that rule to the save journey
 * too — silently retiring the retry/skip surface built for exactly it, in a
 * way no test would have caught because the tests pass the flag directly. So
 * the rule is narrowed to what #480 actually needed: setup to get back to.
 * A plain session return keeps the retry surface.
 */
export function carriesSetupIntent(next: unknown): boolean {
  return sanitizeReturnTarget(next) === BYOK_SETUP_TARGET;
}
