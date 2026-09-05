import { describe, expect, it } from "vitest";
import { applyChain } from "../src/http-apply";
import { FakeSql } from "./fake-sql";
import { DSN, FIXED_NOW, POOLER_DSN, applyFixture, fixtureChain } from "./http-apply.helpers";

// #1124 AC3 — reject a -pooler DSN before any SQL (and before connect()).

function rejectedMessage(run: Promise<unknown>): Promise<string> {
  return run.then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

function poolerApply(db: FakeSql): Promise<unknown> {
  return applyChain({
    dsn: POOLER_DSN,
    source: fixtureChain,
    connect: db.connect,
    now: (): Date => FIXED_NOW,
  });
}

describe("HTTP apply pooler reject (AC3)", () => {
  it("rejects a -pooler DSN before connect or SQL", async () => {
    const db = new FakeSql();
    let connected = false;
    const run = applyChain({
      dsn: POOLER_DSN,
      source: fixtureChain,
      connect: (dsn: string) => {
        connected = true;
        return db.connect(dsn);
      },
      now: (): Date => FIXED_NOW,
    });
    expect(await rejectedMessage(run)).toMatch(/pooled endpoint rejected/i);
    expect(connected).toBe(false);
    expect(db.statements).toEqual([]);
  });

  it("does not interpolate the DSN into the reject error", async () => {
    const message = await rejectedMessage(poolerApply(new FakeSql()));
    expect(message).toMatch(/pooled endpoint rejected/i);
    expect(message).not.toContain("postgresql://");
    expect(message).not.toContain("migrator:x");
    expect(message).not.toContain(POOLER_DSN);
  });

  it("applies against a direct Neon host", async () => {
    const db = new FakeSql();
    await expect(applyFixture(db, { dsn: DSN })).resolves.toEqual({ kind: "success", exitCode: 0 });
    expect(db.units).toHaveLength(2);
  });
});
