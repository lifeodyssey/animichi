/**
 * SUT: what `publishSnapshot` returns when a publish does not activate, over the
 * plane database's real export and an in-memory object store. A rejected
 * candidate returns its validator's own reason; a staging write that throws
 * returns `stagingFailed` with that write's error, never a validation reason.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import type { ObjectStore } from "../src/publish/object-store";
import { publishSnapshot, type PublishInput, type ValidatePort } from "../src/publish/snapshot";
import { inMemoryObjectStore } from "./fakes/in-memory-object-store";
import { databaseDescribe, openPlaneSeams, truncateCatalogPool, type PlaneSeams } from "./integration-db";

const INPUT: PublishInput = { sourceRunId: "daily-1", createdAt: "2026-08-14T00:00:00Z" };

let query: CatalogPrisma;
let seams: PlaneSeams;

beforeAll(async () => {
  seams = await openPlaneSeams();
  query = seams.query;
  await truncateCatalogPool(seams.pool);
  await seams.pool.query("INSERT INTO bangumi (id, title) VALUES ('w1', 'Lucky Star')");
}, 120_000);

afterAll(async () => {
  await seams.dispose();
});

/** An object store whose every write fails the way an exhausted bucket does. */
function refusingStore(): ObjectStore {
  return { ...inMemoryObjectStore().store, put: () => Promise.reject(new Error("R2 quota exceeded")) };
}

databaseDescribe("publishSnapshot failure results", () => {
  it("a rejected candidate returns its validator's own reason", async () => {
    const { store } = inMemoryObjectStore();
    const reject: ValidatePort = () => Promise.resolve({ valid: false, reason: "exported non-public table: sessions" });

    await expect(publishSnapshot({ query, store }, INPUT, reject)).resolves.toEqual({
      status: "invalid", reason: "exported non-public table: sessions",
    });
  });

  it("a staging write that throws returns stagingFailed with the write's error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(publishSnapshot({ query, store: refusingStore() }, INPUT)).resolves.toEqual({
      status: "stagingFailed", reason: "Error: R2 quota exceeded",
    });
  });
});
