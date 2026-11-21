import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { Budget } from "../src/ingest/budgets";
import type { RunWorkOutcome } from "../src/ingest/daily-run";
import { captureProvenance, ROWS_PER_STATEMENT, type ProvenanceRecord } from "../src/ingest/provenance";
import { ingestRunWork } from "../src/ingest/run-ingest";
import type { AnitabiPoint } from "../src/ingest/sources";
import { stubEgressSigningKey } from "./egress-stub";
import { databaseDescribe, planeDatabaseUrl, planePool, truncateCatalogPool } from "./integration-db";
import { jsonResponse, relayedResponse, stubFetch } from "./integration-upstream-stubs";
import { openStatementCapture, type StatementCapture } from "./statement-capture";

/**
 * SUT: the daily run's provenance write (`captureProvenance` in
 * `src/ingest/provenance.ts`), reached through the per-work ingest
 * (`ingestRunWork`) and on its own, against the committed Prisma chain's schema.
 * A round trip is a statement the runtime sent to Postgres
 * (`statement-capture.ts`), counted per call.
 *
 * What these cases hold: a work's provenance is one statement however many
 * points it has; a point the upstream lists twice keeps one row rather than
 * failing the statement; when Postgres refuses one row, none of that
 * statement's rows is written and an earlier capture of the same keys keeps its
 * values; and a capture past the protocol's 65,535 bound values is split into
 * statements Postgres accepts.
 */

let capture: StatementCapture;

beforeAll(async () => {
  capture = await openStatementCapture(planeDatabaseUrl());
  await truncateCatalogPool(planePool());
}, 120_000);

afterAll(async () => {
  await capture.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `count` points the parser accepts, with ids `<prefix>-0`, `<prefix>-1`, … */
function points(prefix: string, count: number): AnitabiPoint[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${String(index)}`, name: "spot", lat: 35, lng: 135 }));
}

/** Ingest one work, as the daily run does, while its upstream lists `listed`. */
function ingest(workId: string, listed: readonly AnitabiPoint[]): Promise<RunWorkOutcome> {
  stubFetch((url) => (url.includes("/v0/subjects/") ? jsonResponse({ name: `work ${workId}` }) : relayedResponse(listed)));
  const budget = new Budget({ workLimit: 5, requestLimit: 10 });
  return ingestRunWork(capture.prisma, workId, "daily-provenance", budget, { egressSigningKey: stubEgressSigningKey() });
}

/** How many of the statements `step` sent wrote `catalog_provenance`. */
async function provenanceStatements(step: () => Promise<unknown>): Promise<number> {
  const before = capture.statements().length;
  await step();
  return capture.statements().slice(before).filter((sql) => sql.includes("catalog_provenance")).length;
}

/** Every recorded `[entity_id, license]` of a work, in entity order. */
async function recordedLicenses(workId: string): Promise<string[][]> {
  const { rows } = await planePool().query<{ entity_id: string; license: string | null }>(
    "SELECT entity_id, license FROM catalog_provenance WHERE work_id = $1 ORDER BY entity_id", [workId],
  );
  return rows.map((row) => [row.entity_id, row.license ?? ""]);
}

/** A point row of the work `workId`, carrying `license` so a test can tell captures apart. */
function pointRecord(workId: string, entityId: string, license: string): ProvenanceRecord {
  return {
    scope: "point", entityId, workId, source: "anitabi", upstreamId: entityId,
    attribution: "Anitabi", license, fieldMap: { name: "anitabi" },
  };
}

databaseDescribe("The provenance write of the daily run's per-work ingest", () => {
  it("writes a work's provenance in one statement, for one point as for forty", async () => {
    const one = await provenanceStatements(() => ingest("910001", points("one", 1)));
    const forty = await provenanceStatements(() => ingest("910040", points("forty", 40)));

    expect([one, forty]).toEqual([1, 1]);
    expect(await recordedLicenses("910040")).toHaveLength(41);
  });

  it("keeps one row for a point the upstream lists twice, and still returns the work's outcome", async () => {
    const listed = [...points("twice", 2), ...points("twice", 1)];

    await expect(ingest("910002", listed)).resolves.toHaveProperty("outcome");

    expect((await recordedLicenses("910002")).map(([entityId]) => entityId)).toEqual(["910002", "twice-0", "twice-1"]);
  });
});

databaseDescribe("captureProvenance against what Postgres refuses", () => {
  it("writes none of a statement's rows when Postgres refuses one of them, and keeps an earlier capture", async () => {
    await captureProvenance(capture.prisma, [pointRecord("refused-w", "a", "earlier"), pointRecord("refused-w", "c", "earlier")]);

    const refused = captureProvenance(capture.prisma, [
      pointRecord("refused-w", "a", "later"), pointRecord("refused-w", "b\u0000", "later"), pointRecord("refused-w", "c", "later"),
    ]);

    await expect(refused).rejects.toMatchObject({ sqlState: "22021" });
    expect(await recordedLicenses("refused-w")).toEqual([["a", "earlier"], ["c", "earlier"]]);
  });

  it("splits a capture past the protocol's 65,535 bound values into statements Postgres accepts", async () => {
    const records = Array.from({ length: ROWS_PER_STATEMENT + 1 }, (_, index) => pointRecord("bulk-w", `bulk-${String(index)}`, "bulk"));

    expect(await provenanceStatements(() => captureProvenance(capture.prisma, records))).toBe(2);

    expect(await recordedLicenses("bulk-w")).toHaveLength(ROWS_PER_STATEMENT + 1);
  });
});
