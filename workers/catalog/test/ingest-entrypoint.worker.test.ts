import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestResult } from "../src/ingest/ingest-bangumi";

/** Spy over the IngestBangumi use case; the other exports stay inert. */
const mocks = vi.hoisted(() => ({ ingest: vi.fn() }));

vi.mock("../src/ingest/ingest-bangumi", () => ({
  catalogIngestBangumi: () => ({ ingest: mocks.ingest }),
}));

/**
 * The runtime the entrypoint acquires is mocked out: this suite is about the
 * DELEGATION (the use case gets the id, and no database configured refuses
 * before any work), not about dialling Postgres from the worker pool. The
 * runtime's own lifetime is proved against real Postgres in
 * nearby-runtime.integration.test.ts.
 */
vi.mock("../src/db/prisma", () => ({
  acquireCatalogRuntime: () => Promise.resolve({ [Symbol.asyncDispose]: () => Promise.resolve() }),
  catalogPrisma: () => ({}),
}));

import { IngestEntrypoint } from "../src/index";

const ctx = {} as unknown as ExecutionContext;

describe("IngestEntrypoint", () => {
  beforeEach(() => {
    mocks.ingest.mockReset();
  });

  it("delegates ingestBangumi(bangumiId) to the IngestBangumi use case", async () => {
    const result: IngestResult = { status: "ingested", version: 3, pointCount: 12 };
    mocks.ingest.mockResolvedValue(result);

    const entrypoint = new IngestEntrypoint(ctx, {
      ENVIRONMENT: "test",
      DATABASE_URL: "postgresql://user:pass@example.test:5432/db",
    });

    await expect(entrypoint.ingestBangumi("10380")).resolves.toEqual(result);
    expect(mocks.ingest).toHaveBeenCalledExactlyOnceWith("10380");
  });

  it("rejects without touching the use case when no database is configured", async () => {
    const entrypoint = new IngestEntrypoint(ctx, {});

    await expect(entrypoint.ingestBangumi("10380")).rejects.toThrow(
      "catalog database not configured",
    );
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
