import type { SavedRouteStatus } from "@animichi/contract";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../src/db/client";

/** Mutable row representation owned by the reusable fake executor. */
export interface FakeSavedRouteRow {
  id: string;
  claim_session_id: string | null;
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
const dialect = new PgDialect();

function rendered(query: SQL): { text: string; values: unknown[] } {
  const { sql: text, params: values } = dialect.sqlToQuery(query);
  return { text: text.toLowerCase(), values };
}

function routeStatus(value: unknown): SavedRouteStatus {
  return value === "draft" || value === "completed" ? value : "saved";
}

function insertRow(values: unknown[]): FakeSavedRouteRow {
  const status = routeStatus(values[3]);
  return {
    ...routeRowBase(values, status),
    saved_at: typeof values[4] === "string" ? values[4] : null,
    updated_at: NOW, first_query: "",
  };
}

function routeRowBase(values: unknown[], status: SavedRouteStatus): Omit<FakeSavedRouteRow, "saved_at" | "updated_at" | "first_query"> {
  return {
    id: NEW_ID,
    claim_session_id: null,
    user_id: typeof values[0] === "string" ? values[0] : null,
    title: typeof values[1] === "string" ? values[1] : "",
    point_ids: stringList(values[2]),
    status,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function updateRow(row: FakeSavedRouteRow, values: unknown[]): void {
  row.title = typeof values[0] === "string" ? values[0] : row.title;
  row.point_ids = Array.isArray(values[1])
    ? values[1].filter((v): v is string => typeof v === "string")
    : row.point_ids;
  row.status = routeStatus(values[2]);
  row.saved_at = typeof values[3] === "string" ? values[3] : null;
  row.updated_at = NOW;
}

function deleteRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const [id, userId] = values;
  const index = rows.findIndex((row) => row.id === id && row.user_id === userId);
  if (index < 0) return [];
  const deleted = rows.splice(index, 1)[0];
  return deleted ? [{ id: deleted.id }] : [];
}

function claimRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const [userId, sessionId] = values;
  if (typeof userId !== "string" || typeof sessionId !== "string") return [];
  const claimed = rows.filter((row) => row.claim_session_id === sessionId && row.user_id === null);
  for (const row of claimed) row.user_id = userId;
  return claimed.map((row) => ({ id: row.id }));
}

/** In-memory raw-SQL executor matching every saved-route query. */
export function fakeDb(seed: FakeSavedRouteRow[] = []): { db: DbExecutor; rows: FakeSavedRouteRow[] } {
  const rows = [...seed];
  const execute = (query: SQL): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: executeText(rendered(query), rows) });
  return { db: { execute }, rows };
}

/** Dispatch a rendered query to its matching in-memory handler. */
function executeText(query: { text: string; values: unknown[] }, rows: FakeSavedRouteRow[]): unknown[] {
  const { text, values } = query;
  if (text.includes("select 1 from saved_routes")) return existsRows(rows, values);
  if (text.includes("select user_id")) return selectUserId(rows, values);
  if (text.includes("insert into saved_routes")) return insertRoute(rows, values);
  if (text.includes("delete from saved_routes")) return deleteRows(rows, values);
  if (text.includes("set user_id")) return claimRows(rows, values);
  if (text.includes("from conversations")) return conversationPage(rows, values);
  if (text.includes("update saved_routes")) return updateRoute(rows, values);
  return routeRows(rows, values);
}

function existsRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  return rows.some((item) => item.id === values[0]) ? [{ exists: true }] : [];
}

function selectUserId(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const row = rows.find((item) => item.id === values[0]);
  return row ? [{ user_id: row.user_id, saved_at: row.saved_at }] : [];
}

function insertRoute(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const row = insertRow(values);
  rows.push(row);
  return [row];
}

function updateRoute(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const [id, userId] = values.slice(-2);
  const row = rows.find((item) => item.id === id && item.user_id === userId);
  if (!row) return [];
  updateRow(row, values);
  return [row];
}

function routeRows(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const userId = values[0];
  const matches = rows.filter((item) => item.user_id === userId);
  matches.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return matches;
}

function conversationPage(rows: FakeSavedRouteRow[], values: unknown[]): unknown[] {
  const userId = values[0];
  const matches = rows.filter((item) => item.user_id === userId);
  matches.sort((a, b) => b.updated_at.localeCompare(a.updated_at) ||
    (b.id.localeCompare(a.id)));
  const limit = Number(values[1]);
  const offset = Number(values[2]);
  return matches.slice(offset, offset + limit).map(conversationRow);
}

function conversationRow(item: FakeSavedRouteRow) {
  return {
    session_id: item.id,
    title: item.title,
    first_query: item.first_query ?? "",
    created_at: item.updated_at,
    updated_at: item.updated_at,
  };
}
