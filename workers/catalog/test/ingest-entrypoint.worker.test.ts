import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestResult } from "../src/ingest/orchestrator";

/** Spy over the orchestrator's `ingestWork`; the other exports stay inert. */
const mocks = vi.hoisted(() => ({ ingestWork: vi.fn() }));

vi.mock("../src/ingest/orchestrator", () => ({
  ingestWork: mocks.ingestWork,
  ingestGuard: () => Promise.resolve("ready"),
  claimIngest: () => Promise.resolve("acquired"),
  runClaimedIngest: () => Promise.resolve({ status: "in_progress" }),
}));

import { IngestEntrypoint } from "../src/index";

const ctx = {} as unknown as ExecutionContext;

describe("IngestEntrypoint", () => {
  beforeEach(() => {
    mocks.ingestWork.mockReset();
  });

  it("delegates ingestWork(workId) to the orchestrator", async () => {
    const result: IngestResult = { status: "ingested", version: 3, pointCount: 12 };
    mocks.ingestWork.mockResolvedValue(result);

    const entrypoint = new IngestEntrypoint(ctx, {
      ENVIRONMENT: "test",
      DATABASE_URL: "postgresql://user:pass@example.test:5432/db",
    });

    await expect(entrypoint.ingestWork("10380")).resolves.toEqual(result);
    expect(mocks.ingestWork).toHaveBeenCalledExactlyOnceWith(expect.anything(), "10380");
  });

  it("rejects without touching the orchestrator when no database is configured", async () => {
    const entrypoint = new IngestEntrypoint(ctx, {});

    await expect(entrypoint.ingestWork("10380")).rejects.toThrow(
      "catalog database not configured",
    );
    expect(mocks.ingestWork).not.toHaveBeenCalled();
  });
});
