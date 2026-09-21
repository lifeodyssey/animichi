/**
 * The ledger row's own read policy: what a row the schema permits — and the
 * happy path never produces — comes back as.
 *
 * `created_at` is nullable in the contract (`createdAt TimestamptzString?`) even
 * though the column default fills it in, and the domain already reads a null as
 * "not in flight" (`isInFlight`). So a null must arrive as a null: passing it
 * through `new Date(null)` would invent 1970 and make an abandoned claim look
 * live, which is the difference between reclaiming a key and waiting out a
 * request that is not running.
 *
 * `result` is jsonb, so no query builder can type the snapshot — the contract's
 * own schema is the only thing that can refuse one the model cannot read. That
 * refusal has to be loud: a retry that replays an unreadable snapshot answers 200
 * with garbage.
 */
import type { SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { IDEMPOTENCY_RETENTION_MS, canonicalFingerprint } from "../src/domain/saved-route-idempotency";
import { fakeUsersPrisma, ledgerKey, type FakeLedgerRow, type FakeUsersPrisma } from "./fake-users-prisma";

const OP = "saveSavedRoute";
const KEY = "key-001";
const NOW = 1_752_933_600_000; // 2026-07-13T04:00:00.000Z
const EXPIRES_AT = new Date(NOW + IDEMPOTENCY_RETENTION_MS).toISOString();
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
const FINGERPRINT = canonicalFingerprint(INPUT);
/** A route id the contract's schema refuses: it is not a uuid. */
const UNREADABLE = { id: "not-a-uuid", title: "Tokyo", point_ids: ["p1"], status: "saved", saved_at: null };

/** One ledger row, with only the facts a test cares about spelled out. */
function ledgerRow(overrides: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  return {
    owner_user_id: "user-a", op: OP, key: KEY, fingerprint: FINGERPRINT,
    state: "in_progress", result: null, result_id: null,
    created_at: new Date(NOW).toISOString(), expires_at: EXPIRES_AT,
    ...overrides,
  };
}

/** Write one ledger row into the in-memory data plane under its composite key. */
function seed(store: FakeUsersPrisma, overrides: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  const row = ledgerRow(overrides);
  store.idemRows.set(ledgerKey(row.owner_user_id, row.op, row.key), row);
  return row;
}

describe("a ledger row the model cannot carry is not read as if it could", () => {
  it("reads a row whose created_at never got its default as a null instant", async () => {
    const store = fakeUsersPrisma();
    seed(store, { created_at: null });
    const row = await new NeonIdempotencyStore(store.prisma).read({ ownerUserId: "user-a", op: OP, key: KEY });
    expect(row).toEqual({
      state: "in_progress", fingerprint: FINGERPRINT, result: null,
      createdAt: null, expiresAt: EXPIRES_AT,
    });
  });

  it("refuses to replay a committed snapshot the contract's schema cannot read", async () => {
    const store = fakeUsersPrisma();
    seed(store, { state: "committed", result: UNREADABLE, result_id: "00000000-0000-4000-8000-000000000001" });
    const claim = {
      ownerUserId: "user-a", op: OP, key: KEY, fingerprint: FINGERPRINT, expiresAt: EXPIRES_AT,
    };
    await expect(new NeonIdempotencyStore(store.prisma).claim(claim))
      .rejects.toThrow("invalid idempotency result row");
  });
});
