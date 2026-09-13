import assert from "node:assert/strict";
import { test } from "node:test";
import { stopDatabaseFixture, type DatabaseFixture } from "./support/database.ts";

void test("fixture cleanup stops PostgreSQL when the client close fails", async () => {
  const events: string[] = [];
  const failure = new Error("client close failed");
  const fixture = fakeFixture(events, () => {
    events.push("db.close");
    return Promise.reject(failure);
  });

  await assert.rejects(stopDatabaseFixture(fixture), failure);
  assert.deepEqual(events, ["db.close", "pool.end", "postgres.stop"]);
});

void test("fixture cleanup stops PostgreSQL when the pool end fails", async () => {
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
  assert.deepEqual(events, ["db.close", "pool.end", "postgres.stop"]);
});

function fakeFixture(
  events: string[],
  close: () => Promise<void>,
  end: () => Promise<void> = () => {
    events.push("pool.end");
    return Promise.resolve();
  },
): DatabaseFixture {
  return {
    postgres: { dsn: "postgresql://test", stop: () => {
      events.push("postgres.stop");
      return Promise.resolve();
    } },
    pool: { end } as unknown as DatabaseFixture["pool"],
    db: { close } as unknown as DatabaseFixture["db"],
    queryLog: { recorded: [] } as unknown as DatabaseFixture["queryLog"],
  };
}
