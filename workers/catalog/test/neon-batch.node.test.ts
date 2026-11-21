import { expect, it } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { enrichWork } from "../src/enrich/enrich";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * One atomic unit per publish, now that the batch is gone.
 *
 * This suite used to pin neon-http's `db.batch` contract: an ordered array of
 * statements, submitted together, all-or-nothing. The Prisma plane has no
 * `batch` — it has a real client TRANSACTION — so what replaced that contract is
 * what has to be pinned here: every write of one enrich runs inside ONE
 * `transaction()`, after the raw reads that precede it.
 *
 * The fake's `transaction` runs `fn` on a bound seam whose own `transaction`
 * joins — the shape `bindTransaction` gives a request in `db/prisma.ts` — and
 * counts only the openings that are NOT a join. What the pass does when one of
 * its steps fails is `enrich-failure-paths.node.test.ts`.
 */

/** The seam under test, with its transaction openings counted. */
interface TransactionRecording {
  readonly query: CatalogPrisma;
  transactions(): number;
  planKinds(): string[];
}

function atomicSeam(...answers: readonly (readonly unknown[])[]): TransactionRecording {
  const recording = recordingCatalogPrisma(...answers);
  let opened = 0;
  const bound: CatalogPrisma = { ...recording.query, transaction: (fn) => Promise.resolve(fn(bound)) };
  const seam: CatalogPrisma = {
    ...recording.query,
    transaction: (fn) => {
      opened += 1;
      return Promise.resolve(fn(bound));
    },
  };
  return {
    query: seam,
    transactions: () => opened,
    planKinds: () => recording.plans().map((plan) => (plan.ast as { kind: string }).kind),
  };
}

const RAW_BANGUMI = { name: "Batch Anime", name_cn: "批次动画" };
const RAW_ANITABI = [
  { id: "point-1", name: "Batch Place", geo: [35, 139] },
  { id: "point-2", name: "Second Place", geo: [36, 140] },
];

it("runs every enrich write inside ONE transaction", async () => {
  // One answer list per statement, in the order the pass issues them:
  // the two raw reads, then inside the transaction the three upserts.
  const seam = atomicSeam([{ payload: RAW_BANGUMI }], [{ payload: RAW_ANITABI }], [], [], []);

  await expect(enrichWork(seam.query, "batch-work")).resolves.toEqual({ pointCount: 2 });

  expect(seam.transactions()).toBe(1);
  // The two raw reads happen BEFORE the transaction opens; inside it:
  // upsert bangumi, upsert points, upsert aliases, and nothing after them.
  expect(seam.planKinds()).toEqual(["select", "select", "insert", "insert", "insert"]);
});
