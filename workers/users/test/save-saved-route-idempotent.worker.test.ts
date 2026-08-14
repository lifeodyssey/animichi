import type { SavedRoute, SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import { canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { idemFakeDb, type FakeIdempotencyRow } from "./in-memory-routes-db";

function singleLedger(db: ReturnType<typeof idemFakeDb>): FakeIdempotencyRow {
  const row = [...db.idemRows.values()][0];
  if (row === undefined) throw new Error("expected one idempotency ledger row");
  return row;
}

const NOW = 1_752_933_600_000; // 2026-07-13T04:00:00.000Z
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1", "p2"], status: "saved" };
const KEY = "key-001";
const fixedNow = { now: () => NOW };

/** Let a rejected promise's microtask fully settle before the test returns, so
 * vitest-pool-workers does not double-report a caught rejection as unhandled. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function make(db: ReturnType<typeof idemFakeDb>["db"]) {
  return {
    savedRouteStore: new NeonSavedRouteStore(db),
    idemStore: new NeonIdempotencyStore(db),
  };
}

function rowCount(db: ReturnType<typeof idemFakeDb>): number {
  return db.rows.length;
}

async function save(
  db: ReturnType<typeof idemFakeDb>,
  userId: string,
  input: SaveSavedRouteInput,
  key: string,
  opts: Parameters<typeof saveSavedRouteIdempotent>[5] = fixedNow,
): Promise<SavedRoute> {
  const { savedRouteStore, idemStore } = make(db.db);
  return saveSavedRouteIdempotent(savedRouteStore, idemStore, userId, input, key, opts);
}

describe("AC2: idempotent create atomically records key/fingerprint/state/result (integration)", () => {
  it("stores the claim, the committed state and the SavedRoute result under the key", async () => {
    const db = idemFakeDb();
    const route = await save(db, "user-a", INPUT, KEY);
    expect(rowCount(db)).toBe(1);
    const ledger = singleLedger(db);
    expect(ledger).toMatchObject({
      owner_user_id: "user-a", op: "saveSavedRoute", key: KEY,
      fingerprint: canonicalFingerprint(INPUT), state: "committed",
    });
    expect(ledger.result).toEqual(route);
  });
});

describe("AC3: same key semantics", () => {
  it("replays the original result for the same key/payload", async () => {
    const db = idemFakeDb();
    const first = await save(db, "user-a", INPUT, KEY);
    const second = await save(db, "user-a", INPUT, KEY);
    expect(second).toEqual(first);
    expect(rowCount(db)).toBe(1);
  });

  it("returns a typed 409 for the same key with a different payload", async () => {
    const db = idemFakeDb();
    db.idemRows.set("user-a:saveSavedRoute:" + KEY, {
      owner_user_id: "user-a", op: "saveSavedRoute", key: KEY,
      fingerprint: canonicalFingerprint({ title: "Tokyo", point_ids: ["p1"], status: "saved" }),
      state: "committed",
      result: { id: "r1", title: "Tokyo", point_ids: ["p1"], status: "saved", saved_at: null, updated_at: "" },
      result_id: "r1", created_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 86_400_000).toISOString(),
    });
    let thrown: unknown;
    try {
      await save(db, "user-a", { title: "Osaka", point_ids: ["p9"], status: "saved" }, KEY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409, defined: true });
    expect(rowCount(db)).toBe(0);
    await flushMicrotasks();
  });

  it("concurrent duplicates create exactly one row", async () => {
    const db = idemFakeDb();
    const outcomes = await Promise.all([save(db, "user-a", INPUT, KEY), save(db, "user-a", INPUT, KEY)]);
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(rowCount(db)).toBe(1);
    const ledger = singleLedger(db);
    expect(ledger.state).toBe("committed");
  });
});

describe("AC4: deterministic retry semantics", () => {
  it("a retry after a committed-but-lost response replays the original result (timeout-after-commit)", async () => {
    const db = idemFakeDb();
    const first = await save(db, "user-a", INPUT, KEY);
    // The first response was lost; the retry (later, across isolates) must
    // return the SAME route without a second saved row.
    const retry = await save(db, "user-a", INPUT, KEY, { now: () => NOW + 5_000 });
    expect(retry).toEqual(first);
    expect(rowCount(db)).toBe(1);
  });

  it("two users sharing a key string each create their own route (owner scope)", async () => {
    const db = idemFakeDb();
    await save(db, "user-a", INPUT, KEY);
    await save(db, "user-b", INPUT, KEY);
    expect(rowCount(db)).toBe(2);
    expect(db.idemRows.size).toBe(2);
    expect(db.rows.map((r) => r.user_id).sort()).toEqual(["user-a", "user-b"]);
  });

  it("an expired key is reclaimed: a retry creates a fresh route and refreshes the ledger", async () => {
    const db = idemFakeDb();
    const first = await save(db, "user-a", INPUT, KEY);
    // Past retention: the old committed key no longer shields the operation.
    await save(db, "user-a", INPUT, KEY, { now: () => NOW + 86_400_000 + 1 });
    expect(rowCount(db)).toBe(2);
    const ledger = singleLedger(db);
    expect(ledger.result).not.toEqual(first);
    expect(ledger.state).toBe("committed");
  });

  it("a committed row outlives a mid-retry identity change in created_at (cross-isolate)", async () => {
    const db = idemFakeDb();
    const first = await save(db, "user-a", INPUT, KEY);
    // A later isolate arriving inside the liveness window still replays.
    const second = await save(db, "user-a", INPUT, KEY, { now: () => NOW + 1_000 });
    expect(second).toEqual(first);
    expect(rowCount(db)).toBe(1);
  });

  it("an in-flight conflict surfaces a typed retryable 409 once the budget is exhausted", async () => {
    // A row in_progress that never commits: the bounded re-read gives up with
    // a typed, retryable 409 rather than creating a duplicate row.
    const db = idemFakeDb();
    db.idemRows.set("user-a:saveSavedRoute:" + KEY, {
      owner_user_id: "user-a", op: "saveSavedRoute", key: KEY,
      fingerprint: canonicalFingerprint(INPUT), state: "in_progress",
      result: null, result_id: null, created_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + 86_400_000).toISOString(),
    });
    await expect(save(db, "user-a", INPUT, KEY))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409, defined: true });
    expect(rowCount(db)).toBe(0);
  });
});
