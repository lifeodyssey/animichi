/**
 * The arms that fire when the ledger row is gone by the time the claim's
 * follow-up read runs.
 *
 * Nothing in this service deletes ledger rows, so both stories are races with a
 * concurrent writer rather than request shapes: `reclaim` declines to overwrite a
 * live row and then reads one that has since been deleted, and `claim` loses its
 * INSERT to a conflicting row that is gone before it can be read back. The
 * adapter's answer in both cases is the same — this caller holds the claim — and
 * what differs is the row it writes to get there.
 *
 * `beforePlan` is the fake's documented seam for staging a race between two
 * statements of one flow; index 1 is the read that follows the write in both.
 */
import type { SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import { IDEMPOTENCY_RETENTION_MS, canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { fakeUsersPrisma, ledgerKey, type FakeLedgerRow, type FakeUsersPrisma } from "./fake-users-prisma";

const OP = "saveSavedRoute";
const KEY = "key-001";
const NOW = 1_752_933_600_000; // 2026-07-13T04:00:00.000Z
const LATER = NOW + 5_000;
const EXPIRES_AT = new Date(NOW + IDEMPOTENCY_RETENTION_MS).toISOString();
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
const FINGERPRINT = canonicalFingerprint(INPUT);
const ROUTE_ID = "00000000-0000-4000-8000-000000000001";
/** A committed route the ledger can replay, as its snapshot holds it. */
const ROUTE = {
  id: ROUTE_ID, title: "Tokyo", point_ids: ["p1"], status: "saved" as const,
  saved_at: null, updated_at: new Date(NOW).toISOString(),
};
/** The follow-up read: the second statement of both flows below. */
const FOLLOW_UP_READ = 1;

/** One ledger row, with only the facts a test cares about spelled out. */
function ledgerRow(overrides: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  return {
    owner_user_id: "user-a", op: OP, key: KEY, fingerprint: FINGERPRINT,
    state: "in_progress", result: null, result_id: null,
    created_at: new Date(NOW).toISOString(), expires_at: EXPIRES_AT,
    ...overrides,
  };
}

/** A committed, in-retention ledger row; the fake deletes it before the read. */
function storeLosingTheRow(): FakeUsersPrisma {
  const store = fakeUsersPrisma([], {
    beforePlan: (index) => {
      if (index === FOLLOW_UP_READ) store.idemRows.clear();
    },
  });
  const row = ledgerRow({ state: "committed", result: ROUTE, result_id: ROUTE_ID });
  store.idemRows.set(ledgerKey(row.owner_user_id, row.op, row.key), row);
  return store;
}

describe("a ledger row that vanishes between two statements of one claim", () => {
  it("re-claims a row deleted after the reclaim predicate refused to touch it", async () => {
    const store = storeLosingTheRow();
    const outcome = await new NeonIdempotencyStore(store.prisma).reclaim({
      ownerUserId: "user-a", op: OP, key: KEY, fingerprint: FINGERPRINT, expiresAt: EXPIRES_AT, now: LATER,
    });
    expect(outcome).toEqual({ kind: "claimed" });
    // The claim the caller now holds is the one the fallback wrote, stamped with
    // the reclaimer's own clock rather than the deleted row's facts.
    expect([...store.idemRows.values()]).toEqual([ledgerRow({ created_at: new Date(LATER).toISOString() })]);
  });

  it("lets the caller create when its conflicting row is gone before the read", async () => {
    const store = storeLosingTheRow();
    const route = await saveSavedRouteIdempotent(
      new NeonAtomicCommitStore(store.prisma), new NeonIdempotencyStore(store.prisma),
      "user-a", INPUT, KEY, { now: () => NOW },
    );
    expect(route).toMatchObject({ title: "Tokyo", status: "saved", point_ids: ["p1"] });
    expect(store.rows).toHaveLength(1);
  });

  it("reads a key no row carries as undefined", async () => {
    const store = fakeUsersPrisma();
    const row = await new NeonIdempotencyStore(store.prisma).read({ ownerUserId: "user-a", op: OP, key: KEY });
    expect(row).toBeUndefined();
  });
});
