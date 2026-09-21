import type { SavedRoute, SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import { canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { fakeUsersPrisma, ledgerKey, type FakeLedgerRow, type FakeUsersPrisma } from "./fake-users-prisma";

const OP = "saveSavedRoute";
const NOW = 1_752_933_600_000; // 2026-07-13T04:00:00.000Z
const RETENTION_MS = 86_400_000;
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1", "p2"], status: "saved" };
const KEY = "key-001";
/** A committed ledger carries a real SavedRoute snapshot, ids included. */
const ROUTE_ID = "00000000-0000-4000-8000-000000000001";
const fixedNow = { now: () => NOW };

/** Let a rejected promise's microtask fully settle before the test returns, so
 * vitest-pool-workers does not double-report a caught rejection as unhandled. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stores(store: FakeUsersPrisma) {
  return {
    atomicStore: new NeonAtomicCommitStore(store.prisma),
    idemStore: new NeonIdempotencyStore(store.prisma),
  };
}

function seededLedger(overrides: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  return {
    owner_user_id: "user-a", op: OP, key: KEY,
    fingerprint: canonicalFingerprint(INPUT), state: "in_progress",
    result: null, result_id: null,
    created_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + RETENTION_MS).toISOString(),
    ...overrides,
  };
}

function seed(store: FakeUsersPrisma, overrides: Partial<FakeLedgerRow> = {}): void {
  const row = seededLedger(overrides);
  store.idemRows.set(ledgerKey(row.owner_user_id, row.op, row.key), row);
}

function singleLedger(store: FakeUsersPrisma): FakeLedgerRow {
  const row = [...store.idemRows.values()][0];
  if (row === undefined) throw new Error("expected one idempotency ledger row");
  return row;
}

async function save(
  store: FakeUsersPrisma,
  userId: string,
  input: SaveSavedRouteInput,
  key: string,
  opts: Parameters<typeof saveSavedRouteIdempotent>[5] = fixedNow,
): Promise<SavedRoute> {
  const { atomicStore, idemStore } = stores(store);
  return saveSavedRouteIdempotent(atomicStore, idemStore, userId, input, key, opts);
}

describe("AC2: idempotent create atomically records key/fingerprint/state/result", () => {
  it("stores the claim, the committed state and the SavedRoute result under the key", async () => {
    const store = fakeUsersPrisma();
    const route = await save(store, "user-a", INPUT, KEY);
    expect(store.rows).toHaveLength(1);
    expect(singleLedger(store)).toMatchObject({
      owner_user_id: "user-a", op: OP, key: KEY,
      fingerprint: canonicalFingerprint(INPUT), state: "committed",
    });
    expect(singleLedger(store).result).toEqual(route);
  });
});

describe("AC3: same key semantics", () => {
  it("replays the original result for the same key/payload", async () => {
    const store = fakeUsersPrisma();
    const first = await save(store, "user-a", INPUT, KEY);
    const second = await save(store, "user-a", INPUT, KEY);
    expect(second).toEqual(first);
    expect(store.rows).toHaveLength(1);
  });

  it("returns a typed 409 for the same key with a different payload", async () => {
    const store = fakeUsersPrisma();
    seed(store, {
      state: "committed",
      fingerprint: canonicalFingerprint({ title: "Tokyo", point_ids: ["p1"], status: "saved" }),
      result: { id: ROUTE_ID, title: "Tokyo", point_ids: ["p1"], status: "saved", saved_at: null, updated_at: new Date(NOW).toISOString() },
      result_id: ROUTE_ID,
    });
    let thrown: unknown;
    try {
      await save(store, "user-a", { title: "Osaka", point_ids: ["p9"], status: "saved" }, KEY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409, defined: true });
    expect(store.rows).toHaveLength(0);
    await flushMicrotasks();
  });

  it("concurrent duplicates create exactly one row", async () => {
    const store = fakeUsersPrisma();
    const outcomes = await Promise.all([
      save(store, "user-a", INPUT, KEY),
      save(store, "user-a", INPUT, KEY),
    ]);
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(store.rows).toHaveLength(1);
    expect(singleLedger(store).state).toBe("committed");
  });
});

describe("AC4: deterministic retry semantics", () => {
  it("a retry after a committed-but-lost response replays the original result (timeout-after-commit)", async () => {
    const store = fakeUsersPrisma();
    const first = await save(store, "user-a", INPUT, KEY);
    // The first response was lost; the retry (later, across isolates) must
    // return the SAME route without a second saved row.
    const retry = await save(store, "user-a", INPUT, KEY, { now: () => NOW + 5_000 });
    expect(retry).toEqual(first);
    expect(store.rows).toHaveLength(1);
  });

  it("two users sharing a key string each create their own route (owner scope)", async () => {
    const store = fakeUsersPrisma();
    await save(store, "user-a", INPUT, KEY);
    await save(store, "user-b", INPUT, KEY);
    expect(store.rows).toHaveLength(2);
    expect(store.idemRows.size).toBe(2);
    expect(store.rows.map((row) => row.user_id).sort()).toEqual(["user-a", "user-b"]);
  });

  it("an expired key is reclaimed: a retry creates a fresh route and refreshes the ledger", async () => {
    const store = fakeUsersPrisma();
    const first = await save(store, "user-a", INPUT, KEY);
    // Past retention: the old committed key no longer shields the operation.
    await save(store, "user-a", INPUT, KEY, { now: () => NOW + RETENTION_MS + 1 });
    expect(store.rows).toHaveLength(2);
    expect(singleLedger(store).result).not.toEqual(first);
    expect(singleLedger(store).state).toBe("committed");
  });

  it("a committed row outlives a mid-retry identity change in created_at (cross-isolate)", async () => {
    const store = fakeUsersPrisma();
    const first = await save(store, "user-a", INPUT, KEY);
    // A later isolate arriving inside the liveness window still replays.
    const second = await save(store, "user-a", INPUT, KEY, { now: () => NOW + 1_000 });
    expect(second).toEqual(first);
    expect(store.rows).toHaveLength(1);
  });

  it("an in-flight conflict surfaces a typed retryable 409 once the budget is exhausted", async () => {
    // A row in_progress that never commits: the bounded re-read gives up with
    // a typed, retryable 409 rather than creating a duplicate row.
    const store = fakeUsersPrisma();
    seed(store);
    await expect(save(store, "user-a", INPUT, KEY))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409, defined: true });
    expect(store.rows).toHaveLength(0);
  });
});

describe("A1: reclaim() must never be a tautology", () => {
  it("never reclaims a committed row that is still within its retention window", async () => {
    // A committed row 20s old (past the 10s in-flight window, but nowhere
    // near its 24h retention expiry) must be untouchable by reclaim(). The
    // staleness predicate rides the UPDATE's own WHERE, so it is evaluated
    // against the row AS IT STANDS; the tautological shape (comparing the
    // row's expiry to the caller's freshly computed new expiry) would
    // silently overwrite this row.
    const store = fakeUsersPrisma();
    const staleCreatedAt = NOW - 20_000;
    const committedResult = {
      id: ROUTE_ID, title: "Tokyo", point_ids: ["p1"], status: "saved" as const,
      saved_at: null, updated_at: new Date(staleCreatedAt).toISOString(),
    };
    seed(store, {
      state: "committed",
      result: committedResult, result_id: ROUTE_ID,
      created_at: new Date(staleCreatedAt).toISOString(),
      expires_at: new Date(staleCreatedAt + RETENTION_MS).toISOString(),
    });
    const { idemStore } = stores(store);
    const outcome = await idemStore.reclaim({
      ownerUserId: "user-a", op: OP, key: KEY,
      fingerprint: canonicalFingerprint(INPUT),
      expiresAt: new Date(NOW + RETENTION_MS).toISOString(), now: NOW,
    });
    expect(outcome).toMatchObject({ kind: "exists", row: { state: "committed" } });
    expect(singleLedger(store).state).toBe("committed");
    expect(singleLedger(store).result).toEqual(committedResult);
  });

  it("concurrent reclaims of the same stale in-progress row: exactly one wins", async () => {
    const store = fakeUsersPrisma();
    const staleCreatedAt = NOW - 20_000; // past the 10s in-flight window
    seed(store, {
      created_at: new Date(staleCreatedAt).toISOString(),
      expires_at: new Date(staleCreatedAt + RETENTION_MS).toISOString(), // not yet expired
    });
    const outcomes = await Promise.allSettled([
      save(store, "user-a", INPUT, KEY),
      save(store, "user-a", INPUT, KEY),
    ]);
    const fulfilled = outcomes.filter((o): o is PromiseFulfilledResult<SavedRoute> => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409, defined: true });
    expect(store.rows).toHaveLength(1);
    expect(singleLedger(store).state).toBe("committed");
    await flushMicrotasks();
  });
});

describe("AC2 atomicity: insert and ledger commit are indivisible", () => {
  it("inserts the route row exactly once for a fresh key and never on a replay", async () => {
    const store = fakeUsersPrisma();
    await save(store, "user-a", INPUT, KEY);
    const inserts = () => store.queries.filter((q) => q.kind === "insert" && q.table === "saved_routes").length;
    expect(inserts()).toBe(1);
    expect(store.queries.filter((q) => q.kind === "update" && q.table === "saved_route_idempotency")).toHaveLength(1);
    await save(store, "user-a", INPUT, KEY);
    expect(inserts()).toBe(1);
  });

  it("a failed ledger commit takes the route row back with it", async () => {
    // The ledger commit is the second statement of the pair. Without the
    // transaction the route row would survive it, leaving an orphan the
    // ledger never committed to.
    const store = fakeUsersPrisma([], {
      beforePlan: (_index, queries) => {
        if (queries.some((q) => q.kind === "insert" && q.table === "saved_routes")) {
          throw new Error("ledger commit unavailable");
        }
      },
    });
    await expect(save(store, "user-a", INPUT, KEY)).rejects.toThrow("ledger commit unavailable");
    expect(store.rows).toHaveLength(0);
    expect([...store.idemRows.values()].some((row) => row.state === "committed")).toBe(false);
  });

  it("a rolled-back orphan (no route behind in_progress) is reclaimed into ONE route", async () => {
    // Atomic rollback leaves an in_progress ledger with NO route; the old
    // split-by-request flow would instead leave a committed route row that a
    // later reclaim re-inserted into a DUPLICATE.
    const store = fakeUsersPrisma();
    seed(store);
    await expect(save(store, "user-a", INPUT, KEY))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409, defined: true });
    expect(store.rows).toHaveLength(0);
    const retry = await save(store, "user-a", INPUT, KEY, { now: () => NOW + RETENTION_MS + 1 });
    expect(retry).toBeTruthy();
    expect(store.rows).toHaveLength(1);
    expect(singleLedger(store).state).toBe("committed");
  });
});
