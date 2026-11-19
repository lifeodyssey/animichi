import { expect, it, vi } from "vitest";
import { IngestEntrypoint } from "../src/index";
import { databaseDescribe, planeDatabaseUrl } from "./integration-db";
import { call, type ApiPoint } from "./catalog-integration-client";
import { ANITABI_POINTS, NEW_WORK_ID } from "./fixtures/integration-suite-seed";
import { stubEgressSigningKey } from "./egress-stub";
import { stubUpstream } from "./integration-upstream-stubs";

// The Node integration pool has no workerd runtime; stub the runtime module so
// `src/index.ts` (which now exports the `IngestEntrypoint` named entrypoint)
// loads in plain Node.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

databaseDescribe("Catalog ingest end-to-end (fetch stub -> raw -> enrich -> publish -> points-by-bangumi-id)", () => {
  it("IngestEntrypoint publishes the work, then /points-by-bangumi-id returns the fresh points", async () => {
    stubUpstream();

    const entrypoint = new IngestEntrypoint(
      {} as unknown as ExecutionContext,
      {
        ENVIRONMENT: "test",
        DATABASE_URL: planeDatabaseUrl(),
        INGEST_SIGNING_KEY: stubEgressSigningKey(),
      },
    );
    const ingested = await entrypoint.ingestBangumi(NEW_WORK_ID);
    expect(ingested).toEqual({
      status: "ingested",
      pointCount: ANITABI_POINTS.length,
    });

    const found = await call<{ rows: ApiPoint[] }>("points-by-bangumi-id", { bangumi_id: NEW_WORK_ID });
    expect(found.rows.map((r) => r.id).sort()).toEqual(["sakuragaoka-gate", "toyosato-hall"]);
    expect(found.rows.every((r) => r.bangumi_id === NEW_WORK_ID)).toBe(true);
  });
});
