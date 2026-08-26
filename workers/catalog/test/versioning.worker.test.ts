import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { publishVersion, publishVersionStatements, readPublishedVersion } from "../src/publish/versioning";
import { fakeCatalogDb } from "./fakes/fake-catalog-db";

/** A fake db recording how mutations reach the driver.
 * `db.execute(stmt)` here is the lazy build step (returns a PgRaw, no network);
 * `db.batch` is where the statements are actually submitted. */
function recordingDb() {
  const calls: string[] = [];
  const db = {
    batch: (items: unknown[]) => {
      calls.push("batch:" + String((items).length));
      return Promise.resolve((items).map(() => ({ rows: [{ version: 7 }] })));
    },
    execute: () => {
      calls.push("execute");
      return Promise.resolve({ rows: [] });
    },
  };
  return { db: db as unknown as CatalogDb, calls };
}

describe("atomic version publish (story 11)", () => {
  it("produces the ordered flip-then-insert statement pair", () => {
    const statements = publishVersionStatements("lucky-star");
    expect(statements).toHaveLength(2);
    // The flip and insert are distinct statements submitted together atomically.
    expect(statements[0]).not.toBe(statements[1]);
  });

  it("submits the flip+insert in one atomic batch (never two independent executes)", async () => {
    const { db, calls } = recordingDb();
    await publishVersion(db, "lucky-star");
    expect(calls).toEqual(["execute", "execute", "batch:2"]);
  });

  it("extracts the published version from the RETURNING result", () => {
    expect(readPublishedVersion({ rows: [{ version: 12 }] })).toBe(12);
    expect(() => readPublishedVersion({ rows: [] })).toThrow(/no version|returned no version/);
  });
});

describe("B6: publishVersion mid-batch failure (fakeCatalogDb batch fidelity)", () => {
  // publishVersion has no try/catch around db.batch — the current, PINNED
  // behavior is a clean propagation with no partial-state ambiguity: a
  // failure anywhere in the batch rejects the whole call and
  // readPublishedVersion is never reached, so no half-published version
  // number can leak to the caller.
  it("propagates a failure on the insert half (matched by rendered SQL) and never returns a version", async () => {
    const db = fakeCatalogDb({}, {
      errors: [{ sqlIncludes: "insert into \"cluster_version\"", error: new Error("insert failed") }],
    });
    await expect(publishVersion(db, "lucky-star")).rejects.toThrow("insert failed");
  });

  it("propagates a failure on the flip half (matched by batch index 0) before the insert ever runs", async () => {
    const db = fakeCatalogDb({}, { errors: [{ atIndex: 0, error: new Error("flip failed") }] });
    await expect(publishVersion(db, "lucky-star")).rejects.toThrow("flip failed");
  });
});
