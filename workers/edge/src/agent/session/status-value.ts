/**
 * One externally-sourced string, in the only form the `<agent_status>` bar may
 * state it (card #1379).
 *
 * The bar is a structured document the model is told to trust: a `user` message
 * opened by `<agent_status>`, one fact per line, free text inside `「」`. Every
 * one of those three structures is made of characters, and a value that
 * contains them can forge them — which is a real injection path, because the
 * values come from the catalog, the geocoder and the user's own words. Three
 * concrete escapes this closes:
 * - a value carrying `</agent_status>` closes the tag early, so everything the
 *   attacker writes after it reads as ordinary conversation rather than as a
 *   quoted fact;
 * - a value carrying a newline forges a second STATUS LINE, which the model
 *   reads with the same standing as the ones the server wrote;
 * - a value carrying `」` closes the quotes early, so the rest of it reads as
 *   the server's own directive on that line.
 *
 * WHY IT IS NOT `trusted-text.ts` ALONE. That one is the memory ledgers' WRITE
 * gate (#1290) and it answers two of the hazards — control characters and
 * length. It does not strip `「」` or `<>`, and two of the values on the bar
 * never pass through it at all: the resolved anime title and the clarification
 * candidates live on `SessionEnvelope`, not in a ledger. So the bar sanitises
 * at RENDER time, where every value it states is in hand, and does so in one
 * place rather than once per line.
 *
 * Escaping was considered and rejected in favour of removal: an escape scheme
 * is a second grammar the model has to be taught, and nothing downstream reads
 * these strings back — they are shown, never parsed.
 */
import { trustedText } from "../memory/trusted-text.ts";

/** The byte budget one value gets, matching the ledgers' own per-value cap. */
export const STATUS_VALUE_MAX_BYTES = 96;

/** Everything the bar builds its own structure out of. A value may contain no
 * character that could end the wrapper, the tag, or the line. */
const STRUCTURAL = /[「」<>]/gu;

/** A value the bar can state on one line, inside its own structure, whatever
 * the world put in it. */
export function statusValue(raw: string): string {
  return trustedText(raw.replaceAll(STRUCTURAL, ""), STATUS_VALUE_MAX_BYTES);
}

/** The same value inside the quotes free text is stated in. The quotes are the
 * bar's, and `statusValue` is what makes them unforgeable from inside. */
export function quotedStatusValue(raw: string): string {
  return `「${statusValue(raw)}」`;
}
