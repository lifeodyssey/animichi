import { expect, it } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import { enrichWork } from "../src/enrich/enrich";
import { publishVersion } from "../src/publish/versioning";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * One atomic unit per publish, now that the batch is gone.
 *
 * This suite used to pin neon-http's `db.batch` contract: an ordered array of
 * statements, submitted together, all-or-nothing. The Prisma plane has no
 * `batch` — it has a real client TRANSACTION — so what replaced that contract is
 * what has to be pinned here: every write of one enrich runs inside ONE
 * `transaction()`, the version flip precedes the insert so a reader never sees
 * the new rows against the old pointer, and a publish reached from inside a
 * caller's transaction JOINS it instead of opening a second connection.
 *
 * The fake's `transaction` runs `fn` on a bound seam whose own `transaction`
 * joins — the shape `bindTransaction` gives a request in `db/prisma.ts` — and
 * counts only the openings that are NOT a join. Atomicity itself — that a
 * mid-pass throw really discards, and that a failed publish discards its flip —
 * is proved against real Postgres in publish.integration.test.ts.
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

it("publishes a version in ONE transaction of its own, flip then read then insert", async () => {
  // The flip answers nothing, the version read answers the next version the SQL
  // computed, and the insert returns it.
  const seam = atomicSeam([], [{ version: 7 }], [{ version: 7 }]);

  await expect(publishVersion(seam.query, "batch-work")).resolves.toBe(7);

  // A standalone publish is one unit of its own: a crash between the flip and
  // the insert must discard the flip rather than leave the work with no current
  // version at all.
  expect(seam.transactions()).toBe(1);
  expect(seam.planKinds()).toEqual(["update", "select", "insert"]);
});

it("runs every enrich write inside ONE transaction, flip before insert", async () => {
  // One answer list per statement, in the order the pass issues them:
  // the two raw reads, then inside the transaction the three upserts, the flip,
  // the next-version read and the version insert.
  const seam = atomicSeam(
    [{ payload: RAW_BANGUMI }],
    [{ payload: RAW_ANITABI }],
    [],
    [],
    [],
    [],
    [{ version: 11 }],
    [{ version: 11 }],
  );

  await expect(enrichWork(seam.query, "batch-work")).resolves.toEqual({ version: 11, pointCount: 2 });

  // The publish inside the pass JOINS the pass's transaction — still one unit,
  // not two connections.
  expect(seam.transactions()).toBe(1);
  // The two raw reads happen BEFORE the transaction opens; inside it:
  // upsert bangumi, upsert points, upsert aliases, flip, next-version, insert.
  expect(seam.planKinds()).toEqual([
    "select", "select",
    "insert", "insert", "insert",
    "update", "select", "insert",
  ]);
});
