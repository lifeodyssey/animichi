/**
 * #1918: a served recording must describe an envelope the product sends.
 *
 * `responseChunks` (`workers/edge/src/agent/views/public-content.ts`) is the
 * only writer of the chat final envelope. The recordings the browser suite
 * and the MSW handlers serve are read here as the same bytes those replayers
 * read, and their final envelope may carry no member the writer does not
 * emit — a spec replaying a recording that carries `session`, `route_history`
 * or `errors` measures the fixture, not the page (#1903 fixed `session_id`
 * alone; this generalizes the rule to every member).
 *
 * The check is a round trip: each recording's own final envelope is fed back
 * through `responseChunks`, and the test fails when the writer drops a member
 * the recording carries. The writer's member set is therefore never copied
 * into a list here — a member the edge starts writing is admitted by this
 * test without an edit to it, and a member it stops writing fails the next
 * recording that carries it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";
import { responseChunks } from "../src/agent/views/public-content.ts";

const RECORDING_DIR = fileURLToPath(new URL("../../../packages/contract/fixtures/chat-stream", import.meta.url));

/** The recordings whose turn settles into a full `data-response` envelope.
 * `error.sse` never reaches one (`responseChunks` answers a failure with a
 * bare `error` chunk), so it has no frame this test could check. */
const ENVELOPE_RECORDINGS = ["search", "clarify"] as const;

const FINAL_ENVELOPE_MARKER = 'data: {"type":"data-response"';

/** `responseChunks` echoes this argument as the `session_id` member; the
 * round trip judges members, not values, so any session id will do. */
const ROUND_TRIP_SESSION = "s-recording";

function membersOf(data: unknown): readonly string[] {
  assert.equal(typeof data, "object");
  assert.notEqual(data, null);
  return Object.keys(data as Record<string, unknown>).sort();
}

function servedFinalEnvelope(name: string): Record<string, unknown> {
  const frames = readFileSync(join(RECORDING_DIR, `${name}.sse`), "utf8")
    .split("\n")
    .filter((line) => line.startsWith(FINAL_ENVELOPE_MARKER))
    .map((line) => JSON.parse(line.slice("data: ".length)) as { data: Record<string, unknown> });
  const final = frames.at(-1);
  assert.ok(final !== undefined, `${name}.sse serves no final envelope`);
  return final.data;
}

for (const name of ENVELOPE_RECORDINGS) {
  void test(`the ${name} recording's final envelope carries only members responseChunks writes`, () => {
    const served = servedFinalEnvelope(name);
    const written = responseChunks(served, ROUND_TRIP_SESSION, new SecretScrub()).at(-1);
    assert.ok(written !== undefined, "responseChunks produced no chunk");
    assert.ok("data" in written, "responseChunks refuses this envelope");
    const writtenMembers = membersOf(written.data);
    const dropped = Object.keys(served).filter((member) => !writtenMembers.includes(member));
    assert.deepEqual(dropped, [], `${name}.sse carries members responseChunks drops`);
  });
}
