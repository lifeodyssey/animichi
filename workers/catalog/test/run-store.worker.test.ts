import { describe, expect, it } from "vitest";
import { beginRunRow, markRunFailedRow, readRunRow, recordRunRow } from "../src/ingest/run-store";
import type { RunSnapshot } from "../src/ingest/daily-run";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";
import { UNRECOGNISED_LEDGER_ELEMENTS } from "./fixtures/unrecognised-ledger-elements";

/**
 * The run store over `catalog_runs`, as the worker pool can see it: the run
 * reservation (AC1), and the failure ledger it reads back and writes again.
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

const ENRICH_7 = { bangumiId: "7", stage: "enrich", reason: "boom" } as const;
const RECLAIM = { stage: "reclaim", reason: "stale-reclaimed" } as const;

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
    expect(parsed).toContainEqual({ workUsed: 1, requestUsed: 2, firstExhausted: null });
    expect(parsed).toContainEqual([]);
    expect(parsed).toContainEqual({});
  });

  it("records budget use as the work and request counts and the dimension that stopped the run", async () => {
    const seam = recordingCatalogPrisma();

    await recordRunRow(seam.query, "daily-1", snapshot());

    expect(seam.params().filter(isBudgetUse)).toStrictEqual([{ workUsed: 1, requestUsed: 2, firstExhausted: null }]);
  });
});

describe("Run ledger read-back", () => {
  it("reads the recorded failures back, without the run id a legacy reclaim entry carried", async () => {
    const seam = recordingCatalogPrisma([runRow([
      { bangumiId: "7", stage: "enrich", reason: "boom" },
      { bangumiId: "daily-x", stage: "reclaim", reason: "stale-reclaimed" },
    ])]);

    const run = await readRunRow(seam.query, "daily-x");

    expect(run?.failures).toEqual([
      { bangumiId: "7", stage: "enrich", reason: "boom" },
      { stage: "reclaim", reason: "stale-reclaimed" },
    ]);
  });

  it("reads a run that never recorded failures as an empty ledger", async () => {
    const seam = recordingCatalogPrisma([runRow(null)]);

    await expect(readRunRow(seam.query, "daily-x")).resolves.toMatchObject({ failures: [] });
  });

  it.each(UNRECOGNISED_LEDGER_ELEMENTS)("carries $label unread, in its place in the ledger", async ({ element }) => {
    const seam = recordingCatalogPrisma([runRow([ENRICH_7, element, RECLAIM])]);

    const run = await readRunRow(seam.query, "daily-x");

    expect(run?.failures).toEqual([ENRICH_7, { unrecognised: element }, RECLAIM]);
  });
});

describe("Run published read-back", () => {
  it("reads back every number a row recorded per work, and drops what is not one", async () => {
    const seam = recordingCatalogPrisma([{ ...runRow(null), published_versions: { a: 4, b: 1, c: "x" } }]);

    const run = await readRunRow(seam.query, "daily-x");

    expect(run?.published).toEqual({ a: 4, b: 1 });
  });
});

describe("Run ledger write-back", () => {
  it.each(UNRECOGNISED_LEDGER_ELEMENTS)("records $label as the value it was read as", async ({ element }) => {
    const seam = recordingCatalogPrisma();

    await recordRunRow(seam.query, "daily-1", { ...snapshot(), failures: [ENRICH_7, { unrecognised: element }] });

    expect(seam.params().map(tryParse)).toContainEqual([ENRICH_7, element]);
  });

  it.each(UNRECOGNISED_LEDGER_ELEMENTS)("marks a stale run failed with $label as the value it was read as", async ({ element }) => {
    const seam = recordingCatalogPrisma();

    await markRunFailedRow(seam.query, "daily-1", [{ unrecognised: element }, RECLAIM]);

    expect(seam.params().map(tryParse)).toContainEqual([element, RECLAIM]);
  });
});

/** A `catalog_runs` row as the read gate selects it. */
function runRow(failures: unknown): Record<string, unknown> {
  return { status: "partial", started_at: null, published_versions: {}, failures };
}

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

/** The bound `budget_used` document: the one value that counts works. */
function isBudgetUse(param: unknown): boolean {
  return typeof param === "object" && param !== null && "workUsed" in param;
}

function snapshot(): RunSnapshot {
  return {
    status: "running",
    targets: { works: [], uniqueSeen: 0, knownCount: 0, newCount: 0, cappedCount: 0 },
    sources: { bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } },
    budgetUsed: { workUsed: 1, requestUsed: 2 },
    firstExhausted: null,
    failures: [],
    published: {},
    startedAtMs: null,
  };
}
