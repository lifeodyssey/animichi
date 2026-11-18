/**
 * Case b1: pi-durable 1.5.2's 32 storage conformance cases on the spike's Postgres backend (`pg-storage/`), through the
 * same `node:assert` adapter and the same loop as b0 (`conformance-control.test.ts`), nothing skipped or changed. All
 * cases share one database of the spike's own and its tables; each gets a fresh session key, so the later cases run
 * among keyspaces that hold the same ids, request ids and document addresses.
 *
 * Two keyspace tests follow the suite, which sees only one storage at a time: two keys holding the same ids stay
 * separate, and (the negative control) two storages on one key collide.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createStorageConformance, commitWrites } from "@earendil-works/pi-durable/testing";
import pg from "pg";
import { nodeAssertions } from "./conformance-assertions.ts";
import { createDatabase, dropDatabase } from "./pg-admin.ts";
import { SCHEMA } from "./pg-storage/schema.ts";
import { PgStorage } from "./pg-storage/storage.ts";

const DATABASE = "spike_pi_durable_conformance";
const BG = BACKGROUND_CONTEXT;
let dsn = "";

async function open(key: string): Promise<PgStorage> {
  const client = new pg.Client({ connectionString: dsn, application_name: `b1:${key}` });
  await client.connect();
  return PgStorage.open(client, key);
}

before(async () => {
  dsn = await createDatabase(DATABASE);
  const client = new pg.Client({ connectionString: dsn, application_name: "b1:schema" });
  await client.connect();
  try {
    for (const statement of SCHEMA) await client.query(statement);
  } finally {
    await client.end();
  }
});

after(async () => { await dropDatabase(DATABASE); });

let index = 0;
const cases = createStorageConformance({
  assertions: nodeAssertions,
  withStorage: async (use) => {
    index += 1;
    const storage = await open(`conformance-${String(index)}-${crypto.randomUUID()}`);
    try {
      await use(storage);
    } finally {
      await storage.close(BG);
    }
  },
});

for (const conformance of cases) {
  void test(`Storage: ${conformance.name}`, () => conformance.run());
}

void test("keyspace: two session keys hold the same ids, request ids and roots, and each reads back only its own", async () => {
  const [a, b] = [await open(`keyspace-a-${crypto.randomUUID()}`), await open(`keyspace-b-${crypto.randomUUID()}`)];
  try {
    for (const [storage, text] of [[a, "from A"], [b, "from B"]] as const) {
      await commitWrites(storage, [{ type: "conversation", value: { id: 1 } }], BG);
      const entry = await storage.mintId();
      const submission = await storage.mintId();
      await commitWrites(storage, [{ type: "entry", value: { id: entry, conversationId: 1, kind: "message", data: { text } } },
        { type: "submission", value: { id: submission, conversationId: 1, requestId: "op-1", type: "input", status: "placed", entry } }], BG);
    }
    for (const [storage, text] of [[a, "from A"], [b, "from B"]] as const) {
      const entries = (await storage.scanEntries({ conversationId: 1 }, 10, undefined, BG)).items;
      assert.deepEqual(entries.map((entry) => (entry as { data?: { text?: string } }).data?.text), [text]);
      assert.equal((await storage.submissionByRequest(1, "op-1", BG))?.entry, entries[0]?.id);
      assert.equal(entries[0]?.id, 2);
    }
  } finally {
    await a.close(BG);
    await b.close(BG);
  }
});

void test("keyspace, negative control: two storages on one session key collide on the root conversation", async () => {
  const key = `keyspace-shared-${crypto.randomUUID()}`;
  const [a, b] = [await open(key), await open(key)];
  try {
    await commitWrites(a, [{ type: "conversation", value: { id: 1 } }], BG);
    await assert.rejects(commitWrites(b, [{ type: "conversation", value: { id: 1 } }], BG), /ID 1 already belongs to conversation/);
  } finally {
    await a.close(BG);
    await b.close(BG);
  }
});
