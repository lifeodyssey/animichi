import { describe, expect, it } from "vitest";
import { NeonMigrationsLedger } from "../src/ledger";
import { OPERATOR_VERSION } from "../src/http-apply";
import {
  BODY_A,
  BODY_B,
  DSN,
  FakeSql,
  HASH_A,
  HASH_B,
  HEAD_B,
  applyFixture,
} from "./http-apply.helpers";

// #1124 AC1 / AC2 — fixture chain vs fake neon(): one apply unit per file,
// atlas.sum order, skip already-applied, ledger hash+version reconstitutes head.

describe("HTTP apply units (AC1)", () => {
  it("executes one unit per file in atlas.sum order", async () => {
    const db = new FakeSql();
    await applyFixture(db);
    expect(db.units).toEqual([BODY_A, BODY_B]);
  });

  it("skips versions already in atlas_schema_revisions", async () => {
    const db = new FakeSql();
    db.alreadyApplied("20260811000001");
    await applyFixture(db);
    expect(db.units).toEqual([BODY_B]);
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
    expect(outcome).toEqual({ kind: "failure", exitCode: 1 });
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
