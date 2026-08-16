import { vi } from "vitest";
import { CloudflareContainerRunner, type MigrationContainerHandle } from "../src/runner";

// #1101 (PR 2) — shared fakes + timer drivers for the runner unit tests so
// runner.test.ts stays within the per-file line budget. Fakes drive time with
// vi.useFakeTimers(); tests assert outcomes, never wall-clock values.

export interface FakeState {
  status: string;
  exitCode?: number;
}

export interface FakeCalls {
  start: number;
  stop: number;
  renew: number;
  destroy: number;
}

export interface FakeSlot {
  calls: FakeCalls;
  /** Mutable runtime observations (start writes env/started here). */
  slot: { started: boolean; env: Record<string, string> };
  handle: MigrationContainerHandle;
  namespace: DurableObjectNamespace;
  runner: CloudflareContainerRunner;
}

// A fake namespace/handle with counting start/getState/stop/destroy/renew.
// start records the env and resolves; stop/destroy/renew count and resolve.
// Pass overrides to re-seat any method (e.g. a rejecting stop or a throwing
// getState) for the timeout and cleanup variants.
export function fakeSlot(state: FakeState, overrides: Partial<MigrationContainerHandle> = {}): FakeSlot {
  const calls: FakeCalls = { start: 0, stop: 0, renew: 0, destroy: 0 };
  const runtime: { started: boolean; env: Record<string, string> } = { started: false, env: {} };
  const handle: MigrationContainerHandle = {
    start: (options: { envVars?: Record<string, string> }): Promise<void> => {
      calls.start += 1;
      runtime.env = options.envVars ?? {};
      runtime.started = true;
      return Promise.resolve();
    },
    getState: (): Promise<FakeState> => Promise.resolve(state),
    stop: (): Promise<void> => {
      calls.stop += 1;
      return Promise.resolve();
    },
    renewActivityTimeout: (): Promise<void> => {
      calls.renew += 1;
      return Promise.resolve();
    },
    ...overrides,
  };
  const namespace = {
    idFromName: (): string => "id",
    get: () => (handle as unknown),
  } as unknown as DurableObjectNamespace;
  return { calls, slot: runtime, handle, namespace, runner: new CloudflareContainerRunner(namespace) };
}

// Drive a runner.start to completion under fake timers, advancing `advanceMs`
// so poll sleeps and the start-RPC race fire deterministically. Returns either
// the resolved value or a captured rejection (never throws).
export async function driveStart(
  runner: CloudflareContainerRunner,
  dsn: string,
  timeoutMs: number,
  advanceMs: number,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  vi.useFakeTimers();
  const pending = runner.start(dsn, timeoutMs);
  // Attach the handler before advancing so a rejection mid-advance is never
  // reported as unhandled (same pattern as the original wedged-start test).
  const settled = settle(pending);
  await vi.advanceTimersByTimeAsync(advanceMs);
  return await settled;
}

export interface SlotCounters {
  startCalls: number;
  stopCalls: number;
}

// A max_instances=1 model: an un-stopped instance occupies the only slot, so a
// start() while one is running rejects with a 503. stop() frees the slot.
export function slotNamespace(): {
  counters: SlotCounters;
  namespace: DurableObjectNamespace;
  runner: CloudflareContainerRunner;
} {
  let running = false;
  const counters: SlotCounters = { startCalls: 0, stopCalls: 0 };
  const handle: MigrationContainerHandle = {
    start: (): Promise<void> => {
      counters.startCalls += 1;
      if (running) return Promise.reject(new Error("503: instance slot already occupied"));
      running = true;
      return Promise.resolve();
    },
    getState: (): Promise<FakeState> => Promise.resolve({ status: running ? "running" : "stopped" }),
    stop: (): Promise<void> => {
      counters.stopCalls += 1;
      running = false;
      return Promise.resolve();
    },
  };
  const namespace = {
    idFromName: (): string => "id",
    get: () => (handle as unknown),
  } as unknown as DurableObjectNamespace;
  return { counters, namespace, runner: new CloudflareContainerRunner(namespace) };
}

// Capture a promise as {ok,value} / {ok:false,message} instead of a throw.
export async function settle<T>(
  pending: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  return await pending.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, message: String(error instanceof Error ? error.message : error) }),
  );
}
