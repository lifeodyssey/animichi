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

const NOW = "2026-07-13T04:00:00.000Z";
const NEW_ID = "00000000-0000-4000-8000-000000000001";

function routeStatus(value: unknown): SavedRouteStatus {
  return value === "draft" || value === "completed" ? value : "saved";
}

/** Parse a Postgres array literal bound by Drizzle (e.g. `"{p1}"` or `"{}`). */
function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value !== "string") return [];
  const inner = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  return inner.length === 0 ? [] : inner.split(",").map((part) => part.replace(/^"(.*)"$/, "$1"));
}

/** Build an in-memory row from the builder's INSERT values
 * (point_ids, userId, title, status, savedAtISO — schema order). */
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

/** Mutate a stored row from the builder's UPDATE set values
 * (point_ids, title, status, savedAtISO — schema column order). */
function updateRow(row: FakeSavedRouteRow, values: unknown[]): void {
  row.title = typeof values[1] === "string" ? values[1] : row.title;
  row.point_ids = parsePgArray(values[0]);
  row.status = routeStatus(values[2]);
  row.saved_at = typeof values[3] === "string" ? values[3] : null;
  row.updated_at = NOW;
}

/** Raw row shape a driver returns for the saved-route reads (JS array/ISO strings). */
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
function executeText(sql: string, values: unknown[], rows: FakeSavedRouteRow[]): unknown[] {
  const text = sql.toLowerCase();
  if (text.startsWith("insert into \"saved_routes\"")) return insertRoute(rows, values);
  if (text.startsWith("delete from \"saved_routes\"")) return deleteRows(rows, values);
  if (text.startsWith("update \"saved_routes\"")) return updateRoute(rows, values);
  if (text.includes("\"user_id\", \"saved_at\" from \"saved_routes\"")) return selectUserId(rows, values);
  if (text.includes("\"id\" from \"saved_routes\" where \"saved_routes\".\"id\"")) return existsRows(rows, values);
  return routeRows(rows, values);
}

/** A fake neon query function driving a real Drizzle `UsersDb` seam. */
function fakeNeonClient(rows: FakeSavedRouteRow[]) {
  return (sql: string, params: unknown[]): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: executeText(sql, params, rows) });
}

/**
 * In-memory Drizzle `UsersDb` backing every saved-route query. Statements are
 * built with the real Drizzle query builder against `src/db/schema` and run
 * through the seam's `execute`, so the dialect renders them exactly as in
 * production and the fake dispatches on the rendered SQL + bound params.
 */
export function fakeDb(seed: FakeSavedRouteRow[] = []): { db: UsersDb; rows: FakeSavedRouteRow[] } {
  const rows = [...seed];
  const db = drizzle({ client: fakeNeonClient(rows) as never, schema });
  return { db, rows };
}

/**
 * A Drizzle `UsersDb` whose neon client delegates to `handler(sql, params)`
 * for the rows — lets tests script custom return shapes per rendered query
 * while still driving the real query-builder seam (so dialect rendering and
 * binding stay production-exact).
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
  const queries: RecordedQuery[] = [];
  const sqls: string[] = [];
  const client = (sql: string, params: unknown[]): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: executeText(sql, params, rows) });
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
