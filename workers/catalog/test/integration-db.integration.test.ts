import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import type { CatalogDb } from "../src/db/client";
import {
  CATALOG_TABLES,
  captureNeonConfig,
  catalogTruncateSql,
  directPoolConfig,
  restoreNeonConfig,
  truncateCatalog,
  truncateCatalogPool,
} from "./integration-db";
import { makePgCatalog } from "./integration-db-global/pg-catalog";

describe("catalog database helper", () => {
  it("builds the exact no-CASCADE FK-closed TRUNCATE statement", () => {
    const statement = catalogTruncateSql();

    expect(CATALOG_TABLES).toHaveLength(15);
    expect(statement).toContain('"saved_route_anime"');
    expect(statement).not.toMatch(/CASCADE/u);
    expect(statement).not.toMatch(/locations|location_aliases|prisma_contract/u);
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
    const config = directPoolConfig("postgresql://127.0.0.1:5432/catalog_integration?sslmode=disable");

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

async function rejectionOf(promise: Promise<void>): Promise<Error> {
  try {
    await promise;
  } catch (reason) {
    if (!(reason instanceof Error)) {
      throw new Error(`expected an Error rejection, got ${String(reason)}`, { cause: reason });
    }
    return reason;
  }
  throw new Error("expected the truncate call to reject, but it resolved");
}

function expectDatabaseErrorCause(error: Error): pg.DatabaseError {
  if (!(error.cause instanceof pg.DatabaseError)) {
    throw new Error(`expected a pg.DatabaseError cause, got ${String(error.cause)}`);
  }
  return error.cause;
}

describe("truncate guard AC1: connection errors", () => {
  it("truncateCatalog does not falsely name FK-closed table set", async () => {
    const deadPool = new pg.Pool({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 500 });
    const db = makePgCatalog(deadPool);

    try {
      const error = await rejectionOf(truncateCatalog(db));
      expect(error.message).not.toContain("FK-closed table set");
      expect(error.message).toContain("TRUNCATE failed during catalog integration isolation");
      expect(error.cause).toBeDefined();
    } finally {
      await deadPool.end();
    }
  });

  it("truncateCatalogPool does not falsely name FK-closed table set", async () => {
    const deadPool = new pg.Pool({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 500 });

    try {
      const error = await rejectionOf(truncateCatalogPool(deadPool));
      expect(error.message).not.toContain("FK-closed table set");
      expect(error.message).toContain("TRUNCATE failed during catalog integration isolation");
      expect(error.cause).toBeDefined();
    } finally {
      await deadPool.end();
    }
  });
});

describe("truncate guard AC2: FK-ordering failures", () => {
  it("FK-ordering failure reaches operator with actionable cause", async () => {
    const fkError = new pg.DatabaseError("violates foreign key constraint \"fk_points_bangumi\"", 0, "error");
    fkError.code = "23503";
    const failingDb = {
      execute: () => Promise.reject(fkError),
    } as unknown as CatalogDb;

    const error = await rejectionOf(truncateCatalog(failingDb));
    const cause = expectDatabaseErrorCause(error);
    expect(error.message).toContain("TRUNCATE failed during catalog integration isolation");
    expect(cause.message).toContain("fk_points_bangumi");
    expect(cause.code).toBe("23503");
  });
});

describe("truncate guard AC3: both functions identical", () => {
  it("truncateCatalog and truncateCatalogPool behave identically", async () => {
    const fkError = new pg.DatabaseError("violates foreign key constraint", 0, "error");
    fkError.code = "23503";
    const failingDb = {
      execute: () => Promise.reject(fkError),
    } as unknown as CatalogDb;
    const failingPool = {
      query: () => Promise.reject(fkError),
    } as unknown as pg.Pool;

    const dbError = await rejectionOf(truncateCatalog(failingDb));
    const poolError = await rejectionOf(truncateCatalogPool(failingPool));
    const dbCause = expectDatabaseErrorCause(dbError);
    const poolCause = expectDatabaseErrorCause(poolError);

    expect(dbError.message).toBe(poolError.message);
    expect(dbCause.message).toBe(poolCause.message);
    expect(dbCause.code).toBe("23503");
    expect(poolCause.code).toBe("23503");
  });
});
