import type { SavedRoute, SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import { canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { idemFakeDb, recordingDb, type FakeIdempotencyRow } from "./in-memory-routes-db";

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
    atomicStore: new NeonAtomicCommitStore(db),
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
  const { atomicStore, idemStore } = make(db.db);
  return saveSavedRouteIdempotent(atomicStore, idemStore, userId, input, key, opts);
}

async function saveRecorded(
  rec: ReturnType<typeof recordingDb>,
  userId: string,
  input: SaveSavedRouteInput,
  key: string,
): Promise<SavedRoute> {
  return saveSavedRouteIdempotent(
    new NeonAtomicCommitStore(rec.db), new NeonIdempotencyStore(rec.db),
    userId, input, key, fixedNow,
  );
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

describe("A1: adapter reclaim() targetWhere must not be a tautology", () => {
  it("never reclaims a committed row that is still within its retention window", async () => {
    // A committed row 20s old (past the 10s in-flight window, but nowhere
    // near its 24h retention expiry) must be untouchable by reclaim(). The
    // OLD targetWhere (row.expires_at <= the caller's freshly computed new
    // expiresAt) is a tautology: a committed row's own expiry is always
    // <= any later caller's now+24h, so it would be silently overwritten.
    const db = idemFakeDb();
    const idemStore = new NeonIdempotencyStore(db.db);
    const staleCreatedAt = NOW - 20_000;
    const committedResult = {
      id: "r1", title: "Tokyo", point_ids: ["p1"], status: "saved" as const,
      saved_at: null, updated_at: new Date(staleCreatedAt).toISOString(),
    };
    db.idemRows.set("user-a:saveSavedRoute:" + KEY, {
      owner_user_id: "user-a", op: "saveSavedRoute", key: KEY,
      fingerprint: canonicalFingerprint(INPUT), state: "committed",
      result: committedResult, result_id: "r1",
      created_at: new Date(staleCreatedAt).toISOString(),
      expires_at: new Date(staleCreatedAt + 86_400_000).toISOString(),
    });
    const outcome = await idemStore.reclaim({
      ownerUserId: "user-a", op: "saveSavedRoute", key: KEY,
      fingerprint: canonicalFingerprint(INPUT),
      expiresAt: new Date(NOW + 86_400_000).toISOString(), now: NOW,
    });
    expect(outcome).toMatchObject({ kind: "exists", row: { state: "committed" } });
    expect(singleLedger(db).state).toBe("committed");
    expect(singleLedger(db).result).toEqual(committedResult);
  });

  it("concurrent reclaims of the same stale in-progress row: exactly one wins", async () => {
    const db = idemFakeDb();
    const staleCreatedAt = NOW - 20_000; // past the 10s in-flight window
    db.idemRows.set("user-a:saveSavedRoute:" + KEY, {
      owner_user_id: "user-a", op: "saveSavedRoute", key: KEY,
      fingerprint: canonicalFingerprint(INPUT), state: "in_progress",
      result: null, result_id: null,
      created_at: new Date(staleCreatedAt).toISOString(),
      expires_at: new Date(staleCreatedAt + 86_400_000).toISOString(), // not yet expired
    });
    const outcomes = await Promise.allSettled([
      save(db, "user-a", INPUT, KEY),
      save(db, "user-a", INPUT, KEY),
    ]);
    const fulfilled = outcomes.filter((o): o is PromiseFulfilledResult<SavedRoute> => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409, defined: true });
    expect(rowCount(db)).toBe(1);
    expect(singleLedger(db).state).toBe("committed");
    await flushMicrotasks();
  });
});

describe("AC2 atomicity: insert and ledger commit are indivisible (integration)", () => {
  it("inserts the route row exactly once for a fresh key and never on a replay", async () => {
    const rec = recordingDb();
    await saveRecorded(rec, "user-a", INPUT, KEY);
    const inserts = rec.queries.filter((q) => q.sql.includes("insert into \"saved_routes\"")).length;
    const commits = rec.queries.filter((q) => q.sql.includes("update \"saved_route_idempotency\"")).length;
    expect(inserts).toBe(1);
    expect(commits).toBe(1);
    await saveRecorded(rec, "user-a", INPUT, KEY);
    expect(rec.queries.filter((q) => q.sql.includes("insert into \"saved_routes\""))).toHaveLength(1);
  });

  it("a rolled-back batch orphan (no route behind in_progress) is reclaimed into ONE route", async () => {
    // Atomic rollback leaves an in_progress ledger with NO route; the old
    // split-by-request flow would instead leave a committed route row that a
    // later reclaim re-inserted into a DUPLICATE.
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
    const retry = await save(db, "user-a", INPUT, KEY, { now: () => NOW + 86_400_000 + 1 });
    expect(retry).toBeTruthy();
    expect(rowCount(db)).toBe(1);
    expect(singleLedger(db).state).toBe("committed");
  });
});
