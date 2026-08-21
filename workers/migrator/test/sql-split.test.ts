import { describe, expect, it } from "vitest";
import catalogDaily from "../../../migrations/neon/20260812000000_catalog_daily_run.sql";
import functionsSql from "../../../migrations/neon/20260809000002_functions.sql";
import messagesSql from "../../../migrations/neon/20260811000002_table_messages.sql";
import outboxSql from "../../../migrations/neon/20260814191301_turn_idempotency_outbox.sql";
import rolesSql from "../../../migrations/neon/20260809000001_roles.sql";
import { needsTxNone, splitSql } from "../src/sql-split";

const FN = "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\nEND;\n$$;";
const TAGGED = "DO $body$\nBEGIN\n  PERFORM 1;\nEND;\n$body$;";
const CONCUR = "CREATE INDEX CONCURRENTLY idx ON t (id);";
const UNIQUE_CONCUR = "CREATE UNIQUE INDEX CONCURRENTLY idx ON t (id);";
const FN_CONCUR = "CREATE FUNCTION f() RETURNS void AS $$ BEGIN CREATE INDEX CONCURRENTLY idx ON t (id); END; $$;";

describe("splitSql", () => {
  it("splits two statements on a code semicolon", () => {
    expect(splitSql("CREATE TABLE t1 (id int); CREATE TABLE t2 (id int);")).toEqual([
      "CREATE TABLE t1 (id int);",
      "CREATE TABLE t2 (id int);",
    ]);
  });

  it("keeps a semicolon inside a single-quoted string", () => {
    expect(splitSql("INSERT INTO t VALUES ('a;b');")).toEqual(["INSERT INTO t VALUES ('a;b');"]);
  });

  it("keeps a semicolon inside doubled single quotes", () => {
    expect(splitSql("INSERT INTO t VALUES ('it''s; x');")).toEqual(["INSERT INTO t VALUES ('it''s; x');"]);
  });

  it("keeps a semicolon inside a double-quoted identifier", () => {
    expect(splitSql('ALTER TABLE "weird;name" ADD COLUMN id int;')).toEqual([
      'ALTER TABLE "weird;name" ADD COLUMN id int;',
    ]);
  });

  it("keeps a semicolon inside a line comment", () => {
    expect(splitSql("-- note; still comment\nCREATE TABLE t (id int);")).toEqual([
      "-- note; still comment\nCREATE TABLE t (id int);",
    ]);
  });

  it("keeps a semicolon inside a block comment", () => {
    expect(splitSql("/* ; */ CREATE TABLE t (id int);")).toEqual(["/* ; */ CREATE TABLE t (id int);"]);
  });

  it("keeps plpgsql semicolons inside dollar quotes", () => {
    expect(splitSql(FN)).toEqual([FN]);
  });

  it("keeps tagged dollar quotes as one statement", () => {
    expect(splitSql(TAGGED)).toEqual([TAGGED]);
  });

  it("skips comment-only tails", () => {
    expect(splitSql("CREATE TABLE t (id int);\n-- trailing")).toEqual(["CREATE TABLE t (id int);"]);
  });

  it("returns no statements for empty input", () => {
    expect(splitSql("")).toEqual([]);
    expect(splitSql("   \n")).toEqual([]);
  });
});

describe("splitSql on committed Atlas files", () => {
  it("keeps functions.sql as two CREATE FUNCTION units", () => {
    const stmts = splitSql(functionsSql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("sync_points_coordinates");
    expect(stmts[0]).toContain("ST_MakePoint");
    expect(stmts[1]).toContain("update_updated_at");
  });

  it("keeps roles.sql DO $$ block as one statement", () => {
    expect(splitSql(rolesSql)).toHaveLength(1);
  });

  it("splits pending multi-statement files into one query per command", () => {
    expect(splitSql(messagesSql)).toHaveLength(5);
    expect(splitSql(catalogDaily)).toHaveLength(10);
    expect(splitSql(outboxSql)).toHaveLength(8);
  });
});

describe("needsTxNone", () => {
  it("detects CREATE INDEX CONCURRENTLY in code", () => {
    expect(needsTxNone(CONCUR)).toBe(true);
    expect(needsTxNone(UNIQUE_CONCUR)).toBe(true);
  });

  it("ignores CONCURRENTLY inside dollar-quoted bodies", () => {
    expect(needsTxNone(FN_CONCUR)).toBe(false);
  });
});
