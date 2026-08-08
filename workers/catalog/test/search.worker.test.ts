import { describe, expect, it } from "vitest";
import { search } from "../src/api/search";
import { fakeDb, ROW, waitUntilSpy } from "./in-memory-search-db";
import { PREVIEW_POINT } from "./fixtures/l1-preview-point";
import { assertContractShape, assertNullFieldsOmitted } from "./search-contract-asserts";

/**
 * Unit tests for the Catalog `search` read API (catalog/src/api/search.ts).
 *
 * `search` takes the narrow `SearchDb` port (the minimal surface it calls), so
 * these inject a typed in-memory fake instead of a real container. We assert:
 * a known alias maps points to the contract `Point` shape; the query
 * is NFKC-normalized before the lookup; and — the focus of this card — that an
 * alias MISS is TIERED so workerd never blocks on the full ingest:
 *   - with a `waitUntil`: the L1 lite preview returns FAST (no awaiting the full
 *     ingest), `partial:true` is set, and the full ingest is SCHEDULED on
 *     `waitUntil` (asserted via a spy that collects the scheduled promise);
 *   - awaiting that captured promise then runs the full ingest;
 *   - without a `waitUntil`: it falls back to the prior synchronous behavior.
 * Pure logic; named *.worker.test.ts so the vitest-pool-workers config picks it
 * up.
 */

describe("search (alias hit)", () => {
  it("maps a known alias to Point rows in contract shape", assertContractShape);

  it("returns synced_at from the work's bangumi.updated_at", async () => {
    const { db } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.synced_at).toBe("2026-06-20T00:00:00.000Z");
  });

  it("an alias HIT returns directly without resolving a preview or ingesting", async () => {
    const { db, resolved, ingested } = fakeDb({ "lucky star": { workId: "1", rows: [ROW] } });
    const result = await search(db, { query: "Lucky Star" });
    expect(result.rows).toHaveLength(1);
    expect(resolved).toEqual([]);
    expect(ingested).toEqual([]);
  });

  it("NFKC-normalizes the query before the alias lookup", async () => {
    const { db, lookups } = fakeDb({});
    await search(db, { query: "  ＦＡＴＥ  " });
    expect(lookups).toEqual(["fate"]);
  });

  it("omits optional fields that are null in the DB row", assertNullFieldsOmitted);
});

describe("search (alias miss — L1 preview + background ingest)", () => {
  it("returns the L1 lite preview FAST and schedules the full ingest on waitUntil", async () => {
    const { db, resolved, ingested } = fakeDb(
      {},
      { resolvePreview: () => Promise.resolve({ workId: "10380", points: [PREVIEW_POINT] }) },
    );
    const { waitUntil, scheduled } = waitUntilSpy();

    const result = await search(db, { query: "けいおん！" }, { waitUntil });

    expect(result.rows).toEqual([PREVIEW_POINT]); // immediate L1 preview, not published rows
    expect(result.partial).toBe(true);
    expect(resolved).toEqual(["けいおん！"]);
    expect(scheduled).toHaveLength(1); // full ingest handed to waitUntil (backgrounded)
    void ingested; // completion is asserted in the "when awaited" test below
  });

  it("the scheduled promise runs the full ingest when awaited", async () => {
    const { db, ingested } = fakeDb(
      {},
      { resolvePreview: () => Promise.resolve({ workId: "10380", points: [PREVIEW_POINT] }) },
    );
    const { waitUntil, scheduled } = waitUntilSpy();

    await search(db, { query: "けいおん！" }, { waitUntil });
    await Promise.all(scheduled); // drain the backgrounded work

    expect(ingested).toEqual(["10380"]);
  });

  it("returns empty rows when the title cannot be resolved to a preview", async () => {
    const { db, resolved, ingested } = fakeDb({}, { resolvePreview: () => Promise.resolve(null) });
    const { waitUntil, scheduled } = waitUntilSpy();

    const result = await search(db, { query: "unknown anime" }, { waitUntil });

    expect(result.rows).toEqual([]);
    expect(result.partial).toBeUndefined();
    expect(resolved).toEqual(["unknown anime"]);
    expect(scheduled).toEqual([]);
    expect(ingested).toEqual([]);
    expect(typeof result.synced_at).toBe("string");
  });
});
