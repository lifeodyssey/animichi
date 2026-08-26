import { describe, expect, it } from "vitest";
import rolesSql from "../../../migrations/neon/20260826000001_roles.sql";
import functionsSql from "../../../migrations/neon/20260826000002_functions.sql";
import catalogSql from "../../../migrations/neon/20260826000003_catalog.sql";
import agentSql from "../../../migrations/neon/20260826000004_agent.sql";
import { mixedTxMode, needsTxNone, splitSql } from "../src/sql-split";

const baselineSql = [rolesSql, functionsSql, catalogSql, agentSql].join("\n");

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
  it("splits the canonical baseline into executable units", () => {
    const stmts = splitSql(baselineSql);
    expect(stmts.filter((stmt) => stmt.includes("CREATE FUNCTION public."))).toHaveLength(2);
    expect(stmts.some((stmt) => stmt.includes("CREATE ROLE %I NOLOGIN"))).toBe(true);
    expect(stmts.some((stmt) => stmt.includes("CREATE TABLE public.messages"))).toBe(true);
    expect(stmts.some((stmt) => stmt.includes("CREATE TABLE public.turn_reservations"))).toBe(true);
    expect(mixedTxMode(stmts)).toBe(false);
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

describe("mixedTxMode", () => {
  it("is false when every statement is transactional", () => {
    expect(mixedTxMode(["CREATE TABLE t (id int);", "CREATE TABLE u (id int);"])).toBe(false);
  });

  it("is false when every statement is CONCURRENTLY", () => {
    expect(mixedTxMode([CONCUR, UNIQUE_CONCUR])).toBe(false);
  });

  it("is true when transactional DDL and CONCURRENTLY share a file", () => {
    expect(mixedTxMode(["CREATE TABLE t (id int);", CONCUR])).toBe(true);
  });
});
