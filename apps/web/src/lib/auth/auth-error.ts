/**
 * Reading the message off an auth failure.
 *
 * Both shapes the SDK produces land here: a rejected promise (an `Error`) and a
 * resolved `{ error }` envelope. A leaf on purpose — the port and the browser
 * adapter both need it, and routing it through either would put a cycle between
 * them that Rollup answers by merging the adapter back into the server chunk.
 */
export function authErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}
