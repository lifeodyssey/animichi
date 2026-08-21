import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APPLY_LOCK_NAME, productionApply, QueueLock } from "../src/lock";
import { BODY_A, BODY_B, FakeSql, applyFixture } from "./http-apply.helpers";

// #1124 AC4 — second concurrent run waits on a fake lock (no wall clock)
// and does not double-apply. Production lock name is fixed, not migrator-job-*.

describe("HTTP apply mutex (AC4)", () => {
  it("queues a second run so each file is applied once", async () => {
    const db = new FakeSql();
    const lock = new QueueLock();
    let release: () => void = () => undefined;
    db.holdOn(BODY_A, new Promise<void>((resolve) => { release = resolve; }));
    const first = applyFixture(db, { lock });
    const second = applyFixture(db, { lock });
    release();
    await Promise.all([first, second]);
    expect(db.units).toEqual([BODY_A, BODY_B]);
  });

  it("uses a fixed-name apply lock, not a per-run migrator-job-* name", () => {
    const names: string[] = [];
    const namespace = {
      idFromName: (name: string): string => {
        names.push(name);
        return name;
      },
      get: () => ({ run: () => Promise.resolve({ kind: "success" as const, exitCode: 0 as const }) }),
    } as unknown as DurableObjectNamespace;
    productionApply(namespace);
    expect(names).toEqual([APPLY_LOCK_NAME]);
    expect(APPLY_LOCK_NAME).not.toMatch(/^migrator-job-/);
  });

  it("MigratorApplyLock serializes with blockConcurrencyWhile", () => {
    const source = applyLockSource();
    expect(source).toContain("blockConcurrencyWhile");
    expect(source).not.toMatch(/migrator-job-/);
  });

  it("MigratorApplyLock extends DurableObject so stub.run RPC is enabled", () => {
    const source = applyLockSource();
    expect(source).toContain('from "cloudflare:workers"');
    expect(source).toMatch(/class MigratorApplyLock extends DurableObject/);
  });
});

function applyLockSource(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/apply-lock.ts"), "utf8");
}
