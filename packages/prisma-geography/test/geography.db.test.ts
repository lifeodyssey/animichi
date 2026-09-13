import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startDatabaseFixture, stopDatabaseFixture, type DatabaseFixture } from "./support/database.ts";
import {
  changeSrid,
  createGistIndex,
  dropGistIndex,
  explain,
  formattedColumn,
  nearbyRows,
  ormPoint,
  sqlPoint,
} from "./support/evidence.ts";
import { EXPECTED_NEAREST } from "./support/fixtures.ts";
import { prisma, prismaFailure } from "./support/prisma-cli.ts";
import { assertGistRadiusAndOrder, assertSequentialScan } from "./support/query-plan.ts";

let fixture: DatabaseFixture;
let fixtureStarted = false;

before(async () => {
  fixture = await startDatabaseFixture();
  fixtureStarted = true;
});

after(async () => {
  if (!fixtureStarted) return;
  await stopDatabaseFixture(fixture);
});

void test("the authored migration creates geography(Point,4326)", async () => {
  assert.equal(await formattedColumn(fixture.pool), "geography(Point,4326)");
});

void test("the verifier detects an out-of-band SRID mutation", async () => {
  await assertVerifierMutation();
});

void test("typed operations filter and project metres in KNN order", async () => {
  const rows = await nearbyRows(fixture);
  assert.deepEqual(rows.map((row) => row.id), [...EXPECTED_NEAREST]);
  assert.ok(distanceAt(rows, 0) < 500);
  assert.ok(distanceAt(rows, 1) > 6_000);
  assert.ok(distanceAt(rows, 1) < 7_500);
  assert.ok(distanceAt(rows, 2) > 25_000);
  assert.ok(distanceAt(rows, 2) < 30_000);
});

void test("ORM and db.sql reads decode structured coordinates", async () => {
  const expected = { type: "Point", coordinates: [139.7016, 35.658], srid: 4326 };
  assert.deepEqual((await ormPoint(fixture))?.location, expected);
  assert.deepEqual((await sqlPoint(fixture))?.location, expected);
});

void test("one GiST node serves radius and KNN ordering", async () => {
  await assertIndexMutation();
});

async function assertVerifierMutation(): Promise<void> {
  await assertVerified();
  await changeSrid(fixture.pool, 4269);
  try {
    await assertSridDrift();
  } finally {
    await changeSrid(fixture.pool, 4326);
  }
  await assertVerified();
}

async function assertVerified(): Promise<void> {
  const result = await prisma(["db", "verify", "--db", fixture.postgres.dsn]);
  assert.match(result.stdout, /Database schema satisfies contract/u);
}

async function assertSridDrift(): Promise<void> {
  const drift = await prismaFailure(["db", "verify", "--db", fixture.postgres.dsn]);
  assert.notEqual(drift.exitCode, 0);
  assert.match(drift.stdout, /geography\(Point,4269\)/u);
}

async function assertIndexMutation(): Promise<void> {
  await nearbyRows(fixture);
  const statement = fixture.queryLog.lastMatching("ST_DWithin");
  assertGistRadiusAndOrder(await explain(fixture.pool, statement));
  await assertDroppedIndexPlan(statement);
  assertGistRadiusAndOrder(await explain(fixture.pool, statement));
}

async function assertDroppedIndexPlan(statement: Parameters<typeof explain>[1]): Promise<void> {
  await dropGistIndex(fixture.pool);
  try {
    await assertPlanWithoutIndex(statement);
  } finally {
    await createGistIndex(fixture.pool);
  }
}

async function assertPlanWithoutIndex(statement: Parameters<typeof explain>[1]): Promise<void> {
  const withoutIndex = await explain(fixture.pool, statement);
  assert.throws(() => {
    assertGistRadiusAndOrder(withoutIndex);
  }, /GiST index/u);
  assertSequentialScan(withoutIndex);
}

function distanceAt(rows: readonly { readonly distanceM: number }[], index: number): number {
  const row = rows[index];
  assert.ok(row, `missing distance row ${String(index)}`);
  return row.distanceM;
}
