import { describe, expect, it } from "vitest";
import { captureProvenance, pointFieldMap, ROWS_PER_STATEMENT, type ProvenanceRecord } from "../src/ingest/provenance";
import { planParams, recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * SUT: the provenance write (`src/ingest/provenance.ts`) as the worker pool sees
 * it — the plans it builds and how many. That Postgres accepts them, and what a
 * refused row leaves behind, is `run-provenance.integration.test.ts`.
 */

/** The most values one statement can bind: the wire protocol counts them in 16 bits. */
const MAX_BOUND_VALUES = 65_535;

describe("Point provenance field map (AC4)", () => {
  it("maps every published point field to the anitabi source", () => {
    const map = pointFieldMap();
    expect(map.id).toBe("anitabi");
    expect(map.name).toBe("anitabi");
    expect(map.latitude).toBe("anitabi");
    expect(map.longitude).toBe("anitabi");
    expect(map.image).toBe("anitabi");
  });

  it("includes each of the contributing point columns", () => {
    const map = pointFieldMap();
    expect(Object.keys(map).sort()).toEqual([
      "episode", "id", "image", "latitude", "longitude", "name", "name_cn",
      "origin", "origin_url", "time_seconds",
    ]);
  });
});

describe("Provenance UPSERT plan (AC4)", () => {
  it("conflicts on (scope, entity_id) and refreshes captured_at so the latest capture wins", async () => {
    const seam = recordingCatalogPrisma();

    await captureProvenance(seam.query, [record("p-1")]);

    expect(seam.statements()).toBe(1);
    const ast = seam.plans()[0]?.ast as { kind: string; onConflict?: unknown };
    expect(ast.kind).toBe("insert");
    // The conflict clause is the plan-level repair `db/plans.ts` adds.
    expect(ast.onConflict).toBeDefined();
    expect(JSON.stringify(ast)).toContain("captured_at");
    expect(seam.columns()).toEqual(expect.arrayContaining(["scope", "entity_id"]));
  });

  it("binds field_map as ONE jsonb document, not a re-stringified one", async () => {
    const seam = recordingCatalogPrisma();

    await captureProvenance(seam.query, [record("p-1")]);

    // The plan binds the document itself; a lane that JSON.stringify'd it would
    // put a STRING here, and Postgres would store that string as a jsonb scalar.
    expect(seam.params()).toContainEqual(record("p-1").fieldMap);
    expect(seam.params().some((value) => typeof value === "string" && tryParse(value) !== null)).toBe(false);
  });
});

describe("A capture of several records", () => {
  it("writes every record in one statement", async () => {
    const seam = recordingCatalogPrisma();

    await captureProvenance(seam.query, [record("p-1"), record("p-2"), record("p-3")]);

    expect(seam.plans().map(rowCount)).toEqual([3]);
  });

  it("keeps one row per key, the last one captured, so a repeated key cannot fail the statement", async () => {
    const seam = recordingCatalogPrisma();

    await captureProvenance(seam.query, [record("p-1", "first"), record("p-2"), record("p-1", "last")]);

    expect(seam.plans().map(rowCount)).toEqual([2]);
    expect(seam.params()).toContain("last");
    expect(seam.params()).not.toContain("first");
  });

  it("issues no statement for an empty capture", async () => {
    const seam = recordingCatalogPrisma();

    await captureProvenance(seam.query, []);

    expect(seam.statements()).toBe(0);
  });
});

describe("A capture past one statement's bound values", () => {
  it("fills a statement with as many rows as fit in the protocol's 65,535 bound values, and no more", async () => {
    const seam = recordingCatalogPrisma();

    await captureProvenance(seam.query, [record("p-1")]);

    const valuesPerRow = seam.params().length;
    expect(ROWS_PER_STATEMENT * valuesPerRow).toBeLessThanOrEqual(MAX_BOUND_VALUES);
    expect((ROWS_PER_STATEMENT + 1) * valuesPerRow).toBeGreaterThan(MAX_BOUND_VALUES);
  });

  it("splits the records into statements that each bind at most 65,535 values", async () => {
    const seam = recordingCatalogPrisma();
    const records = Array.from({ length: ROWS_PER_STATEMENT + 1 }, (_, index) => record(`p-${String(index)}`));

    await captureProvenance(seam.query, records);

    expect(seam.plans().map(rowCount)).toEqual([ROWS_PER_STATEMENT, 1]);
    expect(Math.max(...seam.plans().map((plan) => planParams(plan).length))).toBeLessThanOrEqual(MAX_BOUND_VALUES);
  });
});

/** How many rows an INSERT plan carries. */
function rowCount(plan: { readonly ast: unknown }): number {
  return (plan.ast as { readonly rows: readonly unknown[] }).rows.length;
}

/** Parse a JSON string without throwing on non-JSON values. */
function tryParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function record(entityId: string, license = "https://anitabi.cn"): ProvenanceRecord {
  return {
    scope: "point",
    entityId,
    workId: "prov-w",
    source: "anitabi",
    upstreamId: entityId,
    attribution: "Anitabi",
    license,
    fieldMap: { name: "anitabi", latitude: "anitabi" },
  };
}
