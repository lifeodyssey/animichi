import { afterAll, expect, it, vi } from "vitest";
import { closeDbPools } from "../src/db/connections";
import { IngestEntrypoint } from "../src/index";
import { databaseDescribe, localDatabaseUrl } from "./spike-db";
import { call, type ApiPoint } from "./catalog-spike-client";
import { ANITABI_POINTS, MISS_TITLE, MISS_WORK_ID, NEW_TITLE, NEW_WORK_ID } from "./fixtures/spike-suite-seed";
import { stubSearchMiss, stubUpstream } from "./spike-upstream-stubs";

// The Node spike pool has no workerd runtime; stub the runtime module so
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

vi.mock("../src/db/connections", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/db/connections")>();
  return {
    ...original,
    dbFor: async (connStr: string) => {
      const { localDatabaseUrl, pgCatalog } = await import("./spike-db");
      return connStr === localDatabaseUrl() ? { db: pgCatalog() } : await original.dbFor(connStr);
    },
  };
});

databaseDescribe("Catalog ingest end-to-end (fetch stub -> raw -> enrich -> publish -> search)", () => {
  it("IngestEntrypoint publishes the work, then /search returns the fresh points", async () => {
    stubUpstream();

    const entrypoint = new IngestEntrypoint(
      {} as unknown as ExecutionContext,
      { ENVIRONMENT: "test", DATABASE_URL: localDatabaseUrl() },
    );
    const ingested = await entrypoint.ingestBangumi(NEW_WORK_ID);
    expect(ingested).toEqual({
      status: "ingested",
      version: 1,
      pointCount: ANITABI_POINTS.length,
    });

    const found = await call<{ rows: ApiPoint[] }>("search", { query: NEW_TITLE });
    expect(found.rows.map((r) => r.id).sort()).toEqual(["sakuragaoka-gate", "toyosato-hall"]);
    expect(found.rows.every((r) => r.bangumi_id === NEW_WORK_ID)).toBe(true);
  });
});

databaseDescribe("Catalog search miss -> Bangumi resolve -> on-demand ingest -> points", () => {
  it("an UNCOVERED title resolves+ingests on first search, then is an alias hit on the second", async () => {
    const { urls } = stubSearchMiss();

    const first = await call<{ rows: ApiPoint[] }>("search", { query: MISS_TITLE });
    expect(first.rows.map((r) => r.id).sort()).toEqual(["keihan-uji", "uji-bridge"]);
    expect(first.rows.every((r) => r.bangumi_id === MISS_WORK_ID)).toBe(true);
    expect(urls.some((u) => u.includes("/v0/search/subjects"))).toBe(true);

    const searchCallsAfterFirst = urls.length;
    const second = await call<{ rows: ApiPoint[] }>("search", { query: MISS_TITLE });
    expect(second.rows.map((r) => r.id).sort()).toEqual(["keihan-uji", "uji-bridge"]);
    expect(urls.length).toBe(searchCallsAfterFirst); // alias hit: no re-resolve, no re-ingest
  });
});

afterAll(() => {
  closeDbPools();
});
