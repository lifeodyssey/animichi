import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareContainerRunner,
  MIGRATOR_DSN_ENV,
  instanceNameFor,
  type MigrationContainerHandle,
} from "../src/runner";

// #1051 — the batch-container runner's exit/timeout mapping, exercised against
// a fake Durable Object namespace (no timing asserts; the runner's poll loop
// is the unit under test, driven by scripted state transitions).
function fakeNamespace(state: { status: string; exitCode?: number }) {
  const handle: MigrationContainerHandle = {
    start: (options: { envVars?: Record<string, string> }): Promise<void> => {
      seenEnv = options.envVars ?? {};
      started = true;
      return Promise.resolve();
    },
    getState: (): Promise<{ status: string; exitCode?: number }> => Promise.resolve(state),
  };
  const stub = handle as unknown;
  return {
    idFromName: () => "id",
    get: () => stub,
  } as unknown as DurableObjectNamespace;
}

let started = false;
let seenEnv: Record<string, string> = {};

describe("CloudflareContainerRunner", () => {
  beforeEach(() => {
    started = false;
    seenEnv = {};
  });

  it("injects the DSN as MIGRATOR_DATABASE_URL when starting", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code", exitCode: 0 }),
    );
    await runner.start("postgresql://migrator:x@db/neondb", 10_000);
    expect(started).toBe(true);
    expect(seenEnv[MIGRATOR_DSN_ENV]).toBe("postgresql://migrator:x@db/neondb");
  });

  it("maps a clean exit to success", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code", exitCode: 0 }),
    );
    await expect(runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "success", exitCode: 0 });
  });

  it("maps a non-zero exit to failure with the exit code", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code", exitCode: 7 }),
    );
    await expect(runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "failure", exitCode: 7 });
  });

  it("maps a missing exit code on a stopped container to a failure with a default code", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "stopped_with_code" }),
    );
    await expect(runner.start("postgresql://x", 10_000)).resolves.toEqual({ kind: "failure", exitCode: 1 });
  });

  it("reports timeout when the container never reaches a terminal state", async () => {
    const runner = new CloudflareContainerRunner(
      fakeNamespace({ status: "running" }),
    );
    // timeoutMs effectively zero: the runner's poll deadline expires immediately.
    await expect(runner.start("postgresql://x", 0)).resolves.toEqual({ kind: "timeout" });
  });

});

describe("#1098 hardening: bounded start RPC + per-run DO instance", () => {
  it("fails loudly when the platform start RPC never returns", async () => {
    vi.useFakeTimers();
    const namespace = {
      idFromName: () => "id",
      get: () => ({
        start: (): Promise<void> => new Promise<void>(() => undefined), // never resolves
        getState: (): Promise<{ status: string; exitCode?: number }> => Promise.resolve({ status: "running" }),
      }),
    } as unknown as DurableObjectNamespace;
    const runner = new CloudflareContainerRunner(namespace);
    const pending = runner.start("postgresql://x", 10_000);
    const settled = pending.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, message: String(error instanceof Error ? error.message : error) }),
    );
    // Advance past the START_RPC_TIMEOUT_MS bound: the wedged start must
    // reject loudly instead of hanging.
    await vi.advanceTimersByTimeAsync(90_000 + 1_000);
    const result = await settled;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the wedged start RPC to reject");
    expect(result.message).toContain("container start RPC did not return");
    vi.useRealTimers();
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
        getState: (): Promise<{ status: string; exitCode?: number }> => Promise.resolve({ status: "stopped_with_code", exitCode: 0 }),
      }),
    } as unknown as DurableObjectNamespace;
    const runner = new CloudflareContainerRunner(namespace);
    await runner.start("postgresql://x", 10_000);
    // Distinct instances require distinct epoch-ms names; a 2ms wait between
    // calls guarantees that without asserting on any clock value.
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