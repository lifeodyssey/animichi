/** What a `console.error` spy recorded, one value per call: its first argument, the error Hono logs for a 500. */
export function loggedErrors(logged: { mock: { calls: unknown[][] } }): unknown[] {
  return logged.mock.calls.map(([error]) => error);
}
