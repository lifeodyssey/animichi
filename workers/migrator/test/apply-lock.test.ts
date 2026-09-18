import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APPLY_LOCK_NAME, productionSelected, QueueLock } from "../src/lock";
import type { SelectedMetadata, SelectedMigration, SelectedPreflight } from "../src/selected-migration";
import { requestMetadata } from "./sealed-migrations";

// #1124 AC4 — a second concurrent apply waits on the lock (no wall clock) and does not
// double-apply. The production lock name is fixed, not `migrator-job-*`. With one authority
// the lock guards `preflight` and `migrate` rather than a per-file apply loop (#1634).

describe("the apply mutex (AC4)", () => {
  it("queues a second migration so each one runs alone", async () => {
    const lock = new QueueLock();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.runExclusive(async () => { order.push("first-start"); await held; order.push("first-end"); });
    const second = lock.runExclusive(() => { order.push("second-start"); return Promise.resolve(); });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("uses a fixed-name apply lock, not a per-run migrator-job-* name", () => {
    const { namespace, calls } = makeLockNamespace();
    productionSelected(namespace);
    expect(calls.names).toEqual([APPLY_LOCK_NAME]);
    expect(APPLY_LOCK_NAME).not.toMatch(/^migrator-job-/);
  });

  it("MigratorApplyLock serializes with blockConcurrencyWhile", () => {
    const source = applyLockSource();
    expect(source).toContain("blockConcurrencyWhile");
    expect(source).not.toMatch(/migrator-job-/);
  });

  it("MigratorApplyLock extends DurableObject so its stub calls are RPC", () => {
    const source = applyLockSource();
    expect(source).toContain('from "cloudflare:workers"');
    expect(source).toMatch(/class MigratorApplyLock extends DurableObject/);
  });
});

// The identity bounds the PRODUCTION apply only if this hop carries it: every other bound test
// drives the injected executor double.
describe("the production apply hop", () => {
  it("hands the complete selected metadata to the lock", async () => {
    const { namespace, calls } = makeLockNamespace();
    await productionSelected(namespace).migrate("dsn", requestMetadata);
    expect(calls.migrations).toEqual([["dsn", requestMetadata]]);
  });
});

/** What the lock namespace was asked for: the resolved name, then every migrate RPC. */
interface LockCalls {
  names: string[];
  migrations: [string, SelectedMetadata][];
}

function makeLockNamespace(): { namespace: DurableObjectNamespace; calls: LockCalls } {
  const calls: LockCalls = { names: [], migrations: [] };
  const migrate = (...args: [string, SelectedMetadata]): Promise<SelectedMigration> => {
    calls.migrations.push(args);
    return Promise.resolve({ kind: "success", exitCode: 0 });
  };
  const preflight = (): Promise<SelectedPreflight> => Promise.resolve({ compatible: false, error: "unused" });
  const namespace = {
    idFromName: (name: string): string => {
      calls.names.push(name);
      return name;
    },
    get: () => ({ migrate, preflight }),
  } as unknown as DurableObjectNamespace;
  return { namespace, calls };
}

function applyLockSource(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/apply-lock.ts"), "utf8");
}
