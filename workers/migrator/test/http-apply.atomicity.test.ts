import { describe, expect, it } from "vitest";
import { REVISION_UPSERT_SQL } from "../src/http-apply";
import { FakeSql } from "./fake-sql";
import {
  BODY_A,
  BODY_B,
  CHAIN_HASH,
  CONCURRENT_BODY,
  CONCURRENT_VERSION,
  applyFixture,
  concurrentChain,
} from "./http-apply.helpers";

// #1338 (ucm-H1) — the DDL and the ledger row used to be two commits. An
// eviction, a CPU-limit kill or a neon-http failure between them left the file
// applied and the ledger silent; the next run re-selected the same file, hit
// `42P07` on a CREATE TABLE with no IF NOT EXISTS, wrote applied=0, and wedged
// the chain until someone hand-edited atlas_schema_revisions.

describe("a file and its ledger row commit together (#1338)", () => {
  it("carries the revision upsert inside the file's own transaction", async () => {
    const db = new FakeSql();

    await applyFixture(db);

    expect(db.transactions).toEqual([
      [BODY_A, REVISION_UPSERT_SQL],
      [BODY_B, REVISION_UPSERT_SQL],
    ]);
  });

  it("commits neither the DDL nor the ledger row when the ledger write fails", async () => {
    const db = new FakeSql();
    db.failLedgerWrite = true;

    await expect(applyFixture(db)).rejects.toThrow("ledger write failed");

    expect(db.units).toEqual([BODY_A]);
    expect(db.committed).toEqual([]);
    expect(db.revisions).toEqual([]);
  });

  it("keeps a duplicate-object error fatal on the transactional path", async () => {
    const db = new FakeSql();
    db.duplicateBody = BODY_A;

    const outcome = await applyFixture(db);

    expect(outcome).toMatchObject({ kind: "failure", exitCode: 1 });
    expect(db.committed).toEqual([]);
  });
});

// CREATE INDEX CONCURRENTLY cannot run inside a transaction, so on that path the
// window is inherent: each statement commits alone and the revision row follows.
// A re-run therefore meets the objects the dead run created, and a duplicate is
// what "already applied" looks like from here.

describe("the inherent window on the CONCURRENTLY path (#1338)", () => {
  it("records a file whose objects already exist as applied instead of wedging", async () => {
    const db = new FakeSql();
    db.duplicateBody = CONCURRENT_BODY;

    const outcome = await applyFixture(db, { source: concurrentChain });

    expect(outcome).toEqual({ kind: "success", exitCode: 0 });
    expect(db.revisions).toMatchObject([{ version: CONCURRENT_VERSION, applied: 1, error: null }]);
  });

  it("resumes a version whose unfinished attempt recorded the same hash", async () => {
    const db = new FakeSql();
    db.duplicateBody = CONCURRENT_BODY;
    db.attemptFailed(CONCURRENT_VERSION, CHAIN_HASH);

    const outcome = await applyFixture(db, { source: concurrentChain });

    expect(outcome).toEqual({ kind: "success", exitCode: 0 });
    expect(db.revisions.at(-1)).toMatchObject({ version: CONCURRENT_VERSION, applied: 1, error: null });
  });

  it("refuses to resume a version whose unfinished attempt recorded another hash", async () => {
    const db = new FakeSql();
    db.duplicateBody = CONCURRENT_BODY;
    db.attemptFailed(CONCURRENT_VERSION, "h1:a-different-file-under-the-same-version=");

    const outcome = await applyFixture(db, { source: concurrentChain });

    expect(outcome).toMatchObject({ kind: "failure", exitCode: 1 });
    expect(db.revisions.at(-1)).toMatchObject({ version: CONCURRENT_VERSION, applied: 0 });
  });

  it("still records a non-duplicate failure on that path", async () => {
    const db = new FakeSql();
    db.failBody = CONCURRENT_BODY;

    const outcome = await applyFixture(db, { source: concurrentChain });

    expect(outcome).toEqual({ kind: "failure", exitCode: 1, error: "sql failed" });
    expect(db.revisions).toMatchObject([{ version: CONCURRENT_VERSION, applied: 0, error: "sql failed" }]);
  });
});
