import type { RouteStatus } from "@seichijunrei/contract";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import type { DbExecutor } from "../src/db/client";
import type { Env } from "../src/index";

/** Test Neon Auth issuer/audience. */
export const BASE = "https://auth.test.invalid/neondb/auth";
/** Test Neon Auth JWKS endpoint. */
export const JWKS_URL = `${BASE}/.well-known/jwks.json`;
/** Complete configured Worker environment for tests. */
export const TEST_ENV: Env = {
  ENVIRONMENT: "test",
  NEON_AUTH_JWKS_URL: JWKS_URL,
  DATABASE_URL: "postgresql://fake",
};

interface JwtOptions { sub: string; iss?: string; aud?: string; exp?: number }
/** Shared JWT tools initialized once per worker isolate. */
export interface AuthTools {
  getKey: JWTVerifyGetKey;
  makeJwt: (options: JwtOptions) => Promise<string>;
}

let authToolsPromise: Promise<AuthTools> | undefined;

async function createAuthTools(): Promise<AuthTools> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const makeJwt = (options: JwtOptions): Promise<string> => new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setSubject(options.sub)
    .setIssuer(options.iss ?? BASE)
    .setAudience(options.aud ?? BASE)
    .setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 900)
    .sign(privateKey);
  return { getKey, makeJwt };
}

/** Return the isolate's one-time Ed25519 test fixture. */
export function authTools(): Promise<AuthTools> {
  authToolsPromise ??= createAuthTools();
  return authToolsPromise;
}

/** Mutable row representation owned by the reusable fake executor. */
export interface FakeRouteRow {
  id: string;
  session_id: string | null;
  user_id: string | null;
  title: string | null;
  point_ids: string[];
  status: RouteStatus;
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

function routeStatus(value: unknown): RouteStatus {
  return value === "draft" || value === "completed" ? value : "saved";
}

function insertRow(values: unknown[]): FakeRouteRow {
  const status = routeStatus(values[3]);
  return {
    id: NEW_ID,
    session_id: null,
    user_id: typeof values[0] === "string" ? values[0] : null,
    title: typeof values[1] === "string" ? values[1] : "",
    point_ids: Array.isArray(values[2]) ? values[2].filter((v): v is string => typeof v === "string") : [],
    status,
    saved_at: status === "draft" ? null : NOW,
    updated_at: NOW,
    first_query: "",
  };
}

function updateRow(row: FakeRouteRow, values: unknown[]): void {
  row.title = typeof values[0] === "string" ? values[0] : row.title;
  row.point_ids = Array.isArray(values[1])
    ? values[1].filter((v): v is string => typeof v === "string")
    : row.point_ids;
  row.status = routeStatus(values[2]);
  row.saved_at = row.status === "draft" ? null : row.saved_at ?? NOW;
  row.updated_at = NOW;
}

function deleteRows(rows: FakeRouteRow[], values: unknown[]): unknown[] {
  const [id, userId] = values;
  const index = rows.findIndex((row) => row.id === id && row.user_id === userId);
  if (index < 0) return [];
  const deleted = rows.splice(index, 1)[0];
  return deleted ? [{ id: deleted.id }] : [];
}

function claimRows(rows: FakeRouteRow[], values: unknown[]): unknown[] {
  const [userId, sessionId] = values;
  if (typeof userId !== "string" || typeof sessionId !== "string") return [];
  const claimed = rows.filter((row) => row.session_id === sessionId && row.user_id === null);
  for (const row of claimed) row.user_id = userId;
  return claimed.map((row) => ({ id: row.id }));
}

/** In-memory raw-SQL executor matching every user-route query. */
export function fakeDb(seed: FakeRouteRow[] = []): { db: DbExecutor; rows: FakeRouteRow[] } {
  const rows = [...seed];
  const execute = (query: SQL): Promise<{ rows: unknown[] }> => {
    const { text, values } = rendered(query);
    if (text.includes("select user_id")) {
      const row = rows.find((item) => item.id === values[0]);
      return Promise.resolve({ rows: row ? [{ user_id: row.user_id }] : [] });
    }
    if (text.includes("insert into routes")) {
      const row = insertRow(values);
      rows.push(row);
      return Promise.resolve({ rows: [row] });
    }
    if (text.includes("delete from routes")) {
      return Promise.resolve({ rows: deleteRows(rows, values) });
    }
    if (text.includes("set user_id")) {
      return Promise.resolve({ rows: claimRows(rows, values) });
    }
    if (text.includes("from conversations")) {
      const userId = values[0];
      const matches = rows.filter((item) => item.user_id === userId);
      matches.sort((a, b) => b.updated_at.localeCompare(a.updated_at) ||
        (b.id.localeCompare(a.id)));
      const limit = Number(values[1]);
      const offset = Number(values[2]);
      const page = matches.slice(offset, offset + limit).map((item) => ({
        session_id: item.id,
        title: item.title,
        first_query: item.first_query ?? "",
        created_at: item.updated_at,
        updated_at: item.updated_at,
      }));
      return Promise.resolve({ rows: page });
    }
    if (text.includes("update routes")) {
      const [id, userId] = values.slice(-2);
      const row = rows.find((item) => item.id === id && item.user_id === userId);
      if (!row) return Promise.resolve({ rows: [] });
      updateRow(row, values);
      return Promise.resolve({ rows: [row] });
    }
    const userId = values[0];
    const matches = rows.filter((item) => item.user_id === userId);
    matches.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return Promise.resolve({ rows: matches });
  };
  return { db: { execute }, rows };
}
