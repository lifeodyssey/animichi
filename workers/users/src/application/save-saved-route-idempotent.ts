import type { SaveSavedRouteInput, SavedRoute } from "@animichi/contract";
import {
  SAVED_ROUTE_OP,
  canonicalFingerprint,
  isExpired,
  isInFlight,
  retentionExpiry,
} from "../domain/saved-route-idempotency";
import { savedAtForStatus } from "../domain/saved-route-status";
import { savedRouteIdempotencyConflict, savedRouteIdempotencyInFlight } from "../lib/errors";

/** The current idempotency row facts the action needs, normalized to ISO strings. */
export interface IdempotencyRow {
  readonly state: "in_progress" | "committed";
  readonly fingerprint: string;
  readonly result: SavedRoute | null;
  readonly createdAt: string | null;
  readonly expiresAt: string;
}

/**
 * The atomic winner write for an idempotent create (AC2, #1011): the new
 * SavedRoute and the ledger's commitment to it must land together. Neon's HTTP
 * driver has no client-side transactions, so the adapter fulfils this with a
 * single server-side batch (db.batch), which neon-http runs as one
 * non-interactive Postgres transaction — a half-failure rolls BOTH the route
 * insert and the ledger update back, so an orphaned saved route can never hide
 * behind an in_progress ledger row (which would later reclaim into a duplicate
 * create). See the neon-atomic-commit adapter for the trade-off in choosing a
 * worker-generated UUIDv7 id (both batch statements must agree on the route id
 * without a round-trip, since the DB default id is invisible to the second
 * statement).
 */
export interface AtomicCommitStore {
  insertRouteAndCommit(params: {
    userId: string;
    input: SaveSavedRouteInput;
    savedAt: string | null;
    /** Action clock time (ms); drives updated_at so the ledger snapshot and the
     * inserted row stay byte-identical (AC4 deterministic replay). */
    now: number;
    ownerUserId: string;
    op: string;
    key: string;
  }): Promise<SavedRoute>;
}

/** The one outbound write seam for the idempotency ledger. */
export interface IdempotencyStore {
  claim(params: {
    ownerUserId: string; op: string; key: string; fingerprint: string; expiresAt: string;
  }): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }>;
  commit(params: { ownerUserId: string; op: string; key: string; result: SavedRoute; }): Promise<void>;
  reclaim(params: {
    ownerUserId: string; op: string; key: string; fingerprint: string; expiresAt: string; now: number;
  }): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }>;
  read(params: { ownerUserId: string; op: string; key: string }): Promise<IdempotencyRow | undefined>;
}

/** Injectable clock + bounded re-read so concurrency is deterministic in tests. */
export interface IdempotentSaveOptions {
  now?: () => number;
  retries?: number;
  awaitMs?: (attempt: number) => Promise<void>;
}

/** Claim-key identity plus the write facts the action carries through. */
interface ClaimConfig {
  ownerUserId: string; op: string; key: string; fingerprint: string; expiresAt: string;
}

/** What a re-read of a live row tells the retryer to do next. */
type ReadResolution =
  | { kind: "wait" }
  | { kind: "conflict" }
  | { kind: "committed"; result: SavedRoute }
  | { kind: "stale" };

/** Classify a re-read: a committed match replays, a different payload is a
 * conflict, an expired/orphaned row is reclaimable ("stale"), else wait. */
function classifyRead(row: IdempotencyRow | undefined, fingerprint: string, now: number): ReadResolution {
  if (row === undefined) return { kind: "conflict" };
  if (row.fingerprint !== fingerprint) return { kind: "conflict" };
  if (row.state === "committed" && row.result !== null) return { kind: "committed", result: row.result };
  if (isExpired(row.expiresAt, now) || !isInFlight(row.createdAt, now)) return { kind: "stale" };
  return { kind: "wait" };
}

/** A create that is safe to retry under an Idempotency-Key. The action owns the
 * claim/commit/replay policy and the typed errors; the stores own the SQL. */
export async function saveSavedRouteIdempotent(
  atomicStore: AtomicCommitStore,
  idempotencyStore: IdempotencyStore,
  userId: string,
  input: SaveSavedRouteInput,
  key: string,
  opts: IdempotentSaveOptions = {},
): Promise<SavedRoute> {
  const now = (opts.now ?? realNow)();
  const claim: ClaimConfig = {
    ownerUserId: userId, op: SAVED_ROUTE_OP, key,
    fingerprint: canonicalFingerprint(input), expiresAt: retentionExpiry(now),
  };
  const first = await idempotencyStore.claim(claim);
  if (first.kind === "claimed") return executeAndCommit(atomicStore, claim, userId, input, now);
  if (isExpired(first.row.expiresAt, now)) return reclaimOrExecute(idempotencyStore, atomicStore, claim, userId, input, now);
  if (first.row.fingerprint !== claim.fingerprint) throw savedRouteIdempotencyConflict();
  return replay(idempotencyStore, claim, first.row, userId, input, opts, atomicStore, now);
}

/** The winner's path: atomically insert the SavedRoute and commit the ledger. */
async function executeAndCommit(
  atomicStore: AtomicCommitStore,
  claim: ClaimConfig,
  userId: string,
  input: SaveSavedRouteInput,
  now: number,
): Promise<SavedRoute> {
  return atomicStore.insertRouteAndCommit({
    userId, input,
    savedAt: savedAtForStatus(input.status, null, new Date(now).toISOString()),
    now, ownerUserId: userId, op: claim.op, key: claim.key,
  });
}

/** A live, identical-payload non-winner: replay a committed result or wait out
 * an in-flight claim (bounded), reclaiming an orphaned row. The caller has
 * already rejected the expired and fingerprint-mismatch cases. */
async function replay(
  idempotencyStore: IdempotencyStore,
  claim: ClaimConfig,
  row: IdempotencyRow,
  userId: string,
  input: SaveSavedRouteInput,
  opts: IdempotentSaveOptions,
  atomicStore: AtomicCommitStore,
  now: number,
): Promise<SavedRoute> {
  if (row.state === "committed" && row.result !== null) return row.result;
  if (!isInFlight(row.createdAt, now)) return reclaimOrExecute(idempotencyStore, atomicStore, claim, userId, input, now);
  return waitForCommit(idempotencyStore, claim, userId, input, opts, atomicStore, now);
}

/** Reclaim an expired/orphaned row as this caller's fresh claim and execute. */
async function reclaimOrExecute(
  idempotencyStore: IdempotencyStore,
  atomicStore: AtomicCommitStore,
  claim: ClaimConfig,
  userId: string,
  input: SaveSavedRouteInput,
  now: number,
): Promise<SavedRoute> {
  const outcome = await idempotencyStore.reclaim({ ...claim, now });
  if (outcome.kind === "claimed") return executeAndCommit(atomicStore, claim, userId, input, now);
  throw savedRouteIdempotencyInFlight();
}

/** Bounded re-read of an in-flight claim; give a deterministic retryable error
 * if the winner does not reconcile within the re-read budget. */
async function waitForCommit(
  idempotencyStore: IdempotencyStore,
  claim: ClaimConfig,
  userId: string,
  input: SaveSavedRouteInput,
  opts: IdempotentSaveOptions,
  atomicStore: AtomicCommitStore,
  now: number,
): Promise<SavedRoute> {
  const retries = opts.retries ?? 3;
  const awaitMs = opts.awaitMs ?? immediate;
  for (let attempt = 0; attempt < retries; attempt++) {
    await awaitMs(attempt);
    const row = await idempotencyStore.read({ ownerUserId: userId, op: claim.op, key: claim.key });
    const resolution = classifyRead(row, claim.fingerprint, now);
    if (resolution.kind === "committed") return resolution.result;
    if (resolution.kind === "conflict") throw savedRouteIdempotencyConflict();
    if (resolution.kind === "stale") return reclaimOrExecute(idempotencyStore, atomicStore, claim, userId, input, now);
  }
  throw savedRouteIdempotencyInFlight();
}

const realNow = () => Date.now();
const immediate = () => Promise.resolve();
