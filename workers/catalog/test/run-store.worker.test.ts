import { describe, expect, it } from "vitest";
import { beginRunRow, recordRunRow } from "../src/ingest/run-store";
import type { RunSnapshot } from "../src/ingest/daily-run";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * Run reservation over `catalog_runs` (AC1), as the worker pool can see it.
 *
 * The gate used to be one `INSERT … ON CONFLICT … DO UPDATE … WHERE`, and these
 * cases asserted on its rendered SQL. The Postgres renderer emits no conflict
 * predicate, so the gate is now the pair that predicate MEANS — UPDATE the row
 * when it is not running, else INSERT — and the single-winner property comes
 * from the unique key rather than from the conflict clause. `run-store` chooses
 * between them on the UPDATE's own row count, so what stays here is which
 * branch each row count takes; the racing behaviour is proved against real
 * Postgres in daily-run.integration.test.ts.
 */

describe("Run reservation (AC1)", () => {
  it("acquires by reclaiming an existing, not-running row", async () => {
    const seam = recordingCatalogPrisma([{ run_id: "daily-x" }]);

    await expect(beginRunRow(seam.query, "daily-x")).resolves.toBe(true);

    // One statement: the reclaim UPDATE. The row came back, so no INSERT follows.
    expect(seam.statements()).toBe(1);
    expect(seam.plans()[0]?.ast).toMatchObject({ kind: "update" });
    expect(seam.params()).toContain("daily-x");
  });

  it("falls through to the INSERT when no reclaimable row exists", async () => {
    const seam = recordingCatalogPrisma([], [{ run_id: "daily-x" }]);

    await expect(beginRunRow(seam.query, "daily-x")).resolves.toBe(true);

    expect(seam.statements()).toBe(2);
    const [reclaim, insert] = seam.plans();
    expect(reclaim?.ast).toMatchObject({ kind: "update" });
    expect(insert?.ast).toMatchObject({ kind: "insert" });
    expect(seam.params()).toContain("running");
  });

  it("does not acquire when the INSERT loses the unique key to another caller", async () => {
    const seam = recordingCatalogPrisma([]);
    // The second statement is the INSERT; a 23505 from it means a lost race.
    const raced = {
      ...seam.query,
      executor: {
        query: (plan: { ast: unknown }, index = 0) => {
          void index;
          const isInsert = (plan.ast as { kind: string }).kind === "insert";
          if (isInsert) return Promise.reject(uniqueViolation());
          return Promise.resolve([] as readonly never[]);
        },
      },
    };

    await expect(beginRunRow(raced, "daily-x")).resolves.toBe(false);
  });

  it("serializes each jsonb snapshot field exactly once", async () => {
    const seam = recordingCatalogPrisma();

    await recordRunRow(seam.query, "daily-1", snapshot());

    const parsed = seam.params().map((param) => tryParse(param));
    expect(parsed).toContainEqual({ works: [], uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 });
    expect(parsed).toContainEqual({ bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } });
    expect(parsed).toContainEqual({ workUsed: 1, requestUsed: 2, runtimeUsedMs: 3, firstExhausted: null });
    expect(parsed).toContainEqual([]);
    expect(parsed).toContainEqual({});
  });
});

/** The driver failure a lost INSERT race reads as. */
function uniqueViolation(): Error {
  const error = new Error("duplicate key value violates unique constraint") as Error & { sqlState: string };
  error.sqlState = "23505";
  return error;
}

/** Parse a JSON string without throwing on non-JSON values. */
function tryParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function snapshot(): RunSnapshot {
  return {
    status: "running",
    targets: { works: [], uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 },
    sources: { bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } },
    budgetUsed: { workUsed: 1, requestUsed: 2, runtimeUsedMs: 3 },
    firstExhausted: null,
    failures: [],
    published: {},
    startedAtMs: null,
  };
}
