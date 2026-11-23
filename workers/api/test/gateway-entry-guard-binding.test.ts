/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins the record the gateway writes when a durable class's request finds
 * the guard's binding (`EDGE_GUARD`) missing, which is a configuration error:
 * one structured line that names the binding and carries the request's ID and
 * nothing else, so no secret and no binding value can ride along. The line may
 * go out through `console.warn` or `console.error`, so both are read. What the
 * request answers is pinned in `gateway-entry-envelopes.test.ts`.
 *
 * test-type: characterization
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";

const BINDING = "EDGE_GUARD";
const UNBOUND = { [BINDING]: undefined };

/** Every line the gateway logs from here on, through either console channel. */
function logged(t: TestContext): string[] {
  const lines: string[] = [];
  const keep = (line: unknown): void => { lines.push(String(line)); };
  t.mock.method(console, "warn", keep);
  t.mock.method(console, "error", keep);
  return lines;
}

/** The logged lines that name the binding, as the records they are. */
function namingTheBinding(lines: readonly string[]): Record<string, unknown>[] {
  return lines.filter((line) => line.includes(BINDING)).map((line) => JSON.parse(line) as Record<string, unknown>);
}

void test("a durable class with its guard binding unbound logs one record naming the binding and the request, and nothing else", async (t) => {
  const lines = logged(t);
  const seam = entrySeam(t, UNLIMITED, UNBOUND);
  const response = await seam.send("POST", "/v1/chat", HUMAN);
  const requestId = response.headers.get("X-Request-Id");
  assert.deepEqual(namingTheBinding(lines), [{ event: "edge_guard_binding_missing", binding: BINDING, request_id: requestId }]);
});
