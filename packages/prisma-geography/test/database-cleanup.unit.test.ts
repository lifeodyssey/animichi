import assert from "node:assert/strict";
import { test } from "node:test";
import { stopDatabaseFixture, type DatabaseFixture } from "./support/database.ts";

void test("fixture cleanup drops the chain database when the client close fails", async () => {
  const events: string[] = [];
  const failure = new Error("client close failed");
  const fixture = fakeFixture(events, () => {
    events.push("db.close");
    return Promise.reject(failure);
  });

  await assert.rejects(stopDatabaseFixture(fixture), failure);
  assert.deepEqual(events, ["db.close", "pool.end", "chain.stop"]);
});

void test("fixture cleanup drops the chain database when the pool end fails", async () => {
  const events: string[] = [];
  const failure = new Error("pool end failed");
  const fixture = fakeFixture(events, () => {
    events.push("db.close");
    return Promise.resolve();
  }, () => {
    events.push("pool.end");
    return Promise.reject(failure);
  });

  await assert.rejects(stopDatabaseFixture(fixture), failure);
  assert.deepEqual(events, ["db.close", "pool.end", "chain.stop"]);
});

function fakeFixture(events: string[], close: () => Promise<void>, end?: () => Promise<void>): DatabaseFixture {
  return {
    chain: fakeChain(events),
    pool: fakePool(events, end),
    db: fakeDatabase(close),
    queryLog: { recorded: [] } as unknown as DatabaseFixture["queryLog"],
  };
}

function fakeChain(events: string[]): DatabaseFixture["chain"] {
  return { dsn: "postgresql://test/chain", stop: () => {
    events.push("chain.stop");
    return Promise.resolve();
  } };
}

function fakePool(events: string[], end?: () => Promise<void>): DatabaseFixture["pool"] {
  const poolEnd = end ?? (() => {
    events.push("pool.end");
    return Promise.resolve();
  });
  return { end: poolEnd } as unknown as DatabaseFixture["pool"];
}

function fakeDatabase(close: () => Promise<void>): DatabaseFixture["db"] {
  return { close } as unknown as DatabaseFixture["db"];
}
