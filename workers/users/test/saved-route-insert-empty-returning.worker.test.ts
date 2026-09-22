/**
 * An `INSERT ... RETURNING` that comes back with no row.
 *
 * Both stores that create a saved route read their statement's row through
 * `firstRow`, and both refuse to map an absent one rather than hand `undefined`
 * to `toSavedRoute` — a `TypeError` two frames later that names neither the
 * statement nor the fact that the database returned nothing. The transaction
 * guard matters twice over: the winner's route insert and the ledger's commit
 * ride one transaction, so refusing the first must take the ledger's claim back
 * with it (as an `in_progress` orphan a later reclaim picks up, not a route).
 *
 * `fake-users-prisma.ts`'s `emptyReturning` stages the empty answer, which is
 * what a `BEFORE INSERT` trigger suppressing a row leaves behind.
 */
import type { SaveSavedRouteInput } from "@animichi/contract";
import { describe, expect, it } from "vitest";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { NeonSavedRouteStore } from "../src/adapters/neon-saved-route-repo";
import { saveSavedRoute } from "../src/application/save-saved-route";
import { saveSavedRouteIdempotent } from "../src/application/save-saved-route-idempotent";
import { fakeUsersPrisma, type FakeUsersPrisma, type RecordedPlan } from "./fake-users-prisma";

const NOW = "2026-07-13T04:00:00.000Z";
const NOW_MS = 1_752_933_600_000;
const KEY = "key-001";
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1"], status: "saved" };
const NO_ROW = "saved route insert returned no row";
const fixedNow = { now: () => NOW };

/** The fake with its route INSERT answering no row. */
function storeWithoutRouteReturning(): FakeUsersPrisma {
  return fakeUsersPrisma([], { emptyReturning: (plan: RecordedPlan) => plan.table === "saved_routes" });
}

describe("a saved route write that returned no row", () => {
  it("refuses the create rather than mapping an absent row", async () => {
    const store = storeWithoutRouteReturning();
    const repo = new NeonSavedRouteStore(store.prisma);
    await expect(saveSavedRoute(repo, "user-a", INPUT, fixedNow)).rejects.toThrow(NO_ROW);
  });

  it("takes the transaction's route row back, leaving the claim orphaned", async () => {
    const store = storeWithoutRouteReturning();
    const atomic = new NeonAtomicCommitStore(store.prisma);
    const idempotency = new NeonIdempotencyStore(store.prisma);
    await expect(saveSavedRouteIdempotent(atomic, idempotency, "user-a", INPUT, KEY, { now: () => NOW_MS }))
      .rejects.toThrow(NO_ROW);
    expect(store.rows).toHaveLength(0);
    expect([...store.idemRows.values()].map((row) => row.state)).toEqual(["in_progress"]);
  });
});
