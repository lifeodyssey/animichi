import { describe, expect, it } from "vitest";
import { catalogPrisma, type CatalogPlanExecutor, type CatalogPrisma } from "../src/db/prisma";
import { enrichWork } from "../src/enrich/enrich";
import { tracedRuntime, type LifecycleCall, type LifecycleRefusal } from "./fakes/fake-catalog-runtime";
import { rejectingAtCall, tracingExecutor, type PlanAnswers } from "./fakes/plan-inspection";

/**
 * `enrichWork`, the catalog publish, on every path where one of its steps
 * fails: what the caller receives, and the order in which the pass's statements
 * and its transaction's own calls were made, read off one trace.
 *
 * The pass runs on the real `catalogPrisma` seam and the real
 * `inCatalogTransaction`, over a runtime whose statements and transaction calls
 * a row can refuse, so each row is the publish as the Worker runs it
 * (`prisma-transaction.worker.test.ts` pins the transaction wrapper alone).
 *
 * Four kinds of row: a failure before the transaction opens, a refused
 * statement inside it, a refused call of the transaction's own, and two
 * overlapping publishes of one work. Three refused statements belong to the
 * `cluster_version` swap ({@link SWAP}): when the write goes, they and
 * {@link SWAP} go with it, and every other row stays as written. The
 * overlapping publishes pin the premise of `enrich-overlap.integration.test.ts`:
 * each publish is one transaction whose first write is the `bangumi` upsert,
 * the statement that queues a second publish of the same work in Postgres.
 */

const WORK = "failure-work";

/** The raw-zone reads a pass makes before its transaction opens. */
const READS = ["select raw_bangumi", "select raw_anitabi"];
/** The catalog upserts a pass makes inside its transaction, in order. */
const UPSERTS = ["insert bangumi", "insert points", "insert aliases"];
/** The `cluster_version` swap that follows them: flip, next-version read, insert. */
const SWAP = ["update cluster_version", "select cluster_version", "insert cluster_version"];
/** Every statement a pass makes inside its transaction. */
const WRITES = [...UPSERTS, ...SWAP];

/** What a healthy pass reads: a titled subject, two points, and the next version. */
const ANSWERS: PlanAnswers = {
  "select raw_bangumi": [{ payload: { name: "Failure Anime", name_cn: "失败动画" } }],
  "select raw_anitabi": [{ payload: [{ id: "f-1", name: "First", geo: [35, 139] }, { id: "f-2", name: "Second", geo: [36, 140] }] }],
  "select cluster_version": [{ version: 3 }],
  "insert cluster_version": [{ version: 3 }],
};

/** One publish's seam, and the trace its statements and transaction calls share. */
interface PublishPass {
  readonly query: CatalogPrisma;
  readonly trace: readonly string[];
}

function publishPass(executorFor: (trace: string[]) => CatalogPlanExecutor, refusal?: LifecycleRefusal): PublishPass {
  const trace: string[] = [];
  return { query: catalogPrisma(tracedRuntime(executorFor(trace), trace, refusal)), trace };
}

interface BeforeTransactionRow {
  readonly row: string;
  readonly answers: PlanAnswers;
  readonly message: string;
  readonly trace: readonly string[];
}

const BEFORE_TRANSACTION: readonly BeforeTransactionRow[] = [
  {
    row: "no raw_bangumi row", answers: { ...ANSWERS, "select raw_bangumi": [] },
    message: "No raw_bangumi payload for work failure-work", trace: ["select raw_bangumi"],
  },
  {
    row: "no raw_anitabi row", answers: { ...ANSWERS, "select raw_anitabi": [] },
    message: "No raw_anitabi payload for work failure-work", trace: READS,
  },
  {
    row: "a raw_bangumi payload that is not a subject", answers: { ...ANSWERS, "select raw_bangumi": [{ payload: "?" }] },
    message: "Bangumi payload is not an object", trace: ["select raw_bangumi"],
  },
];

describe("enrichWork before its transaction opens", () => {
  it.each(BEFORE_TRANSACTION)("$row: rejects, and no transaction opens", async ({ answers, message, trace }) => {
    const pass = publishPass((into) => tracingExecutor(answers, into));

    await expect(enrichWork(pass.query, WORK)).rejects.toThrow(message);
    expect(pass.trace).toEqual(trace);
  });
});

interface RefusedStatementRow {
  readonly row: string;
  /** The refused statement, counting every statement of the pass from 1. */
  readonly call: number;
  /** The statements made inside the transaction, the refused one last. */
  readonly writes: readonly string[];
}

const REFUSED_STATEMENTS: readonly RefusedStatementRow[] = [
  { row: "the bangumi upsert", call: 3, writes: ["insert bangumi"] },
  { row: "the points upsert", call: 4, writes: ["insert bangumi", "insert points"] },
  { row: "the aliases upsert", call: 5, writes: UPSERTS },
  { row: "the cluster_version flip", call: 6, writes: [...UPSERTS, "update cluster_version"] },
  { row: "the next-version read", call: 7, writes: [...UPSERTS, "update cluster_version", "select cluster_version"] },
  { row: "the version insert", call: 8, writes: WRITES },
];

describe("enrichWork when a statement inside its transaction is refused", () => {
  it.each(REFUSED_STATEMENTS)("$row refused: rolls back, releases, rethrows the refusal", async ({ call, writes }) => {
    const refused = new Error("statement refused");
    const pass = publishPass((into) => rejectingAtCall(call, refused, ANSWERS, into));

    await expect(enrichWork(pass.query, WORK)).rejects.toBe(refused);
    expect(pass.trace).toEqual([...READS, "begin", ...writes, "rollback", "release"]);
  });
});

interface RefusedCallRow {
  readonly row: string;
  readonly call: LifecycleCall;
  readonly trace: readonly string[];
}

const REFUSED_CALLS: readonly RefusedCallRow[] = [
  { row: "BEGIN", call: "begin", trace: [...READS, "begin", "destroy"] },
  { row: "COMMIT", call: "commit", trace: [...READS, "begin", ...WRITES, "commit", "rollback", "release"] },
  { row: "the release after a COMMIT", call: "release", trace: [...READS, "begin", ...WRITES, "commit", "release"] },
];

describe("enrichWork when one of its transaction's own calls fails", () => {
  it.each(REFUSED_CALLS)("$row fails: the caller receives that failure", async ({ call, trace }) => {
    const refused = new Error(`${call} refused`);
    const pass = publishPass((into) => tracingExecutor(ANSWERS, into), { call, error: refused });

    await expect(enrichWork(pass.query, WORK)).rejects.toBe(refused);
    expect(pass.trace).toEqual(trace);
  });
});

describe("enrichWork under two overlapping publishes of one work", () => {
  it("both commit, each in one transaction whose first write is the bangumi upsert", async () => {
    const first = publishPass((into) => tracingExecutor(ANSWERS, into));
    const second = publishPass((into) => tracingExecutor(ANSWERS, into));
    const committed = [...READS, "begin", ...WRITES, "commit", "release"];

    const settled = await Promise.allSettled([enrichWork(first.query, WORK), enrichWork(second.query, WORK)]);

    expect(settled).toMatchObject([
      { status: "fulfilled", value: { pointCount: 2 } },
      { status: "fulfilled", value: { pointCount: 2 } },
    ]);
    expect([first.trace, second.trace]).toEqual([committed, committed]);
  });
});
