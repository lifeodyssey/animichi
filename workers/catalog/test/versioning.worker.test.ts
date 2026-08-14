import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { publishVersion, publishVersionStatements, readPublishedVersion } from "../src/publish/versioning";

/** Render a Drizzle SQL/builder statement to its dialect SQL (for shape assertions). */
function sqlText(query: unknown): string {
  const builder = query as { getSQL?: () => SQL };
  const sql = builder.getSQL ? builder.getSQL() : (query as SQL);
  return new PgDialect().sqlToQuery(sql).sql;
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
    expect(flipText).toContain("update \"cluster_version\"");
    expect(flipText).toContain("is_current");
    expect(insertText).toContain("insert into \"cluster_version\"");
    // The version is a builder-built scalar subquery deriving max(version)+1,
    // composed through the statementBuilder() seam (not a raw `nextVersionFor` fragment).
    expect(insertText).toContain("coalesce(((select max(\"version\") from \"cluster_version\"");
    expect(insertText).toContain("+ 1");
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
