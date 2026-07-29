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
 * is `//evil.test` in disguise), no raw whitespace or control characters.
 * Everything else falls back to `/`, never to an error.
 */

const FALLBACK = "/";

/** Raw whitespace or a C0/DEL control character anywhere in the path. */
function hasUnsafeChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isSameOriginPath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  // `..` segments can only ever resolve within-origin here, but rejecting
  // them keeps the "the honoured value IS the final path" invariant exact.
  if (value.split("/").includes("..")) return false;
  return !hasUnsafeChar(value);
}

/** The validated relative path, or `/` for anything that is not one. */
export function sanitizeReturnTarget(next: unknown): string {
  if (typeof next !== "string") return FALLBACK;
  const value = next.trim();
  return isSameOriginPath(value) ? value : FALLBACK;
}

/**
 * Does this return target open a *panel* on arrival, as opposed to merely
 * restoring a location? Today only the BYOK deep-link (`/chat?settings=byok`)
 * does.
 *
 * The distinction exists because of #480 P1-2: a failed create-on-login replay
 * must not strand a visitor who was mid-way through BYOK setup, so that case
 * navigates instead of showing the retry surface. Once the save wall started
 * carrying its own return target (#507 review P1-1), deriving "has a return
 * intent" from `next !== "/"` would have applied that rule to the save journey
 * too — silently retiring the retry/skip surface built for exactly it, in a
 * way no test would have caught because the tests pass the flag directly. So
 * the rule is narrowed to what #480 actually needed: a panel to get back to.
 * A plain session return keeps the retry surface.
 */
export function carriesPanelIntent(next: unknown): boolean {
  const target = sanitizeReturnTarget(next);
  const separator = target.indexOf("?");
  if (separator < 0) return false;
  return new URLSearchParams(target.slice(separator + 1)).has("settings");
}
