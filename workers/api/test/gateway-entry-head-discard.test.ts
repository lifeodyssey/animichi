/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins that the gateway cancels the body it discards when it answers a HEAD
 * from its GET's answer: the users forward's, the public catalog forward's and
 * the conversation stream's. Each double answers with a whole body that records
 * being cancelled before anyone read it. A GET of the same route reads its body
 * through first, so the one record each case expects can only be the HEAD's.
 *
 * The record shows the gateway's cancel and nothing more: what the agent does
 * with a watch whose stream was cancelled is not observed here.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { WorkerDeps } from "../src/app.ts";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";

type Answering = () => Promise<Response>;

interface Discarded {
  readonly body: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly vars: (answer: Answering) => Readonly<Record<string, unknown>>;
  readonly seams: (answer: Answering) => WorkerDeps;
}

/** A whole, closed body named `body`, which records being cancelled before it was read. */
function cancelRecordingAnswer(cancels: string[], body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => { controller.enqueue(new TextEncoder().encode(body)); controller.close(); },
    cancel: () => { cancels.push(`${body} body cancelled`); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain" } });
}

const DISCARDED: readonly Discarded[] = [
  { body: "users", path: "/v1/users/saved-routes", headers: HUMAN, vars: (answer) => ({ USERS: { fetch: answer } }), seams: () => ({}) },
  { body: "catalog", path: "/catalog/public/popular", headers: {}, vars: (answer) => ({ CATALOG: { fetch: answer } }),
    seams: () => ({}) },
  { body: "stream", path: "/v1/conversations/s-42/stream", headers: HUMAN, vars: () => ({}),
    seams: (answer) => ({ agentTurns: { chat: answer, probe: answer, list: answer, transcript: answer, stream: answer } }) },
];

for (const discarded of DISCARDED) {
  void test(`a HEAD of ${discarded.path} cancels the ${discarded.body} body the gateway discards`, async (t) => {
    const cancels: string[] = [];
    const answer: Answering = () => Promise.resolve(cancelRecordingAnswer(cancels, discarded.body));
    const seam = entrySeam(t, UNLIMITED, discarded.vars(answer), discarded.seams(answer));
    assert.equal(await (await seam.send("GET", discarded.path, discarded.headers)).text(), discarded.body);
    const head = await seam.send("HEAD", discarded.path, discarded.headers);
    assert.equal(head.status, 200);
    assert.deepEqual(cancels, [`${discarded.body} body cancelled`]);
  });
}
