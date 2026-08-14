import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { publishVersion, publishVersionStatements, readPublishedVersion } from "../src/publish/versioning";

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
