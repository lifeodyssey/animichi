import type { SavedRouteStatus } from "@animichi/contract";
import { drizzle } from "drizzle-orm/neon-http";
import type { UsersDb } from "../src/db/client";
import * as schema from "../src/db/schema";

/** Mutable row representation owned by the reusable fake database. */
export interface FakeSavedRouteRow {
  id: string;
  user_id: string | null;
  title: string | null;
  point_ids: string[];
  status: SavedRouteStatus;
  saved_at: string | null;
  updated_at: string;
  first_query?: string;
}

/** In-memory idempotency ledger row (issue #1011), keyed by owner+op+key. */
export interface FakeIdempotencyRow {
  owner_user_id: string;
  op: string;
  key: string;
  fingerprint: string;
  state: "in_progress" | "committed";
  result: unknown;
  result_id: string | null;
  created_at: string;
  expires_at: string;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;

function idemKey(owner: string, op: string, key: string): string {
  return [owner, op, key].join(":");
}

/** createdAt is derived from the bound expires_at (now + retention) so it lines
 * up with the action's injected clock without a separate fake clock. */
function idemCreatedAt(expiresAtParam: unknown): string {
  const when = new Date(String(expiresAtParam)).getTime();
  return new Date(when - RETENTION_MS).toISOString();
}

function idemReturnRow(row: FakeIdempotencyRow): Record<string, unknown> {
  return {
    state: row.state, fingerprint: row.fingerprint, result: row.result,
    created_at: row.created_at, expires_at: row.expires_at,
  };
}

/** The driver binds jsonb as a JSON string; the fake keeps it as the object. */
function parseJsonCell(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Dispatch statements against the saved_route_idempotency table. */
function idempotencyRows(
  rows: Map<string, FakeIdempotencyRow>, text: string, values: unknown[],
): unknown[] {
  const insert = text.startsWith("insert into \"saved_route_idempotency\"");
  const upsert = insert && text.includes("do update");
  if (upsert) return idemUpsert(rows, values);
  if (insert) return idemInsert(rows, values);
  if (text.startsWith("update \"saved_route_idempotency\"")) return idemUpdate(rows, values);
  const existing = rows.get(idemKey(String(values[0]), String(values[1]), String(values[2])));
  return existing === undefined ? [] : [idemReturnRow(existing)];
}

/** INSERT ... ON CONFLICT DO NOTHING (owner/op/key are params 0-2). */
function idemInsert(rows: Map<string, FakeIdempotencyRow>, values: unknown[]): unknown[] {
  const slot = idemKey(String(values[0]), String(values[1]), String(values[2]));
  if (rows.has(slot)) return [];
  const row: FakeIdempotencyRow = {
    owner_user_id: String(values[0]), op: String(values[1]), key: String(values[2]),
    fingerprint: String(values[3]), state: "in_progress", result: null, result_id: null,
    created_at: idemCreatedAt(values[6]), expires_at: String(values[6]),
  };
  rows.set(slot, row);
  return [idemReturnRow(row)];
}

/** UPDATE saved_route_idempotency (owner/op/key are params 3-5). */
function idemUpdate(rows: Map<string, FakeIdempotencyRow>, values: unknown[]): unknown[] {
  const slot = idemKey(String(values[3]), String(values[4]), String(values[5]));
  const row = rows.get(slot);
  if (row === undefined) return [];
  row.state = values[0] === "committed" ? "committed" : "in_progress";
  row.result = parseJsonCell(values[1]);
  row.result_id = typeof values[2] === "string" ? values[2] : null;
  return [];
}

/** INSERT ... ON CONFLICT (owner,op,key) targetWhere expires_at <= $8 DO UPDATE. */
function idemUpsert(rows: Map<string, FakeIdempotencyRow>, values: unknown[]): unknown[] {
  const owner = String(values[0]); const op = String(values[1]); const key = String(values[2]);
  const slot = idemKey(owner, op, key);
  const existing = rows.get(slot);
  const expiresAt = String(values[6]);
  const overwrite = existing !== undefined && existing.expires_at <= String(values[7]);
  if (existing === undefined || overwrite) {
    const row: FakeIdempotencyRow = {
      owner_user_id: owner, op, key, fingerprint: String(values[3]),
      state: "in_progress", result: null, result_id: null,
      created_at: existing === undefined ? idemCreatedAt(expiresAt) : existing.created_at,
      expires_at: expiresAt,
    };
    rows.set(slot, row);
    return [idemReturnRow(row)];
  }
  return [];
}

const NOW = "2026-07-13T04:00:00.000Z";
const NEW_ID = "00000000-0000-4000-8000-000000000001";

function routeStatus(value: unknown): SavedRouteStatus {
  return value === "draft" || value === "completed" ? value : "saved";
}

/** Parse a Postgres array literal bound by Drizzle (e.g. "{p1}" or "{}"). */
function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value !== "string") return [];
  const inner = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  return inner.length === 0 ? [] : inner.split(",").map((part) => part.replace(/^"(.*)"$/, "$1"));
}

/** Build an in-memory row from the builder's INSERT values. */
function insertRow(values: unknown[]): FakeSavedRouteRow {
  const status = routeStatus(values[3]);
  return {
    id: NEW_ID,
    user_id: typeof values[1] === "string" ? values[1] : null,
    title: typeof values[2] === "string" ? values[2] : "",
    point_ids: parsePgArray(values[0]),
    status,
    saved_at: typeof values[4] === "string" ? values[4] : null,
    updated_at: NOW,
  };
}

/** Mutate a stored row from the builder's UPDATE set values. */
function updateRow(row: FakeSavedRouteRow, values: unknown[]): void {
  row.title = typeof values[1] === "string" ? values[1] : row.title;
  row.point_ids = parsePgArray(values[0]);
  row.status = routeStatus(values[2]);
  row.saved_at = typeof values[3] === "string" ? values[3] : null;
  row.updated_at = NOW;
}

function rawRow(row: FakeSavedRouteRow): Record<string, unknown> {
  return {
    id: row.id, user_id: row.user_id, title: row.title, point_ids: row.point_ids,
    status: row.status, saved_at: row.saved_at, updated_at: row.updated_at,
  };
}

function rawReturningRow(row: FakeSavedRouteRow): Record<string, unknown> {
  return {
    id: row.id, title: row.title, point_ids: row.point_ids,
    status: row.status, saved_at: row.saved_at, updated_at: row.updated_at,
  };
}

function deleteRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const [id, userId] = values;
  const index = rows.findIndex((row) => row.id === id && row.user_id === userId);
  if (index < 0) return [];
  const deleted = rows.splice(index, 1)[0];
  return deleted ? [{ id: deleted.id }] : [];
}

function existsRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  return rows.some((item) => item.id === values[0]) ? [{ id: values[0] }] : [];
}

function selectUserId(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const row = rows.find((item) => item.id === values[0]);
  return row ? [{ user_id: row.user_id, saved_at: row.saved_at }] : [];
}

function insertRoute(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const row = insertRow(values);
  rows.push(row);
  return [rawReturningRow(row)];
}

function updateRoute(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const [id, userId] = values.slice(-2);
  const row = rows.find((item) => item.id === id && item.user_id === userId);
  if (!row) return [];
  updateRow(row, values);
  return [rawReturningRow(row)];
}

function routeRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const userId = values[0];
  return rows
    .filter((item) => item.user_id === userId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(rawRow);
}

/** Dispatch a Drizzle-rendered query to its in-memory handler. */
function executeText(
  sql: string, values: unknown[],
  rows: FakeSavedRouteRow[], idemRows: Map<string, FakeIdempotencyRow>,
): unknown[] {
  const text = sql.toLowerCase();
  if (text.includes("from \"saved_route_idempotency\"") || text.includes("into \"saved_route_idempotency\"") || text.startsWith("update \"saved_route_idempotency\"")) {
    return idempotencyRows(idemRows, text, values);
  }
  if (text.startsWith("insert into \"saved_routes\"")) return insertRoute(rows, values);
  if (text.startsWith("delete from \"saved_routes\"")) return deleteRows(rows, values);
  if (text.startsWith("update \"saved_routes\"")) return updateRoute(rows, values);
  if (text.includes("\"user_id\", \"saved_at\" from \"saved_routes\"")) return selectUserId(rows, values);
  if (text.includes("\"id\" from \"saved_routes\" where \"saved_routes\".\"id\"")) return existsRows(rows, values);
  return routeRows(rows, values);
}

/** A fake neon query function driving a real Drizzle `UsersDb` seam. */
function fakeNeonClient(rows: FakeSavedRouteRow[], idemRows: Map<string, FakeIdempotencyRow>) {
  return (sql: string, params: unknown[]): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: executeText(sql, params, rows, idemRows) });
}

/**
 * In-memory Drizzle `UsersDb` backing every saved-route query. Statements are
 * built with the real Drizzle query builder against `src/db/schema` and run
 * through the seam's `execute`, so the dialect renders them exactly as in
 * production and the fake dispatches on the rendered SQL + bound params.
 */
export function fakeDb(seed: FakeSavedRouteRow[] = []): { db: UsersDb; rows: FakeSavedRouteRow[] } {
  const rows = [...seed];
  const idem = new Map<string, FakeIdempotencyRow>();
  const db = drizzle({ client: fakeNeonClient(rows, idem) as never, schema });
  return { db, rows };
}

/** fakeDb plus in-memory idempotency ledger state, for idempotent-action tests. */
export function idemFakeDb(seed: FakeSavedRouteRow[] = []): {
  db: UsersDb; rows: FakeSavedRouteRow[]; idemRows: Map<string, FakeIdempotencyRow>;
} {
  const rows = [...seed];
  const idemRows = new Map<string, FakeIdempotencyRow>();
  const db = drizzle({ client: fakeNeonClient(rows, idemRows) as never, schema });
  return { db, rows, idemRows };
}

/**
 * A Drizzle `UsersDb` whose neon client delegates to `handler(sql, params)`
 * for the rows — lets tests script custom return shapes per rendered query
 * while still driving the real query-builder seam.
 */
export function fakeDbFrom(handler: (sql: string, params: unknown[]) => unknown[]): UsersDb {
  const client = (sql: string, params: unknown[]): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: handler(sql, params) });
  return drizzle({ client: client as never, schema });
}

/** A rendered query + its bound params, as seen by the fake client. */
export interface RecordedQuery { sql: string; params: unknown[] }

/**
 * A Drizzle `UsersDb` that records every rendered query (lowercased SQL +
 * bound params) while dispatching through the in-memory saved-route store.
 */
export function recordingDb(seed: FakeSavedRouteRow[] = []): {
  db: UsersDb; rows: FakeSavedRouteRow[]; queries: RecordedQuery[]; sqls: string[];
} {
  const rows = [...seed];
  const idem = new Map<string, FakeIdempotencyRow>();
  const queries: RecordedQuery[] = [];
  const sqls: string[] = [];
  const client = (sql: string, params: unknown[]): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: executeText(sql, params, rows, idem) });
  const db = drizzle({
    client: (async (sql: string, params: unknown[]) => {
      sqls.push(sql.toLowerCase());
      queries.push({ sql: sql.toLowerCase(), params });
      return client(sql, params);
    }) as never,
    schema,
  });
  return { db, rows, queries, sqls };
}
