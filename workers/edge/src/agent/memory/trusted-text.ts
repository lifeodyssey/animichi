/**
 * The form an externally-sourced string takes before it enters session memory
 * (card #1290) — port of `apps/agent`'s `domain/text_sanitize.py`.
 *
 * Both ledgers in this folder hold strings the world supplied (a point name, a
 * place name, an anime title), and this is their WRITE gate: what it answers is
 * what a stored record may contain, so a ledger's size and its line count stay
 * bounded however hostile the value was. Two hazards, one function:
 * - a value carrying newlines or control characters could forge extra
 *   context-shaped lines once replayed, so they collapse to single spaces;
 * - a value of unbounded length would spend the whole prompt budget, so it is
 *   truncated by ENCODED BYTES rather than by characters — a Japanese point
 *   name is three bytes per character and a character count would let one
 *   value cost three times its budget.
 *
 * The cut is moved back to a UTF-8 boundary rather than decoded with
 * replacement characters: Python sliced the encoded form and decoded with
 * `errors="ignore"`, which drops a partial sequence, and a `U+FFFD` in its
 * place would be a character the source never contained.
 *
 * IT IS NOT THE RENDER GATE, and must not be read as one. It leaves `「」` and
 * `<>` in the value, which are exactly the characters the `<agent_status>` bar
 * builds its own structure from; what a value may look like once it is STATED
 * to the model is `src/agent/session/status-value.ts` (#1379), which runs over
 * every value the bar carries, ledger-held or not.
 */

const ELLIPSIS = "…";
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** The ellipsis' own three bytes, reserved out of the budget up front. */
const ELLIPSIS_BYTES = ENCODER.encode(ELLIPSIS).length;

/** Control characters, DEL, and every line/paragraph separator a JSON string
 * can carry — tested by code point rather than by a character class, because a
 * regex holding them is a lint error and the set is short enough to name. */
const SEPARATORS = new Set([0x85, 0x2028, 0x2029]);

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f || SEPARATORS.has(code);
}

/** The UTF-8 byte length of a string, which is what both caps are measured in. */
export function encodedBytes(value: string): number {
  return ENCODER.encode(value).length;
}

/** Control characters gone and runs of whitespace collapsed to one space. */
function collapsed(value: string): string {
  return Array.from(value)
    .map((character) => (isControl(character) ? " " : character))
    .join("")
    .split(/\s+/u)
    .filter((word) => word !== "")
    .join(" ");
}

/** The last index at or before `limit` that does not split a code point. */
function boundary(bytes: Uint8Array, limit: number): number {
  let cut = limit;
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut -= 1;
  return cut;
}

/** Sanitized, then truncated to at most `maxBytes` encoded UTF-8 bytes. */
export function trustedText(value: string, maxBytes: number): string {
  const clean = collapsed(value);
  const bytes = ENCODER.encode(clean);
  if (bytes.length <= maxBytes) return clean;
  return DECODER.decode(bytes.subarray(0, boundary(bytes, maxBytes - ELLIPSIS_BYTES))) + ELLIPSIS;
}
