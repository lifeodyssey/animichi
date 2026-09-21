/**
 * Neon-backed AtomicCommitStore: the winner's create (route INSERT) and the
 * ledger's commit (state -> committed) ride ONE transaction, so they either
 * both land or neither does.
 *
 * This is the shape #1632 exists to reach. Neon's HTTP batch handed the adapter
 * a fixed set of independent statements and no round trip, so the second
 * (ledger commit) could not read the id the database would assign to the first
 * — the adapter therefore minted a UUIDv7 in the worker and bound it into both
 * statements (the design debt spec §4.2 names). A real transaction can read
 * statement 1's RETURNING, so the INSERT drops `id`, the column's `uuidv7()`
 * default assigns it, and the ledger's snapshot is the row the database
 * actually wrote rather than a hand-built copy of it. What stays is
 * `updated_at`: it comes from the action's clock, which is what makes a
 * repeated request's replay byte-identical (AC4 of #1011).
 */
import type { SaveSavedRouteInput, SavedRoute } from "@animichi/contract";
import type { AtomicCommitStore } from "../application/save-saved-route-idempotent";
import type { UsersPlanExecutor, UsersPrisma, UsersStatementBuilder } from "../db/prisma";
import {
  firstRow,
  insertSavedRoutePlan,
  toSavedRoute,
  type SavedRouteRow,
} from "./neon-saved-route-repo";

export class NeonAtomicCommitStore implements AtomicCommitStore {
  constructor(private readonly prisma: UsersPrisma) {}

  async insertRouteAndCommit(params: AtomicCommitParams): Promise<SavedRoute> {
    return this.prisma.transaction(async (tx) => {
      const row = await commitRoute(tx, this.prisma.builder, params);
      if (row === undefined) throw new Error("saved route insert returned no row");
      const snapshot = toSavedRoute(row);
      await tx.query(commitLedger(this.prisma.builder, params, snapshot));
      return snapshot;
    });
  }
}

interface AtomicCommitParams {
  userId: string; input: SaveSavedRouteInput; savedAt: string | null; now: number;
  ownerUserId: string; op: string; key: string;
}

/** INSERT the new saved route; the database assigns `id` from `uuidv7()`. */
function commitRoute(
  tx: UsersPlanExecutor,
  builder: UsersStatementBuilder,
  params: AtomicCommitParams,
): Promise<SavedRouteRow | undefined> {
  const values = {
    user_id: params.userId, title: params.input.title, point_ids: params.input.point_ids,
    status: params.input.status, saved_at: params.savedAt,
    updated_at: new Date(params.now).toISOString(),
  };
  return firstRow(tx, insertSavedRoutePlan(builder, values));
}

/** Commit the ledger to the row the INSERT just returned, in the same transaction. */
function commitLedger(
  builder: UsersStatementBuilder,
  params: AtomicCommitParams,
  snapshot: SavedRoute,
) {
  return builder.public.saved_route_idempotency
    .update({ state: "committed", result: snapshot, result_id: snapshot.id })
    .where((fields, fns) => fns.eq(fields.owner_user_id, params.ownerUserId))
    .where((fields, fns) => fns.eq(fields.op, params.op))
    .where((fields, fns) => fns.eq(fields.key, params.key))
    .build();
}
