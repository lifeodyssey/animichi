/**
 * b0's negative control: the same cases, through the same `node:assert` adapter, must catch a defective storage, or b0
 * and b1 prove nothing. Each defect is a thin wrapper over `MemoryStorage` that replaces one method:
 * - an empty request index, which is what `PiHarness` reads from its own store when Pi runs on another one
 *   (`evidence/q2-route.json`);
 * - a request index blind to the conversation, which is two sessions' root conversations sharing one keyspace.
 * Each test passes when its defect fails the request-index case.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import { MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { createStorageConformance } from "@earendil-works/pi-durable/testing";
import { nodeAssertions } from "./conformance-assertions.ts";

type Defect = (storage: MemoryStorage) => Storage;

const REQUEST_INDEX_CASE = "indexes request IDs per conversation and replaces complete submission records";

function replacing(storage: MemoryStorage, name: string, replacement: unknown): Storage {
  return new Proxy(storage, {
    get(target, property) {
      if (property === name) return replacement;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const emptyRequestIndex: Defect = (storage) => replacing(storage, "submissionByRequest", () => Promise.resolve(undefined));

const conversationBlindRequestIndex: Defect = (storage) => replacing(storage, "submissionByRequest",
  async (_conversationId: number, requestId: string, context: Context) => {
    let cursor: Parameters<MemoryStorage["scanSubmissions"]>[2];
    do {
      const page = await storage.scanSubmissions({}, 100, cursor, context);
      const found = page.items.find((record) => record.requestId === requestId);
      if (found) return found;
      cursor = page.next;
    } while (cursor !== undefined);
    return undefined;
  });

async function failures(defect: Defect) {
  const cases = createStorageConformance({
    assertions: nodeAssertions,
    withStorage: async (use) => {
      const storage = new MemoryStorage();
      try {
        await use(defect(storage));
      } finally {
        await storage.close(BACKGROUND_CONTEXT);
      }
    },
  });
  const failed: string[] = [];
  for (const conformance of cases) {
    try {
      await conformance.run();
    } catch {
      failed.push(conformance.name);
    }
  }
  return { cases: cases.length, failed };
}

void test("an empty request index fails the request-index case", async () => {
  const result = await failures(emptyRequestIndex);
  console.log(JSON.stringify({ defect: "empty request index", ...result }));
  assert.ok(result.failed.includes(REQUEST_INDEX_CASE), JSON.stringify(result));
});

void test("a request index blind to the conversation fails the request-index case", async () => {
  const result = await failures(conversationBlindRequestIndex);
  console.log(JSON.stringify({ defect: "conversation-blind request index", ...result }));
  assert.ok(result.failed.includes(REQUEST_INDEX_CASE), JSON.stringify(result));
});
