import { describe, expect, it } from "vitest";
import type { ImportCandidate } from "../src/import/import-snapshot";
import { importTransaction } from "../src/import/switch";
import { failingCatalogPrisma } from "./fakes/fake-catalog-prisma";

function candidate(): ImportCandidate {
  return {
    snapshotId: "snap-1",
    sourceRunId: "run-1",
    createdAt: "2026-08-26T00:00:00.000Z",
    objects: [
      { kind: "works", key: "works.json", hash: "h1", sizeBytes: 10, rows: [{ id: "w1", title: "Lucky Star" }] },
    ],
  };
}

// importTransaction (like publishVersion) has no try/catch around the unit: the
// PINNED behaviour is a clean propagation with no partial-state ambiguity — a
// failure anywhere in the one transaction rejects the whole switchCatalog call,
// so an invalid/partial activation never lands.
describe("B6: importTransaction mid-unit failure", () => {
  it("propagates a failure on a delete statement, named by the table it clears", async () => {
    const query = failingCatalogPrisma({ onTable: "bangumi", error: new Error("delete failed") });
    await expect(importTransaction(query, candidate())).rejects.toThrow("delete failed");
  });

  it("propagates a failure on the trailing works insert, named by its position", async () => {
    // Statement order: [record run, delete x6 (DELETE_ORDER), insert works] —
    // one object kind ("works") means the unit is exactly 8 statements, so the
    // insert lands at index 7.
    const query = failingCatalogPrisma({ atIndex: 7, error: new Error("insert failed") });
    await expect(importTransaction(query, candidate())).rejects.toThrow("insert failed");
  });
});
