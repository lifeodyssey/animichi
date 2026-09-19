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
 * `transaction()`, and the version flip precedes the insert so a reader never
 * sees the new rows against the old pointer.
 *
 * The fake's `transaction` runs `fn` on the same bound seam (a real
 * transaction-bound seam joins rather than nests, see `db/prisma.ts`) and counts
 * how many times it was opened. Atomicity itself — that a mid-pass throw really
 * discards — is proved against real Postgres in publish.integration.test.ts.
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
  const seam: CatalogPrisma = {
    ...recording.query,
    transaction: (fn) => {
      opened += 1;
      return Promise.resolve(fn(seam));
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

it("publishes a version inside the caller's transaction, flip then read then insert", async () => {
  // The flip answers nothing, the version read answers the next version the SQL
  // computed, and the insert returns it.
  const seam = atomicSeam([], [{ version: 7 }], [{ version: 7 }]);

  await expect(publishVersion(seam.query, "batch-work")).resolves.toBe(7);

  // publishVersion opens NO transaction of its own: Postgres has no nested
  // transactions, and a helper that opened a second connection would make the
  // atomicity the caller asked for a lie.
  expect(seam.transactions()).toBe(0);
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

  expect(seam.transactions()).toBe(1);
  // The two raw reads happen BEFORE the transaction opens; inside it:
  // upsert bangumi, upsert points, upsert aliases, flip, next-version, insert.
  expect(seam.planKinds()).toEqual([
    "select", "select",
    "insert", "insert", "insert",
    "update", "select", "insert",
  ]);
});
