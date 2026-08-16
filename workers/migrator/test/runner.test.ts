import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudflareContainerRunner,
  MIGRATOR_DSN_ENV,
  instanceNameFor,
} from "../src/runner";
import { driveStart, fakeSlot, slotNamespace, type FakeState } from "./runner.helpers";

// AC1: the class is only loadable under workerd, so assert its field values
// against the source rather than the runtime class.
describe("MigrationContainer source (AC1)", () => {
  it("sets sleepAfter strictly above CONTAINER_TIMEOUT_MS and keeps enableInternet true", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../src/container.ts"), "utf8");
    expect(source).toContain('sleepAfter = "30m"');
    expect(source).toContain("enableInternet = true");
    expect(source).not.toContain("onActivityExpired");
  });
});

describe("CloudflareContainerRunner exit mapping", () => {
  it("injects the DSN as MIGRATOR_DATABASE_URL when starting", async () => {
    const f = fakeSlot({ status: "stopped_with_code", exitCode: 0 });
    await f.runner.start("postgresql://migrator:x@db/neondb", 10_000);
    expect(f.slot.started).toBe(true);
    expect(f.slot.env[MIGRATOR_DSN_ENV]).toBe("postgresql://migrator:x@db/neondb");
  });

  it("maps a clean exit to success", async () => {
    const f = fakeSlot({ status: "stopped_with_code", exitCode: 0 });
    await expect(f.runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "success", exitCode: 0 });
  });

  it("maps a non-zero exit to failure with the exit code", async () => {
    const f = fakeSlot({ status: "stopped_with_code", exitCode: 7 });
    await expect(f.runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "failure", exitCode: 7 });
  });

  it("maps a missing exit code on a stopped container to a failure with a default code", async () => {
    const f = fakeSlot({ status: "stopped_with_code" });
    await expect(f.runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "failure", exitCode: 1 });
  });
});

describe("CloudflareContainerRunner timeout path — renew + stop", () => {
  // AC2: renew is invoked at least once per poll before the deadline.
  it("calls renewActivityTimeout once per poll before the deadline (AC2)", async () => {
    let polls = 0;
    let renews = 0;
    const f = fakeSlot({ status: "running" }, {
      getState: (): Promise<FakeState> => {
        polls += 1;
        return Promise.resolve({ status: "running" });
      },
      renewActivityTimeout: (): void => {
        renews += 1;
      },
    });
    const result = await driveStart(f.runner, "postgresql://x", 3000, 5000);
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(renews).toBeGreaterThanOrEqual(polls);
    expect(result.ok && result.value).toMatchObject({ kind: "timeout", lastStatus: "running" });
  });

  // AC3: without renewActivityTimeout the runner still times out and stops.
  it("still reaches a timeout outcome and calls stop() without renewActivityTimeout (AC3)", async () => {
    const f = fakeSlot({ status: "running" }, { renewActivityTimeout: undefined });
    const result = await driveStart(f.runner, "postgresql://x", 0, 1000);
    expect(f.calls.stop).toBe(1);
    expect(result.ok && result.value).toMatchObject({ kind: "timeout", lastStatus: "running" });
  });

  // AC6: a max_instances=1 slot — a single stop() frees it so the next start.
  it("frees the max_instances=1 slot with a single stop() so a later start works (AC6)", async () => {
    const s = slotNamespace();
    const first = await driveStart(s.runner, "postgresql://x", 0, 1000);
    expect(first.ok && first.value).toMatchObject({ kind: "timeout" });
    expect(s.counters.stopCalls).toBe(1);
    const second = await driveStart(s.runner, "postgresql://y", 0, 1000);
    expect(second.ok && second.value).toMatchObject({ kind: "timeout" });
    expect(s.counters.startCalls).toBe(2);
  });
});

describe("CloudflareContainerRunner timeout outcome fields", () => {
  // AC4: the timeout outcome carries ranMs (number), lastStatus, exitCode when present.
  it("carries ranMs, lastStatus and exitCode on the timeout outcome (AC4)", async () => {
    const f = fakeSlot({ status: "running", exitCode: 3 });
    const result = await driveStart(f.runner, "postgresql://x", 0, 1000);
    if (!result.ok) throw new Error("expected timeout");
    expect(result.value).toMatchObject({ kind: "timeout", lastStatus: "running", exitCode: 3 });
    const timeout = result.value as { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number };
    expect(typeof timeout.ranMs).toBe("number");
  });

  it("omits exitCode on the timeout outcome when the state had none (AC4)", async () => {
    const f = fakeSlot({ status: "running" });
    const result = await driveStart(f.runner, "postgresql://x", 0, 1000);
    if (!result.ok) throw new Error("expected timeout");
    const timeout = result.value as { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number };
    expect(timeout.kind).toBe("timeout");
    expect(typeof timeout.ranMs).toBe("number");
    expect(timeout.lastStatus).toBe("running");
    expect("exitCode" in timeout).toBe(false);
  });
});

describe("CloudflareContainerRunner cleanup paths", () => {
  it("stops (destroy fallback) then rethrows when the start RPC race rejects", async () => {
    const f = fakeSlot({ status: "running" }, { start: (): Promise<void> => new Promise<void>(() => undefined) });
    f.handle.stop = (): Promise<void> => {
      f.calls.stop += 1;
      return Promise.reject(new Error("stop failed"));
    };
    f.handle.destroy = (): Promise<void> => {
      f.calls.destroy += 1;
      return Promise.resolve();
    };
    const result = await driveStart(f.runner, "postgresql://x", 10_000, 90_000 + 1000);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected start RPC to reject");
    expect(result.message).toContain("container start RPC did not return");
    expect(f.calls.stop).toBe(1);
    expect(f.calls.destroy).toBe(1);
  });

  it("stops then rethrows when getState rejects mid-poll", async () => {
    const f = fakeSlot({ status: "running" }, {
      getState: (): Promise<FakeState> => Promise.reject(new Error("getState exploded")),
    });
    const result = await driveStart(f.runner, "postgresql://x", 10_000, 1000);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected getState failure to reject");
    expect(result.message).toBe("getState exploded");
    expect(f.calls.stop).toBe(1);
  });
});

describe("#1098 hardening: bounded start RPC + per-run DO instance", () => {
  it("fails loudly when the platform start RPC never returns", async () => {
    const namespace = {
      idFromName: (): string => "id",
      get: () => ({
        start: (): Promise<void> => new Promise<void>(() => undefined),
        getState: (): Promise<FakeState> => Promise.resolve({ status: "running" }),
        stop: (): Promise<void> => Promise.resolve(),
      }),
    } as unknown as DurableObjectNamespace;
    const r = await driveStart(new CloudflareContainerRunner(namespace), "postgresql://x", 10_000, 90_000 + 1000);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected the wedged start RPC to reject");
    expect(r.message).toContain("container start RPC did not return");
  });

  it("uses a fresh per-run DO instance name", async () => {
    const names: string[] = [];
    const namespace = {
      idFromName: (name: string) => {
        names.push(name);
        return "id";
      },
      get: () => ({
        start: (): Promise<void> => Promise.resolve(),
        getState: (): Promise<FakeState> => Promise.resolve({ status: "stopped_with_code", exitCode: 0 }),
        stop: (): Promise<void> => Promise.resolve(),
      }),
    } as unknown as DurableObjectNamespace;
    const runner = new CloudflareContainerRunner(namespace);
    await runner.start("postgresql://x", 10_000);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await runner.start("postgresql://x", 10_000);
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^migrator-job-/);
    expect(names[1]).toMatch(/^migrator-job-/);
    expect(names[0]).not.toBe(names[1]);
    expect(instanceNameFor(1234)).toBe("migrator-job-1234");
  });
});

afterEach(() => {
  vi.useRealTimers();
});
