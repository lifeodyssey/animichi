/**
 * #1903: the recordings the browser suite serves must describe the envelope the
 * product sends.
 *
 * `responseChunks` (`workers/edge/src/agent/views/public-content.ts`) takes
 * `sessionId: string` and writes it into the response part, so a deployed turn
 * always assigns one. A recording that carries none — as these did until #1903
 * — makes every spec built on it measure the fixture instead of the page, and
 * #1512's AC2 would have gone red on every run for a reason that says nothing
 * about the product.
 *
 * The bytes read here are the bytes `chatStreamRecording` serves: the fixture
 * patches only what a spec asks it to (`patchSessionId`/`patchFinalFrame`), so
 * a recording that loses its id fails here rather than inside a spec's URL
 * regex. `error.sse` is out of the table on purpose — that turn never reaches a
 * `data-response` envelope (`responseChunks` answers a failure with a bare
 * `error` chunk), so it has no frame that could carry an id.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const RECORDING_DIR = fileURLToPath(new URL("../../packages/contract/fixtures/chat-stream", import.meta.url));

/** The recordings whose turn settles into a full `data-response` envelope. */
const ENVELOPE_RECORDINGS = ["search", "clarify"] as const;

/** The frame `patchSessionId` rewrites — the full envelope, not the intent-only opener. */
const FINAL_ENVELOPE_MARKER = 'data: {"type":"data-response"';

function servedFinalEnvelope(name: string): Record<string, unknown> {
  const envelopes = readFileSync(join(RECORDING_DIR, `${name}.sse`), "utf8")
    .split("\n")
    .filter((line) => line.startsWith(FINAL_ENVELOPE_MARKER))
    .map((line) => JSON.parse(line.slice("data: ".length)) as { data: Record<string, unknown> });
  const final = envelopes.at(-1);
  assert.ok(final !== undefined, `${name}.sse serves no final envelope`);
  return final.data;
}

for (const name of ENVELOPE_RECORDINGS) {
  void test(`the ${name} recording's final envelope assigns a session id`, () => {
    const assigned: unknown = servedFinalEnvelope(name).session_id;
    assert.equal(typeof assigned, "string", `${name}.sse: the final envelope must carry a session_id`);
    assert.notEqual(assigned, "");
  });
}
