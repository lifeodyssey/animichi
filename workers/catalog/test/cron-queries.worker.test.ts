import { describe, expect, it } from "vitest";
import {
  listDoneBangumiIds,
  listStaleBangumiIds,
  STALE_AFTER_SECONDS,
} from "../src/ingest/cron-queries";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * Behavior guard for the cron queries (S0-v2 D4 fix round). The worker pool has
 * no database, so the three staleness SEMANTICS are verified against real
 * Postgres in cron-queries.integration.test.ts. This suite pins what the worker
 * side still owns — the round trip count and the values the plan BINDS — so a
 * regression in the worker-facing contract fails even when the integration
 * suite is skipped.
 *
 * The assertions read the plan's AST rather than a rendered statement: the
 * renderer lives in `@prisma/orm-target-postgres`, which this package consumes
 * only transitively (see `fakes/plan-inspection.ts`). The bound values and the
 * statement count are the same facts the Drizzle-era `PgDialect` spy produced.
 */

describe("listStaleBangumiIds", () => {
  it("round-trips one stale-read and binds the freshness floor and cap", async () => {
    const seam = recordingCatalogPrisma([{ work_id: "w-1" }]);

    await expect(listStaleBangumiIds(seam.query, 5)).resolves.toEqual(["w-1"]);

    expect(seam.statements()).toBe(1);
    expect(seam.params()).toContain(STALE_AFTER_SECONDS);
    // The cap is the plan's own limit, not a bound value.
    expect(seam.plans()[0]?.ast).toMatchObject({ limit: 5 });
  });

  it("maps the work ids the plan projects and nothing else", async () => {
    const seam = recordingCatalogPrisma([
      { work_id: "w-1" },
      { work_id: "w-2" },
      { work_id: "w-3" },
    ]);

    await expect(listStaleBangumiIds(seam.query, 5)).resolves.toEqual(["w-1", "w-2", "w-3"]);
    expect(seam.params()).toContain(STALE_AFTER_SECONDS);
    expect(seam.plans()[0]?.ast).toMatchObject({ limit: 5 });
  });

  it("rejects a non-positive cap before issuing any plan", async () => {
    const seam = recordingCatalogPrisma();

    await expect(listStaleBangumiIds(seam.query, 0)).rejects.toThrow("cron batch cap must be a positive integer");
    await expect(listStaleBangumiIds(seam.query, 2.5)).rejects.toThrow("cron batch cap must be a positive integer");
    expect(seam.statements()).toBe(0);
  });
});

describe("listDoneBangumiIds", () => {
  it("filters the checked-in ids to those with a done ingest_jobs row", async () => {
    const seam = recordingCatalogPrisma([{ work_id: "w-2" }]);

    await expect(listDoneBangumiIds(seam.query, ["w-1", "w-2", "w-3"])).resolves.toEqual(new Set(["w-2"]));

    expect(seam.statements()).toBe(1);
    expect(seam.params()).toEqual(expect.arrayContaining(["w-1", "w-2", "w-3"]));
  });

  it("returns an empty set without issuing a plan for an empty input", async () => {
    const seam = recordingCatalogPrisma();

    await expect(listDoneBangumiIds(seam.query, [])).resolves.toEqual(new Set());
    expect(seam.statements()).toBe(0);
  });
});
