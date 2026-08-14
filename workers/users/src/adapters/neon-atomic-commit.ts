import type { SaveSavedRouteInput, SavedRoute } from "@animichi/contract";
import { and, eq } from "drizzle-orm";
import type { AtomicCommitStore } from "../application/save-saved-route-idempotent";
import type { UsersDb } from "../db/client";
import { savedRouteIdempotency, savedRoutes } from "../db/schema";
import { savedRouteReturning, toSavedRoute } from "./neon-saved-route-repo";

/**
 * Neon-backed AtomicCommitStore: the winner's create (route INSERT) and the
 * ledger's commit (state -> committed) are issued as ONE server-side Neon HTTP
 * batch, so they either both land or neither does.
 *
 * WHY a worker-generated UUIDv7 id: db.batch hands the adapter a fixed set of
 * independent statements, and the second (ledger commit) must reference the
 * route's id (result / result_id). The DB-owned uuidv7() default is invisible
 * to a second statement in the same batch (neon-http offers no client-side
 * transaction that could read statement 1's RETURNING). To keep the batch
 * atomic without a round-trip, the adapter generates the id first and binds it
 * into BOTH statements. Identity stays RFC 9562 UUIDv7 (time-ordered, unique),
 * so this only moves id ownership to the worker on this path instead of
 * changing the identity scheme.
 */
export class NeonAtomicCommitStore implements AtomicCommitStore {
  constructor(private readonly db: UsersDb) {}

  async insertRouteAndCommit(params: AtomicCommitParams): Promise<SavedRoute> {
    const id = newRouteId();
    const snapshot = savedRouteSnapshot(params, id);
    const [inserted] = await this.db.batch([
      this.db.execute(insertRoute(this.db, params, snapshot)),
      this.db.execute(commitLedger(this.db, params, snapshot)),
    ]);
    return toSavedRoute(inserted.rows[0]);
  }
}

interface AtomicCommitParams {
  userId: string; input: SaveSavedRouteInput; savedAt: string | null; now: number;
  ownerUserId: string; op: string; key: string;
}

/** The ledger-bound snapshot: identical to what the INSERT ... RETURNING row yields. */
function savedRouteSnapshot(params: AtomicCommitParams, id: string): SavedRoute {
  return {
    id, title: params.input.title, point_ids: params.input.point_ids,
    status: params.input.status, saved_at: params.savedAt, updated_at: new Date(params.now).toISOString(),
  };
}

/** INSERT the new saved route with the worker-seeded id + updated_at. */
function insertRoute(db: UsersDb, params: AtomicCommitParams, snapshot: SavedRoute) {
  return db.insert(savedRoutes).values({
    id: snapshot.id, userId: params.userId, title: params.input.title,
    pointIds: params.input.point_ids, status: params.input.status,
    savedAt: params.savedAt === null ? null : new Date(params.savedAt),
    updatedAt: new Date(params.now),
  }).returning(savedRouteReturning());
}

/** Commit the ledger to this route in the same transaction. */
function commitLedger(db: UsersDb, params: AtomicCommitParams, snapshot: SavedRoute) {
  return db.update(savedRouteIdempotency)
    .set({ state: "committed", result: snapshot, resultId: snapshot.id })
    .where(and(
      eq(savedRouteIdempotency.ownerUserId, params.ownerUserId),
      eq(savedRouteIdempotency.op, params.op),
      eq(savedRouteIdempotency.key, params.key),
    ));
}

const HEX = "0123456789abcdef";

/** RFC 9562 UUIDv7: 48-bit unix-millis timestamp + version/variant + entropy. */
function newRouteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  return hexString(bytes);
}

/** Lowercase hex (RFC 4122 grouped) of the 16 uuid bytes. */
function hexString(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0f);
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
