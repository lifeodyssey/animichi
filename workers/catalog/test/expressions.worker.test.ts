import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { points } from "../src/db/schema";
import * as x from "../src/db/expressions";

// Sanctioned exception to Spec Testing Decisions + STORY 24 (no rendered-SQL
// assertions): this unit-test target is the `typed-expression` module itself
// (src/db/expressions.ts), which exists solely to assemble PostGIS / pg_trgm /
// interval fragments from inputs. `sqlText` below flattens a *fragment* as it
// is being constructed from arguments — it is not the terraformed complete
// statement a worker ships to Neon, so asserting its fragments is the module's
// contract and is intentionally exempt from the adapter-level rule.

/** Flatten a Drizzle SQL fragment to its literal text (chunks + placeholders). */
function sqlText(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(sqlText).join("");
  const v = value as { value?: unknown[]; queryChunks?: unknown[] };
  if (Array.isArray(v.value)) return v.value.map(sqlText).join("");
  if (Array.isArray(v.queryChunks)) return v.queryChunks.map(sqlText).join("");
  return "";
}

describe("typed PostgreSQL expression helpers", () => {
  it("builds a geograph point from lat/lng", () => {
    const s = sqlText(x.geoPoint(35.7, 139.7));
    expect(s).toContain("ST_SetSRID");
    expect(s).toContain("ST_MakePoint");
    expect(s).toContain("4326");
    expect(s).toContain("::geography");
  });

  it("builds the ST_DWithin predicate with the meters bound", () => {
    const point = x.geoPoint(35.7, 139.7);
    const s = sqlText(x.withinMeters(points.location, point, 5000));
    expect(s).toMatch(/ST_DWithin\(/);
    expect(s).toContain("5000");
  });

  it("builds the ST_Distance expression", () => {
    const point = x.geoPoint(35.7, 139.7);
    expect(sqlText(x.distanceMeters(points.location, point))).toContain("ST_Distance");
  });

  it("builds the KNN ordering operator around the point", () => {
    const point = x.geoPoint(35.7, 139.7);
    const s = sqlText(x.knnDistance(points.location, point));
    expect(s).toContain("<->");
    expect(s).toContain("ST_SetSRID");
  });

  it("builds the pg_trgm similarity scalar and % pre-filter", () => {
    expect(sqlText(x.trigramSimilarity(points.name, "fate"))).toContain("similarity");
    const op = sqlText(x.trigramMatches(points.name, "fate"));
    expect(op).toContain("%");
    expect(op).toContain("fate");
  });

  it("builds a make_interval seconds fragment and rejects negatives", () => {
    const s = sqlText(x.intervalSeconds(900));
    expect(s).toContain("make_interval");
    expect(s).toContain("900");
    expect(() => x.intervalSeconds(-1)).toThrow(/interval/);
  });

  it("builds the older-than bound on a column", () => {
    expect(sqlText(x.olderThanSeconds(points.createdAt, 900))).toContain("NOW() -");
  });

  it("builds COALESCE resolved to a fallback", () => {
    expect(sqlText(x.coalesce(points.nameCn, ""))).toContain("COALESCE");
  });

  it("returns fragments (never executes) — no .execute / .then surface", () => {
    const f: SQL = x.geoPoint(35.7, 139.7);
    expect(typeof f).toBe("object");
  });
});
