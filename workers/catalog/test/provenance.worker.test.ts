import { describe, expect, it } from "vitest";
import { captureProvenance, pointFieldMap, type ProvenanceRecord } from "../src/ingest/provenance";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

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

    await captureProvenance(seam.query, record());

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

    await captureProvenance(seam.query, record());

    // The plan binds the document itself; a lane that JSON.stringify'd it would
    // put a STRING here, and Postgres would store that string as a jsonb scalar.
    expect(seam.params()).toContainEqual(record().fieldMap);
    expect(seam.params().some((value) => typeof value === "string" && tryParse(value) !== null)).toBe(false);
  });
});

/** Parse a JSON string without throwing on non-JSON values. */
function tryParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function record(): ProvenanceRecord {
  return {
    scope: "point",
    entityId: "p-1",
    workId: "prov-w",
    source: "anitabi",
    upstreamId: "p-1",
    attribution: "Anitabi",
    license: "https://anitabi.cn",
    fieldMap: { name: "anitabi", latitude: "anitabi" },
  };
}
