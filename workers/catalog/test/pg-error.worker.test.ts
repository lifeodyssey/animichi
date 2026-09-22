import { describe, expect, it } from "vitest";
import { isUniqueViolation, sqlStateOf } from "../src/lib/pg-error";

/**
 * SQLSTATE classification for the guarded claims (#1630).
 *
 * The shape is not what a caller would guess, which is why it has a test at all:
 * the Prisma runtime raises a failure whose `sqlState` carries the SQLSTATE, and
 * the untouched `pg` error — which carries `code`, NOT `sqlState` — hangs off its
 * `cause`. Classifying on `code` finds nothing; classifying on `sqlState` finds
 * both shapes. The `23505` reading is what decides a lost singleflight claim, so
 * a classifier that silently answers false would turn "another caller won" into
 * "this caller won" and open a second concurrent ingest.
 */

/** A runtime failure carrying the SQLSTATE directly. */
function runtimeFailure(sqlState: string): Error & { sqlState: string } {
  return Object.assign(new Error("driver failure"), { sqlState });
}

/** A runtime failure that wraps the raw driver error, `code` and all. */
function wrappedDriverError(inner: unknown): Error {
  return new Error("runtime failure", { cause: inner });
}

describe("sqlStateOf", () => {
  it("reads the SQLSTATE the runtime attached to the failure itself", () => {
    expect(sqlStateOf(runtimeFailure("23505"))).toBe("23505");
  });

  it("falls through to the driver error the runtime wrapped", () => {
    expect(sqlStateOf(wrappedDriverError(runtimeFailure("23505")))).toBe("23505");
  });

  it("answers nothing for a failure with no SQLSTATE anywhere", () => {
    expect(sqlStateOf(new Error("connection reset"))).toBeUndefined();
    expect(sqlStateOf(wrappedDriverError(new Error("driver said no")))).toBeUndefined();
  });

  it("answers nothing for a non-object failure or a non-string state", () => {
    expect(sqlStateOf("23505")).toBeUndefined();
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf(undefined)).toBeUndefined();
    expect(sqlStateOf({ sqlState: 23505 })).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  it("recognises a unique-key clash, direct or wrapped", () => {
    expect(isUniqueViolation(runtimeFailure("23505"))).toBe(true);
    expect(isUniqueViolation(wrappedDriverError(runtimeFailure("23505")))).toBe(true);
  });

  it("does not mistake another SQLSTATE for the race it decides", () => {
    // 23503 is a foreign-key violation: a caller that read it as "lost the race"
    // would report a not-acquired claim for what is really a broken write.
    expect(isUniqueViolation(runtimeFailure("23503"))).toBe(false);
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
  });
});
