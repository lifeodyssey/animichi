/**
 * The one shape an untrusted JSON value has to be before anything can be read
 * out of it — a plain object. Four readers in the agent tier need exactly this
 * check (a database row, a Durable Object request body, a sweep row), so the
 * concept is named once here rather than re-declared beside each of them.
 */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
