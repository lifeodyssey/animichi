import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  CATALOG_TABLES,
  catalogTruncateSql,
  directPoolConfig,
  truncateCatalogPool,
} from "./integration-db";

/**
 * The suite harness's own guarantees (#1633 rewrote the half that was about the
 * Drizzle seam; what is left is the statement, the pool config, and the one
 * isolation call every database file makes).
 *
 * `truncateCatalogPool` is the isolation step, and the thing it must never do is
 * fail QUIETLY or fail with a message that blames the table set: an operator
 * reading "FK-closed table set" would go looking for an ordering bug that is not
 * there, when what actually happened was a connection or a real FK violation.
 * Both arms below pin that.
 */

describe("the catalog isolation statement", () => {
  it("builds the exact no-CASCADE FK-closed TRUNCATE statement", () => {
    const statement = catalogTruncateSql();

    expect(CATALOG_TABLES).toHaveLength(15);
    expect(statement).toContain('"saved_route_anime"');
    expect(statement).not.toMatch(/CASCADE/u);
    expect(statement).not.toMatch(/locations|location_aliases|prisma_contract/u);
    expect(statement).toMatch(/RESTART IDENTITY$/u);
  });

  it("leaves docker-postgres TLS behavior to the connection URI", () => {
    const config = directPoolConfig("postgresql://127.0.0.1:5432/catalog_integration?sslmode=disable");

    expect(config.connectionTimeoutMillis).toBe(10_000);
    expect(config).not.toHaveProperty("ssl");
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

describe("truncateCatalogPool fails loudly, and never blames the table set", () => {
  it("rejects rather than silently skipping when the database is unreachable (AC2)", async () => {
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

  it("hands an FK-ordering failure to the operator with its actionable cause", async () => {
    const fkError = new pg.DatabaseError("violates foreign key constraint \"fk_points_bangumi\"", 0, "error");
    fkError.code = "23503";
    const failingPool = { query: () => Promise.reject(fkError) } as unknown as pg.Pool;

    const error = await rejectionOf(truncateCatalogPool(failingPool));

    const cause = expectDatabaseErrorCause(error);
    expect(error.message).toContain("TRUNCATE failed during catalog integration isolation");
    expect(cause.message).toContain("fk_points_bangumi");
    expect(cause.code).toBe("23503");
  });
});
