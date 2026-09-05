import { describe, expect, it } from "vitest";
import { NeonMigrationsLedger } from "../src/ledger";
import { productionChain } from "../src/bundled-chain";
import { filesFrom } from "../src/chain";
import { OPERATOR_VERSION, REVISION_UPSERT_SQL } from "../src/http-apply";
import { FakeSql } from "./fake-sql";
import {
  BODY_A,
  BODY_B,
  CONCURRENT_BODY,
  DSN,
  HASH_A,
  HASH_B,
  HEAD_B,
  STMT_1,
  STMT_2,
  TWO_BODY,
  applyFixture,
  chainOf,
  concurrentChain,
  twoStmtChain,
} from "./http-apply.helpers";

// #1124 AC1 / AC2 — fixture chain vs fake neon(): one apply unit per file,
// atlas.sum order, skip already-applied, ledger hash+version reconstitutes head.

describe("HTTP apply units (AC1)", () => {
  it("executes one unit per file in atlas.sum order", async () => {
    const db = new FakeSql();
    await applyFixture(db);
    expect(db.units).toEqual([BODY_A, BODY_B]);
    expect(db.transactions).toEqual([[BODY_A, REVISION_UPSERT_SQL], [BODY_B, REVISION_UPSERT_SQL]]);
  });

  it("skips versions already in atlas_schema_revisions", async () => {
    const db = new FakeSql();
    db.alreadyApplied("20260811000001");
    await applyFixture(db);
    expect(db.units).toEqual([BODY_B]);
    expect(db.transactions).toEqual([[BODY_B, REVISION_UPSERT_SQL]]);
  });
});

describe("HTTP apply ledger (AC2)", () => {
  it("inserts atlas.sum h1 hash and version so readAppliedHead returns the basename", async () => {
    const db = new FakeSql();
    await applyFixture(db);
    expect(db.revisions).toEqual([
      {
        version: "20260811000001",
        description: "turn_outcome",
        applied: 1,
        executedAt: "2026-08-21T00:00:00.000Z",
        executionTime: 0,
        error: null,
        errorStmt: null,
        hash: HASH_A,
        operatorVersion: OPERATOR_VERSION,
      },
      {
        version: "20260814191301",
        description: "turn_idempotency_outbox",
        applied: 1,
        executedAt: "2026-08-21T00:00:00.000Z",
        executionTime: 0,
        error: null,
        errorStmt: null,
        hash: HASH_B,
        operatorVersion: OPERATOR_VERSION,
      },
    ]);
    const last = db.revisions[1];
    const ledger = new NeonMigrationsLedger(() =>
      Promise.resolve({ version: last?.version, description: last?.description }),
    );
    expect(await ledger.readAppliedHead(DSN)).toBe(HEAD_B);
  });
});

describe("HTTP apply SQL failure", () => {
  it("writes error and error_stmt, stops, and does not mark the file applied", async () => {
    const db = new FakeSql();
    db.failBody = BODY_B;
    const outcome = await applyFixture(db);
    expect(outcome).toEqual({ kind: "failure", exitCode: 1, error: "sql failed" });
    expect(db.units).toEqual([BODY_A, BODY_B]);
    expect(db.revisions[0]).toMatchObject({ version: "20260811000001", applied: 1 });
    expect(db.revisions[1]).toMatchObject({
      version: "20260814191301",
      applied: 0,
      error: "sql failed",
      errorStmt: BODY_B,
      hash: HASH_B,
    });
  });
});

describe("HTTP apply multi-statement (req 7)", () => {
  it("records a transaction of two queries, not one query of the whole body", async () => {
    const db = new FakeSql();
    await applyFixture(db, { source: twoStmtChain });
    expect(db.transactions).toEqual([[STMT_1, STMT_2, REVISION_UPSERT_SQL]]);
    expect(db.units).toEqual([STMT_1, STMT_2]);
    expect(db.statements).not.toContain(TWO_BODY);
  });

  it("writes error/error_stmt on a failed two-statement file and does not mark applied", async () => {
    const db = new FakeSql();
    db.failBody = STMT_2;
    const outcome = await applyFixture(db, { source: twoStmtChain });
    expect(outcome).toEqual({ kind: "failure", exitCode: 1, error: "sql failed" });
    expect(db.revisions).toHaveLength(1);
    expect(db.revisions[0]).toMatchObject({
      version: "20260821000000",
      applied: 0,
      error: "sql failed",
      errorStmt: TWO_BODY,
    });
  });

  it("applies CREATE INDEX CONCURRENTLY outside a transaction", async () => {
    const db = new FakeSql();
    await applyFixture(db, { source: concurrentChain });
    expect(db.transactions).toEqual([]);
    expect(db.units).toEqual([CONCURRENT_BODY]);
  });

  it("rejects a mixed transactional+CONCURRENTLY file before SQL", async () => {
    const db = new FakeSql();
    const body = `${STMT_1} ${CONCURRENT_BODY}`;
    const outcome = await applyFixture(db, { source: chainOf("20260821000002_mixed.sql", body) });
    expect(outcome).toEqual({
      kind: "failure",
      exitCode: 1,
      error: "migration mixes transactional statements with CREATE INDEX CONCURRENTLY",
    });
    expect(db.transactions).toEqual([]);
    expect(db.units).toEqual([]);
    expect(db.revisions[0]).toMatchObject({
      version: "20260821000002",
      applied: 0,
      error: "migration mixes transactional statements with CREATE INDEX CONCURRENTLY",
    });
  });
});

describe("bundled chain vs atlas.sum", () => {
  it("resolves every atlas.sum SQL file with a non-empty body", () => {
    const files = filesFrom(productionChain);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.body.length).toBeGreaterThan(0);
      expect(file.hash.startsWith("h1:")).toBe(true);
    }
  });
});

// #1216 — a reset `public` schema carries no ledger. This path reads the ledger
// before it writes one, so the reset turned the first read into
// `relation "public.atlas_schema_revisions" does not exist` and staging applied
// nothing behind an HTTP 500 that named no cause.
describe("ledger bootstrap on a reset schema", () => {
  it("applies the whole chain when no ledger exists yet", async () => {
    const db = new FakeSql();
    expect(db.ledgerExists).toBe(false);

    const outcome = await applyFixture(db);

    expect(outcome).toEqual({ kind: "success", exitCode: 0 });
    expect(db.units).toEqual([BODY_A, BODY_B]);
  });

  it("creates the ledger before reading it", async () => {
    const db = new FakeSql();
    await applyFixture(db);

    const created = db.statements.findIndex((s) => s.includes("CREATE TABLE IF NOT EXISTS public.atlas_schema_revisions"));
    const read = db.statements.findIndex((s) => s.includes("SELECT version FROM public.atlas_schema_revisions"));

    expect(created).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(read);
  });
});
