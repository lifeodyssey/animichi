import type { SqlOrmPlan, SqlQueryPlan } from "@prisma/orm-postgres/relational-core";
import { describe, expect, it } from "vitest";
import { catalogClient } from "../src/db/prisma";
import { enrichWork } from "../src/enrich/enrich";
import type { ImportCandidate } from "../src/import/import-snapshot";
import { importTransaction } from "../src/import/switch";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

// SUT: the two statements that write `points` — enrich's upsert and the snapshot import's
// insert — rendered as Postgres receives them. `latitude` / `longitude` are GENERATED ALWAYS
// over `location` (the data-plane baseline's `generated-columns.ts`): Postgres refuses any
// value but DEFAULT for them (`428C9`), while rc.20's builder requires one because the contract
// cannot declare a stored generated column. The database's refusal itself is the integration
// pool's (`enrich.integration.test.ts`, `import-integration.integration.test.ts`).

const LATITUDE = 35.6895;
const LONGITUDE = 139.6917;

/** A builder plan, as opposed to one already lowered to SQL text. */
function isQueryPlan(plan: SqlOrmPlan): plan is SqlQueryPlan {
  return !("sql" in plan);
}

function writesPoints(plan: SqlQueryPlan): boolean {
  return plan.ast.kind === "insert" && plan.ast.table.name === "points";
}

/** The points statement among the plans a pass executed, rendered with no database. */
function renderedPointsWrite(plans: readonly SqlOrmPlan[]) {
  const written = plans.filter(isQueryPlan).find(writesPoints);
  if (written === undefined) throw new Error("the pass wrote no points");
  return catalogClient().toSql(written);
}

/** Each column of a one-row INSERT paired with the value it sends. */
function sentValues(sql: string): Record<string, string> {
  const [, columns = "", values = ""] = /\(([^)]*)\)\s+VALUES\s+\((.*?)\)(?:\s+ON|\s+RETURNING|$)/s.exec(sql) ?? [];
  const names = columns.split(",").map((name) => name.trim().replaceAll('"', ""));
  const sent = values.split(/,(?![^(]*\))/).map((value) => value.trim());
  return Object.fromEntries(names.map((name, index) => [name, sent[index] ?? ""]));
}

describe("enrich's points upsert", () => {
  it("leaves both generated coordinates to the database and binds the geography instead", async () => {
    const seam = recordingCatalogPrisma([{ payload: { name: "Generated Anime" } }],
      [{ payload: [{ id: "p-1", name: "Shrine", geo: [LATITUDE, LONGITUDE] }] }]);
    await enrichWork(seam.query, "work-1");
    const { sql, params } = renderedPointsWrite(seam.plans());
    const sent = sentValues(sql);
    expect({ latitude: sent.latitude, longitude: sent.longitude }).toEqual({ latitude: "DEFAULT", longitude: "DEFAULT" });
    expect(sent.location).toMatch(/^\$\d+/);
    expect(params).not.toContain(LATITUDE);
    expect(params).not.toContain(LONGITUDE);
    expect(sql).toMatch(/ON CONFLICT \("id"\) DO UPDATE SET/);
    expect(sql).toMatch(/RETURNING/);
  });
});

describe("the snapshot import's points insert", () => {
  it("leaves both generated coordinates to the database", async () => {
    const point = { id: "p-1", bangumiId: "w1", name: "Shrine", nameCn: null, latitude: LATITUDE, longitude: LONGITUDE,
      image: null, episode: null, timeSeconds: 0, sceneDesc: null, origin: null, originUrl: null, city: null };
    const candidate: ImportCandidate = { snapshotId: "snap-1", sourceRunId: "run-1", createdAt: "2026-08-26T00:00:00.000Z",
      objects: [{ kind: "points", key: "points.json", hash: "h", sizeBytes: 1, rows: [point] }] };
    const seam = recordingCatalogPrisma();
    await importTransaction(seam.query, candidate);
    const { sql, params } = renderedPointsWrite(seam.plans());
    const sent = sentValues(sql);
    expect({ latitude: sent.latitude, longitude: sent.longitude }).toEqual({ latitude: "DEFAULT", longitude: "DEFAULT" });
    expect(sent.location).toMatch(/^\$\d+/);
    expect(params).not.toContain(LATITUDE);
    expect(params).not.toContain(LONGITUDE);
  });
});
