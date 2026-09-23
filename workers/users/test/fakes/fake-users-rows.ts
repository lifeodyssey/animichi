/**
 * The rows the users Prisma double's in-memory data plane holds (#1632).
 *
 * Both tables are stated as the contract declares them, not as a test's wish:
 * one `saved_routes` row, one `saved_route_idempotency` row (issue #1011), and
 * the composite key the ledger is stored under. A test seeds through these
 * shapes and the data plane projects onto them, so a column the contract adds is
 * a type error here before it can be a wrong answer anywhere.
 */

/** One saved_routes row as the in-memory store holds it. */
export interface FakeSavedRouteRow {
  id: string;
  user_id: string | null;
  title: string | null;
  point_ids: string[];
  status: string;
  saved_at: string | null;
  updated_at: string;
}

/** One saved_route_idempotency row (issue #1011). `created_at` is nullable in
 * the contract (`createdAt TimestamptzString?`), so a row that never got the
 * column default is a state the adapter reads. */
export interface FakeLedgerRow {
  owner_user_id: string;
  op: string;
  key: string;
  fingerprint: string;
  state: "in_progress" | "committed";
  result: unknown;
  result_id: string | null;
  created_at: string | null;
  expires_at: string;
}

/** The ledger's composite key, as one string — its `Map` key in this fake. */
export function ledgerKey(ownerUserId: string, op: string, key: string): string {
  return [ownerUserId, op, key].join(":");
}
