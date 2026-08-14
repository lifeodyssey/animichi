import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { publishVersion, publishVersionStatements, readPublishedVersion } from "../src/publish/versioning";

/** Flatten a Drizzle SQL fragment to its literal text (for shape assertions). */
function sqlText(query: unknown, seen: Set<object> = new Set<object>()): string {
  if (query === null || typeof query === "undefined") return "";
  if (typeof query === "string" || typeof query === "number") return String(query);
  if (typeof query === "object") {
    if (seen.has(query)) return "";
    seen.add(query);
    const v = (query as { value?: unknown[] });
    if (Array.isArray(v.value)) return v.value.map((c) => sqlText(c, seen)).join("");
    const q = (query as { queryChunks?: unknown[] });
    if (Array.isArray(q.queryChunks)) return q.queryChunks.map((c) => sqlText(c, seen)).join("");
  }
  return "";
}

/** A fake db recording how mutations reach the driver.
 * `db.execute(stmt)` here is the lazy build step (returns a PgRaw, no network);
 * `db.batch` is where the statements are actually submitted. */
function recordingDb() {
  const calls: string[] = [];
  const db = {
    batch: (items: unknown[]) => {
      calls.push(`batch:${String((items).length)}`);
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
  it("publishes through one ordered flip-then-insert batch", () => {
    const [flip, insert] = publishVersionStatements("lucky-star");
    const flipText = sqlText(flip).toLowerCase();
    const insertText = sqlText(insert).toLowerCase();
    expect(flipText).toContain("update cluster_version");
    expect(flipText).toContain("is_current");
    expect(insertText).toContain("insert into cluster_version");
    expect(insertText).toContain("max(version)");
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
