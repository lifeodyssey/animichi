/**
 * Immutable-snapshot public reader + rollback HTTP surface (issue #1012 AC5) —
 * api-typed test over the worker fetch boundary.
 *
 * Seeds a real R2-backed snapshot pair through r2ObjectStore + publishSnapshot,
 * then exercises GET /catalog/snapshot (manifest metadata only) and what an
 * authorized POST /catalog/snapshot/rollback does. The token guard in front of
 * the rollback is `rollback-guard.worker.test.ts`'s subject.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";
import { r2ObjectStore } from "../src/publish/object-store";
import { publishSnapshot } from "../src/publish/snapshot";
import { fakeTableRows } from "./fakes/fake-catalog-prisma";
import { makeSnapshotBucket, publishTwoSnapshots } from "./fakes/snapshot-bucket";

function envOf(bucket: R2Bucket, token?: string): Env {
  return { ENVIRONMENT: "test", SNAPSHOT_BUCKET: bucket, SNAPSHOT_ADMIN_TOKEN: token };
}

describe("GET /catalog/snapshot (AC5)", () => {
  it("returns the current snapshot manifest metadata", async () => {
    const bucket = makeSnapshotBucket();
    await publishTwoSnapshots(bucket);
    const res = await catalogRequest("/catalog/snapshot", {}, envOf(bucket));
    expect(res.status).toBe(200);
    const body = await res.json<{
      snapshotId: string; sourceRunId: string; createdAt: string; counts: Record<string, number>; compatibility: { min: string; max: string };
    }>();
    expect(body.snapshotId).toBe("snap-daily-2");
    expect(body.sourceRunId).toBe("daily-2");
    expect(body.createdAt).toBe("2026-08-15T00:00:00Z");
    expect(body.counts.works).toBe(1);
    expect(body.compatibility).toEqual({ min: "1", max: "1" });
  });

  it("404s before any snapshot publishes", async () => {
    const res = await catalogRequest("/catalog/snapshot", {}, envOf(makeSnapshotBucket()));
    expect(res.status).toBe(404);
  });

  it("503s when no snapshot bucket is bound", async () => {
    const res = await catalogRequest("/catalog/snapshot", {}, { ENVIRONMENT: "test" });
    expect(res.status).toBe(503);
  });
});

describe("POST /catalog/snapshot/rollback (AC5)", () => {
  it("404s when there is no previous snapshot to roll back to", async () => {
    const bucket = makeSnapshotBucket();
    const query = fakeTableRows({ bangumi: [{ id: "w1", title: "Lucky Star" }] });
    await publishSnapshot({ query, store: r2ObjectStore(bucket) }, { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" });
    const res = await catalogRequest(
      "/catalog/snapshot/rollback",
      { method: "POST", headers: { authorization: "Bearer ops-token" } },
      envOf(bucket, "ops-token"),
    );
    expect(res.status).toBe(404);
  });

  it("rolls back to the previous snapshot with the correct bearer token", async () => {
    const bucket = makeSnapshotBucket();
    await publishTwoSnapshots(bucket);
    const res = await catalogRequest(
      "/catalog/snapshot/rollback",
      { method: "POST", headers: { authorization: "Bearer ops-token" } },
      envOf(bucket, "ops-token"),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ snapshotId: string }>();
    expect(body.snapshotId).toBe("snap-daily-1");
  });
});
