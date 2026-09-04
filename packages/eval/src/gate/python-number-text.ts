/**
 * Python's three float renderings, digit for digit.
 *
 * The gate's failure strings and the baseline files are compared across the
 * two languages, so `toFixed` and `String` are not close enough:
 *
 * - `format(v, '.4f')` rounds a decimal tie to **even**, `toFixed` rounds it
 *   away from zero — `0.15625` is `0.1562` in Python and `0.1563` in JS, and
 *   a stratum of 32 paired cases produces exactly that kind of value.
 * - `format(v, '.0%')` multiplies by 100 first and then rounds the same way.
 * - `repr(v)` writes `1.0`, not `1`; switches to exponent notation at
 *   `1e-05` / `1e+16` rather than JS's `1e-7` / `1e+21`; and pads the
 *   exponent to two digits.
 *
 * Pinned against `fixtures/stats-oracle.json` (`number_text`).
 */

/**
 * Enough decimals to separate a double that is an exact decimal tie from one
 * that merely rounds to `…5`: at the magnitudes a `.4f` tie needs (≥ 5e-05)
 * one unit in the last place is ≥ 1e-20, so 40 places always show a remainder.
 */
const TIE_DIGITS = 40;

/** `format(value, '.<digits>f')`. */
export function pythonFixedText(value: number, digits: number): string {
  const truncated = truncatedText(value, digits);
  if (isHalfway(value, digits) && endsEven(truncated)) {
    return truncated;
  }
  return negativeZeroAware(value, value.toFixed(digits));
}

/** `format(rate, '.0%')` — Python scales by 100 before it rounds. */
export function pythonPercentText(rate: number): string {
  return `${pythonFixedText(rate * 100, 0)}%`;
}

/** `repr(value)` for a finite float. */
export function pythonFloatText(value: number): string {
  const exponent = decimalExponent(value);
  if (exponent <= -5 || exponent >= 16) {
    return scientificText(value);
  }
  return negativeZeroAware(value, integerAwareText(value));
}

function integerAwareText(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function negativeZeroAware(value: number, text: string): string {
  return Object.is(value, -0) ? `-${text}` : text;
}

function decimalExponent(value: number): number {
  return value === 0 ? 0 : Number(exponentPart(value.toExponential()));
}

function scientificText(value: number): string {
  const written = value.toExponential();
  const exponent = exponentPart(written);
  const sign = exponent.startsWith('-') ? '-' : '+';
  const digits = exponent.replace(/[+-]/, '').padStart(2, '0');
  return `${written.split('e')[0] ?? '0'}e${sign}${digits}`;
}

function exponentPart(written: string): string {
  return written.split('e')[1] ?? '+0';
}

function isHalfway(value: number, digits: number): boolean {
  const exact = Math.abs(value).toFixed(TIE_DIGITS);
  const tail = exact.slice(exact.indexOf('.') + 1 + digits);
  return tail === `5${'0'.repeat(TIE_DIGITS - digits - 1)}`;
}

function truncatedText(value: number, digits: number): string {
  const exact = value.toFixed(TIE_DIGITS);
  const width = digits === 0 ? 0 : digits + 1;
  return exact.slice(0, exact.indexOf('.') + width);
}

function endsEven(text: string): boolean {
  return Number(text.slice(-1)) % 2 === 0;
}
