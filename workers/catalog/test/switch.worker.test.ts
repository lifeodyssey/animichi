import { describe, expect, it } from "vitest";
import type { ImportCandidate } from "../src/import/import-snapshot";
import { importBatch } from "../src/import/switch";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";

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

// importBatch (like publishVersion, story 11) has no try/catch around
// db.batch: the PINNED behavior is a clean propagation with no partial-state
// ambiguity — a failure anywhere in the one-transaction batch rejects the
// whole switchCatalog call, so an invalid/partial activation never lands.
describe("B6: importBatch mid-batch failure (fakeCatalogDb batch fidelity)", () => {
  it("propagates a failure on a delete statement (matched by rendered SQL)", async () => {
    const db = fakeCatalogDb({}, {
      errors: [{ sqlIncludes: "delete from \"bangumi\"", error: new Error("delete failed") }],
    });
    await expect(importBatch(db, candidate())).rejects.toThrow("delete failed");
  });

  it("propagates a failure on the trailing works insert (matched by batch index)", async () => {
    // Statement order: [record run, delete x6 (DELETE_ORDER), insert works] —
    // one object kind ("works") means the batch is exactly 8 statements, so
    // the insert lands at index 7.
    const db = fakeCatalogDb({}, { errors: [{ atIndex: 7, error: new Error("insert failed") }] });
    await expect(importBatch(db, candidate())).rejects.toThrow("insert failed");
  });
});
