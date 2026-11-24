import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Miniflare } from "miniflare";
import { pool, SESSION } from "./postgres.ts";
import { defaultWorker } from "./default-worker.ts";
import { argumentsEnd, byokTurn, CHAT, chatSaying, completionStream, driveReport, MEMBER, OBSERVED_HOST, respondChunk, respondStart, settlementCommit, textChunk } from "./byok-turn.ts";

/**
 * The deployed host's session store, as the default SessionAgent writes it into real PostgreSQL: once a BYOK
 * operation's key is released, or the host restarts cold, nothing a client reads back holds the key, and no row the
 * turn wrote ever held it. That covers the resumed watch, the transcript, the conversation list with its first query
 * and title, and every row written along the way, the streamed frames that settlement deletes included. The fixture
 * keys are made up, and shape-based redaction does not catch them.
 */

const KEY = "caller-echo-key";
const ESCAPED_KEY = 'caller"echo\\key';

/** The provider streams the key back in its answer, then answers through respond. */
function streamedEcho(key: string) {
  return completionStream([textChunk(`Your key is ${key.slice(0, 6)}`), textChunk(`${key.slice(6)}.`), respondChunk()]);
}

/** The provider streams a respond call whose raw JSON arguments carry the key. */
function keyInArguments(key: string) {
  const json = JSON.stringify({ kind: "greeting", message: `Use ${key}` });
  const cut = json.indexOf("echo");
  return completionStream([respondStart(json.slice(0, cut)), argumentsEnd(json.slice(cut))]);
}

/** How a key reads in JSON text: as a string value, and as JSON text held in a string value. */
function writtenForms(key: string) {
  const value = JSON.stringify(key).slice(1, -1);
  return [value, JSON.stringify(value).slice(1, -1)];
}

/** Every row the turn inserts or updates in the session tables, captured as it is written. */
async function rowsWritten(context: TestContext) {
  await pool.query(`CREATE TABLE host_test_written_rows (written text NOT NULL);
    CREATE FUNCTION host_test_written_row() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO host_test_written_rows VALUES (row_to_json(NEW)::text); RETURN NEW; END $$;
    CREATE TRIGGER host_test_written_record AFTER INSERT OR UPDATE ON pi_records FOR EACH ROW EXECUTE FUNCTION host_test_written_row();
    CREATE TRIGGER host_test_written_scalar AFTER INSERT OR UPDATE ON pi_scalar_values FOR EACH ROW EXECUTE FUNCTION host_test_written_row();
    CREATE TRIGGER host_test_written_list AFTER INSERT OR UPDATE ON pi_list_values FOR EACH ROW EXECUTE FUNCTION host_test_written_row();
    CREATE TRIGGER host_test_written_session AFTER INSERT OR UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION host_test_written_row()`);
  context.after(async () => { await pool.query("DROP FUNCTION host_test_written_row() CASCADE; DROP TABLE host_test_written_rows"); });
  return async () => (await pool.query<{ written: string }>("SELECT written FROM host_test_written_rows")).rows.map((row) => row.written);
}

/** The rows, and the text the streamed frames among them carried chunk after chunk, as one string. */
function writtenText(rows: string[]) {
  const frames = rows.map((row) => JSON.parse(row) as { namespace?: string; seq?: number; value?: { delta?: string; json?: string } })
    .filter((row) => row.namespace === "pi.pending.assistant_frame").sort((left, right) => Number(left.seq) - Number(right.seq));
  return [...rows, frames.map((frame) => frame.value?.delta ?? frame.value?.json ?? "").join("")].join("\n");
}

/** What the conversation's owner can read back: the resumed watch, the transcript, the list, and the stored title. */
async function readBack(worker: Miniflare) {
  const reads = [`/v1/conversations/${SESSION}/stream`, `/v1/conversations/${SESSION}/messages`, "/v1/conversations"];
  const bodies = await Promise.all(reads.map(async (path) => (await worker.dispatchFetch(`https://host.test${path}`)).text()));
  const stored = await pool.query<{ first_query: string; title: string }>("SELECT first_query, title FROM sessions WHERE id = $1", [SESSION]);
  return { text: bodies.join("\n"), stored: stored.rows };
}

/** One BYOK turn, driven to its settlement; the live watch is let go at once, as a closed tab lets it go. */
async function settledTurn(context: TestContext, worker: Miniflare, key: string) {
  const { settled } = await settlementCommit(context);
  const live = await worker.dispatchFetch(CHAT, byokTurn(key, chatSaying(`My key is ${key}`)));
  assert.equal(live.status, 200);
  await live.body?.cancel();
  assert.equal(await settled, true);
}

void test("once settlement releases the key, the resumed watch, transcript and list hold it only as [redacted], and no row ever held it", { timeout: 60_000 }, async (context) => {
  const written = await rowsWritten(context);
  const { worker } = await defaultWorker(context, MEMBER, { model: () => streamedEcho(KEY) }, OBSERVED_HOST);
  await settledTurn(context, worker, KEY);
  assert.equal((await driveReport(worker)).served?.now.registered, false, "settlement has released the key");
  const { text, stored } = await readBack(worker);
  assert.deepEqual(writtenForms(KEY).filter((form) => text.includes(form)), []);
  assert.match(text, /Your key is \[redacted\]\./);
  assert.deepEqual(stored, [{ first_query: "My key is [redacted]", title: "My key is [redacted]" }]);
  const rows = writtenText(await written());
  assert.deepEqual(writtenForms(KEY).filter((form) => rows.includes(form)), []);
});

void test("after a cold restart the resumed watch and the transcript hold the key only as [redacted]", { timeout: 60_000 }, async (context) => {
  const resources = await defaultWorker(context, MEMBER, { model: () => streamedEcho(KEY) });
  await settledTurn(context, resources.worker, KEY);
  const { text } = await readBack(await resources.restart());
  assert.deepEqual(writtenForms(KEY).filter((form) => text.includes(form)), []);
  assert.match(text, /Your key is \[redacted\]\./);
  assert.match(text, /My key is \[redacted\]/);
});

void test("a key that JSON escapes, in tool-call arguments, is never written and reads back only as [redacted]", { timeout: 60_000 }, async (context) => {
  const written = await rowsWritten(context);
  const { worker } = await defaultWorker(context, MEMBER, { model: () => keyInArguments(ESCAPED_KEY) });
  await settledTurn(context, worker, ESCAPED_KEY);
  const seen = [writtenText(await written()), (await readBack(worker)).text].join("\n");
  assert.deepEqual(writtenForms(ESCAPED_KEY).filter((form) => seen.includes(form)), []);
  assert.match(seen, /Use \[redacted\]/);
});
