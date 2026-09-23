/**
 * A claim's conflict is read off the driver failure itself, however the runtime
 * hands it over.
 *
 * `violationOf` reads three shapes as "this composite key is already claimed":
 * the normalized `SqlQueryError` (`sqlState` + `table`, the shape
 * `fake-users-prisma.ts` raises by default and the one the runtime was observed
 * to hand this adapter), a bare `pg` error spelling the SQLSTATE as `code`, and
 * a wrapper that keeps the driver error as its `cause`. The last two are
 * defensive arms: these adapters issue no raw SQL, so nothing observed reaches
 * them.
 *
 * Anything else is NOT a conflict, and it must reach the caller as itself: a
 * connection reset reported as "already claimed" would strand the caller's write
 * behind a key nothing claimed. The walk is bounded too — a failure that is its
 * own cause ends it rather than recursing.
 *
 * A conflict whose row is GONE by the time the follow-up read runs is still this
 * caller's claim (`claimOrExisting` reads nothing and takes the key). That read
 * is a statement of its own, and the last test below is its witness: `beforePlan`
 * fires once per statement the executor was asked for, so a hook that refuses
 * the INSERT must not refuse the read as well — which is why the double records
 * a statement BEFORE it fires the hook.
 */
import type { SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { IDEMPOTENCY_RETENTION_MS, canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { fakeUsersPrisma, ledgerKey, type FakeLedgerRow, type FakeUsersPrisma } from "./fake-users-prisma";

const OP = "saveSavedRoute";
const KEY = "key-001";
const NOW = 1_752_933_600_000; // 2026-07-13T04:00:00.000Z
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
const FINGERPRINT = canonicalFingerprint(INPUT);
/** The ledger's composite key lives on this table, and the claim's INSERT is the
 * first statement every flow in this file runs. */
const LEDGER = "saved_route_idempotency";
const CLAIM_INSERT = 0;

/** The raw `pg` failure: the SQLSTATE under `code`, beside the table it names. */
function pgUniqueViolation(table: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint on "${table}"`), {
    code: "23505",
    table,
  });
}

/** A driver failure the runtime wrapped, keeping the driver error as its cause. */
function causedBy(cause: Error): Error {
  return new Error("query failed", { cause });
}

function claimParams() {
  return {
    ownerUserId: "user-a", op: OP, key: KEY, fingerprint: FINGERPRINT,
    expiresAt: new Date(NOW + IDEMPOTENCY_RETENTION_MS).toISOString(),
  };
}

/** One ledger row, with only the facts a test cares about spelled out. */
function ledgerRow(overrides: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  return {
    owner_user_id: "user-a", op: OP, key: KEY, fingerprint: FINGERPRINT,
    state: "in_progress", result: null, result_id: null,
    created_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + IDEMPOTENCY_RETENTION_MS).toISOString(),
    ...overrides,
  };
}

/** A committed row under this key — the row the claim's INSERT collides with. */
function claimCollidingWith(options: Parameters<typeof fakeUsersPrisma>[1] = {}): FakeUsersPrisma {
  const store = fakeUsersPrisma([], options);
  const row = ledgerRow({ state: "committed" });
  store.idemRows.set(ledgerKey(row.owner_user_id, row.op, row.key), row);
  return store;
}

/** A claim whose INSERT fails outright, with no row behind the failure. */
function claimFailingWith(failure: Error): FakeUsersPrisma {
  return fakeUsersPrisma([], {
    beforePlan: (index) => {
      if (index === CLAIM_INSERT) throw failure;
    },
  });
}

/** A claim whose INSERT is refused as a conflict, with no row behind it — what a
 * concurrent writer that claimed the key and then dropped the row leaves. */
function claimRefusedAsConflict(): FakeUsersPrisma {
  return fakeUsersPrisma([], {
    beforePlan: (index) => {
      if (index === CLAIM_INSERT) throw pgUniqueViolation(LEDGER);
    },
  });
}

describe("a claim's conflict is read from the driver failure", () => {
  it("reads a raw pg failure's code as the SQLSTATE", async () => {
    const store = claimCollidingWith({ uniqueViolation: () => pgUniqueViolation(LEDGER) });
    const outcome = await new NeonIdempotencyStore(store.prisma).claim(claimParams());
    expect(outcome).toMatchObject({ kind: "exists", row: { state: "committed", fingerprint: FINGERPRINT } });
  });

  it("walks a wrapper to the driver failure it keeps as its cause", async () => {
    const store = claimCollidingWith({ uniqueViolation: () => causedBy(pgUniqueViolation(LEDGER)) });
    const outcome = await new NeonIdempotencyStore(store.prisma).claim(claimParams());
    expect(outcome).toMatchObject({ kind: "exists", row: { state: "committed", fingerprint: FINGERPRINT } });
  });

  it("reads the follow-up statement as its own, not as the refused claim again", async () => {
    const store = claimRefusedAsConflict();
    const outcome = await new NeonIdempotencyStore(store.prisma).claim(claimParams());
    expect(outcome).toEqual({ kind: "claimed" });
    // The refused INSERT is counted, so the read that follows it is the SECOND
    // statement and its hook fires at index 1 rather than re-firing at index 0.
    expect(store.queries).toEqual([
      { kind: "insert", table: LEDGER },
      { kind: "select", table: LEDGER },
    ]);
  });

  it("rethrows a failure that is not a unique violation, exactly as it arrived", async () => {
    const failure = new Error("connection reset by peer");
    const store = claimFailingWith(failure);
    await expect(new NeonIdempotencyStore(store.prisma).claim(claimParams())).rejects.toBe(failure);
  });

  it("stops at a failure that is its own cause", async () => {
    const failure = new Error("driver failure with a circular cause");
    failure.cause = failure;
    const store = claimFailingWith(failure);
    await expect(new NeonIdempotencyStore(store.prisma).claim(claimParams())).rejects.toBe(failure);
  });
});
