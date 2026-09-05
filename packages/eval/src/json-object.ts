/**
 * A value as a JSON object, or nothing.
 *
 * Both readers here face the same question about untrusted JSON — a frame's
 * `input`, a published step's `params` — and Python asks it once too:
 * `ArgumentCorrectness` refuses arguments that "are not a JSON object" before
 * comparing anything. One declaration, so an array or a scalar cannot be a
 * record on one side of the pair and not the other.
 *
 * (`workers/edge/src/agent/json-record.ts` is the same narrowing on the other
 * tier; neither package may import the other's.)
 */

/** The value as a record, or null — an array and a scalar are both "not an object". */
export function objectOrNull(value: unknown): Readonly<Record<string, unknown>> | null {
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  return isObject ? (value as Readonly<Record<string, unknown>>) : null;
}
