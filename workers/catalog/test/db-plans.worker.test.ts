import { describe, expect, it } from "vitest";
import { catalogClient } from "../src/db/prisma";
import { atServerClock, atServerNow, upsert } from "../src/db/plans";

/**
 * The two plan repairs (#1630), at the level they are stated.
 *
 * `upsert` and `atServerNow` / `atServerClock` are what the builder cannot say:
 * an INSERT has no conflict clause, and a write value is BOUND, so a column
 * cannot be assigned the database's own clock. Both are repairs on an AST the
 * builder already produced, so the assertions here are about the AST that comes
 * back out — the conflict clause's shape, and the clock fragment's own
 * `now() + make_interval(secs => $n)` form with the offset BOUND rather than
 * rendered.
 *
 * Whether Postgres accepts them is not this suite's question: `enrich` runs end
 * to end on the real plane in enrich.integration.test.ts, and the guarded claims
 * race there too (ingest-jobs.integration.test.ts).
 */

const sql = catalogClient().sql;

/** An INSERT plan over a table with a conflict target and a clock column. */
function insertPlan() {
  return sql.public.raw_bangumi.insert([{ work_id: "w-1", payload: {} }]).returning("work_id").build();
}

/** An UPDATE plan over the same table. */
function updatePlan() {
  return sql.public.ingest_jobs.update({ status: "failed" }).where((fields, match) => match.eq(fields.work_id, "w-1")).build();
}

describe("upsert", () => {
  it("adds a conflict clause naming the target and copying EXCLUDED's columns", () => {
    const plan = upsert(insertPlan(), { target: ["work_id"], update: ["payload", "fetched_at"] });

    const ast = plan.ast as { kind: string; onConflict?: unknown };
    expect(ast.kind).toBe("insert");
    expect(ast.onConflict).toBeDefined();
    // The assignments copy the proposed row; they carry no caller value.
    const clause = JSON.stringify(ast.onConflict);
    expect(clause).toContain("excluded");
    expect(clause).toContain("payload");
    expect(clause).toContain("fetched_at");
  });

  it("keeps the plan's own projection, so RETURNING still reads back", () => {
    const plan = upsert(insertPlan(), { target: ["work_id"], update: ["payload"] });

    expect(JSON.stringify(plan.ast)).toContain("work_id");
  });

  it("refuses a repair with no columns — an empty clause is not a no-op", () => {
    expect(() => upsert(insertPlan(), { target: [], update: ["payload"] })).toThrow(/at least one column/);
    expect(() => upsert(insertPlan(), { target: ["work_id"], update: [] })).toThrow(/at least one column/);
  });

  it("refuses a plan that is not an INSERT", () => {
    expect(() => upsert(updatePlan() as never, { target: ["work_id"], update: ["payload"] }))
      .toThrow(/expected an INSERT plan/);
  });
});

describe("atServerNow / atServerClock", () => {
  it("stamps an UPDATE's column with the server clock, not a bound value", () => {
    const plan = atServerNow(updatePlan(), ["finished_at"]);

    const { set } = plan.ast as { set: Record<string, { kind: string }> };
    // A bound value would be a `param-ref` carrying a wall-clock string; the
    // stamp has to be the database's own `now()`.
    expect(set.finished_at?.kind).not.toBe("param-ref");
    expect(JSON.stringify(set.finished_at)).toContain("now()");
  });

  it("stamps an INSERT's rows, which is the branch a new row needs", () => {
    const plan = atServerNow(insertPlan(), ["fetched_at"]);

    const { rows } = plan.ast as { rows: readonly Record<string, { kind: string }>[] };
    expect(rows[0]?.fetched_at?.kind).not.toBe("param-ref");
    expect(JSON.stringify(rows[0]?.fetched_at)).toContain("now()");
  });

  it("offsets a stamp by its own seconds, BOUND rather than rendered", () => {
    const plan = atServerClock(updatePlan(), { negative_cached_until: 3600 });

    const { set } = plan.ast as { set: Record<string, unknown> };
    const text = JSON.stringify(set.negative_cached_until);
    expect(text).toContain("make_interval");
    // The offset travels as a parameter value, so no caller number reaches SQL text.
    expect(text).toContain("param-ref");
    expect(text).toContain("3600");
  });

  it("refuses a plan that is neither an INSERT nor an UPDATE", () => {
    const select = sql.public.ingest_jobs.select("work_id").build();
    expect(() => atServerNow(select as never, ["finished_at"])).toThrow(/expected an INSERT or UPDATE plan/);
    expect(() => atServerNow(updatePlan(), [])).toThrow(/at least one column/);
  });
});
