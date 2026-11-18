/**
 * Case b0: pi-durable 1.5.2's storage conformance cases on its own `MemoryStorage`, under `node:test`, looped the way
 * `packages/pi-session-neon/test/storage-conformance.db.test.ts:15-16` loops 0.87.1's suite. It is the control for b1,
 * which runs the same loop on the Neon backend.
 */
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { createStorageConformance } from "@earendil-works/pi-durable/testing";
import { nodeAssertions } from "./conformance-assertions.ts";

const cases = createStorageConformance({
  assertions: nodeAssertions,
  withStorage: async (use) => {
    const storage = new MemoryStorage();
    try {
      await use(storage);
    } finally {
      await storage.close(BACKGROUND_CONTEXT);
    }
  },
});

for (const conformance of cases) {
  void test(`Storage: ${conformance.name}`, () => conformance.run());
}
