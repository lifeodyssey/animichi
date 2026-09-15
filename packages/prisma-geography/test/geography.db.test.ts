import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startDatabaseFixture, stopDatabaseFixture, type DatabaseFixture } from "./support/database.ts";
import {
  changeSrid,
  createGistIndex,
  createTrigramIndex,
  dropGistIndex,
  dropTrigramIndex,
  explain,
  formattedColumn,
  nearbyRows,
  ormPoint,
  type PoolQuery,
  sqlPoint,
  trigramRows,
} from "./support/evidence.ts";
import { EXPECTED_NEAREST } from "./support/fixtures.ts";
import { prisma, prismaFailure } from "./support/prisma-cli.ts";
import { assertGistRadiusAndOrder, assertSequentialScan, assertTrigramIndex } from "./support/query-plan.ts";

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
  assert.ok(metricAt(rows, 0, "distanceM") < 500);
  assert.ok(metricAt(rows, 1, "distanceM") > 6_000);
  assert.ok(metricAt(rows, 1, "distanceM") < 7_500);
  assert.ok(metricAt(rows, 2, "distanceM") > 25_000);
  assert.ok(metricAt(rows, 2, "distanceM") < 30_000);
});

void test("ORM and db.sql reads decode structured coordinates", async () => {
  const expected = { type: "Point", coordinates: [139.7016, 35.658], srid: 4326 };
  assert.deepEqual((await ormPoint(fixture))?.location, expected);
  assert.deepEqual((await sqlPoint(fixture))?.location, expected);
});

void test("one GiST node serves radius and KNN ordering", async () => {
  await assertIndexMutation(GIST_MUTATION);
});

void test("typed operations project similarity and filter with the match operator", async () => {
  const rows = await trigramRows(fixture);
  assert.deepEqual(rows.map((row) => row.id), ["shibuya", "shibuya-station", "shibuya-crossing"]);
  assert.equal(metricAt(rows, 0, "similarity"), 1);
  assert.ok(metricAt(rows, 1, "similarity") > metricAt(rows, 2, "similarity"));
});

void test("the trigram match predicate uses its GIN index", async () => {
  await assertIndexMutation(TRIGRAM_MUTATION);
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

interface IndexMutation {
  readonly needle: string;
  readonly assertion: RegExp;
  readonly run: (fixture: DatabaseFixture) => Promise<unknown>;
  readonly assertIndexed: (payload: unknown) => void;
  readonly drop: PoolQuery;
  readonly create: PoolQuery;
}

const GIST_MUTATION: IndexMutation = {
  needle: "ST_DWithin",
  assertion: /GiST index/u,
  run: nearbyRows,
  assertIndexed: assertGistRadiusAndOrder,
  drop: dropGistIndex,
  create: createGistIndex,
};

const TRIGRAM_MUTATION: IndexMutation = {
  needle: "similarity",
  assertion: /GIN index/u,
  run: trigramRows,
  assertIndexed: assertTrigramIndex,
  drop: dropTrigramIndex,
  create: createTrigramIndex,
};

async function assertIndexMutation(mutation: IndexMutation): Promise<void> {
  await mutation.run(fixture);
  const statement = fixture.queryLog.lastMatching(mutation.needle);
  mutation.assertIndexed(await explain(fixture.pool, statement));
  await assertDroppedIndexPlan(mutation, statement);
  mutation.assertIndexed(await explain(fixture.pool, statement));
}

async function assertDroppedIndexPlan(mutation: IndexMutation, statement: Parameters<typeof explain>[1]): Promise<void> {
  await mutation.drop(fixture.pool);
  try {
    assertPlanWithoutIndex(mutation, await explain(fixture.pool, statement));
  } finally {
    await mutation.create(fixture.pool);
  }
}

function assertPlanWithoutIndex(mutation: IndexMutation, payload: unknown): void {
  assert.throws(() => {
    mutation.assertIndexed(payload);
  }, mutation.assertion);
  assertSequentialScan(payload);
}

interface MetricRow {
  readonly distanceM?: number;
  readonly similarity?: number;
}

function metricAt(rows: readonly MetricRow[], index: number, metric: "distanceM" | "similarity"): number {
  const value = rows[index]?.[metric];
  assert.ok(value !== undefined, `missing ${metric} row ${String(index)}`);
  return value;
}
