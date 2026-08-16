import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  CATALOG_TABLES,
  captureNeonConfig,
  catalogTruncateSql,
  directPoolConfig,
  restoreNeonConfig,
} from "./spike-db";
import { makePgCatalog } from "./spike-db-global/pg-catalog";

describe("spike database helper", () => {
  it("builds the exact no-CASCADE FK-closed TRUNCATE statement", () => {
    const statement = catalogTruncateSql();

    expect(CATALOG_TABLES).toHaveLength(15);
    expect(statement).toContain('"saved_route_anime"');
    expect(statement).not.toMatch(/CASCADE/u);
    expect(statement).not.toMatch(/locations|location_aliases|atlas_schema_revisions/u);
    expect(statement).toMatch(/RESTART IDENTITY$/u);
  });

  it("snapshots and restores all three process-global neonConfig values", () => {
    const snapshot = captureNeonConfig();
    const fetchEndpoint = snapshot.fetchEndpoint;
    const previous = snapshot.poolQueryViaFetch;

    restoreNeonConfig(snapshot);
    expect(captureNeonConfig().fetchEndpoint).toEqual(fetchEndpoint);
    expect(captureNeonConfig().poolQueryViaFetch).toEqual(previous);
  });

  it("leaves docker-postgres TLS behavior to the connection URI", () => {
    const config = directPoolConfig("postgresql://127.0.0.1:5432/catalog_spike?sslmode=disable");

    expect(config.connectionTimeoutMillis).toBe(10_000);
    expect(config).not.toHaveProperty("ssl");
  });

  it("fails loudly, not silently skips, when the database is unreachable (AC2)", async () => {
    const deadPool = new pg.Pool({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 500 });
    const db = makePgCatalog(deadPool);

    await expect(db.execute(sql`SELECT 1`)).rejects.toThrow();
    await deadPool.end();
  });
});
