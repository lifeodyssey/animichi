/**
 * #1051 — the batch-container worker-side runner + its open seam.
 *
 * Split out of `container.ts` so it stays free of @cloudflare/containers
 * (whose ESM build only resolves under workerd) and is unit-testable with a
 * fake namespace handle at plain vitest. The deployed entry wires the real
 * Container Durable Object as the handle factory.
 */

import type { ContainerOutcome } from "./migration";

/** Env var the container entrypoint reads the DSN from. */
export const MIGRATOR_DSN_ENV = "MIGRATOR_DATABASE_URL";

/** Default cap on how long a single migration container may run before the
 * worker declares it hung (raised above the longest expected apply; the
 * atlas advisory lock `atlas_migrate_execute` serializes concurrent runs). */
export const DEFAULT_CONTAINER_TIMEOUT_MS = 5 * 60 * 1000;

/** The batch-container worker binding seam. Tests inject a fake runner. */
export interface ContainerRunner {
  start(dsn: string, timeoutMs: number): Promise<ContainerOutcome>;
}

// #1101 (Option 1 §4 ) — getState() alone does NOT reset the platform activity
// timer (CF: incoming requests reset it; getState is DO RPC and only reads
// storage). renewActivityTimeout() is the documented manual reset and must be
// called once per poll so a legitimately long apply is not frozen. stop() is
// required on the timeout path so a 504 cannot pin max_instances = 1; destroy
// is the SIGKILL fallback when stop() rejects.
export interface MigrationContainerHandle {
  start(options: { envVars?: Record<string, string>; enableInternet?: boolean }): Promise<void>;
  getState(): Promise<{ status: string; exitCode?: number }>;
  stop(): Promise<void>;
  destroy?: () => Promise<void>;
  renewActivityTimeout?: () => void | Promise<void>;
}

const POLL_INTERVAL_MS = 1000;

/** #1098: bound on the platform container-start RPC. A wedged platform start
 * (image pull / scheduling hang) must fail LOUDLY, not hang the worker's
 * request forever (the trigger's curl outlives every other timeout then). */
export const START_RPC_TIMEOUT_MS = 90 * 1000;

/** #1098: per-run DO instance name so a wedged instance can never poison
 * later runs (a fixed instance name means every future /migrate RPC queues
 * behind the stuck one). The batch DO dies with its container. */
export function instanceNameFor(nowMs: number): string {
  return "migrator-job-" + String(nowMs);
}

/** #1101: bound on each stop()/destroy() cleanup call. A wedged stop RPC must
 * not hang the timeout/error flow — cleanup settles within this bound and
 * never throws (on bound expiry the caller just continues). */
export const CLEANUP_STOP_BOUND_MS = 3000;

/** Pooled timer for the cleanup bound (injectable under fake timers). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real runner over the worker's MIGRATOR_CONTAINER Durable Object binding.
 * `namespace` is the binding (`env.MIGRATOR_CONTAINER`); the durable object
 * exposes `start`/`getState` as RPC methods (cast through the narrow
 * contract interface — the platform stub type does not model them statically).
 */
export class CloudflareContainerRunner implements ContainerRunner {
  constructor(
    private readonly namespace: DurableObjectNamespace,
    private readonly instanceName = "migrator-job",
  ) {}

  private async state(stub: MigrationContainerHandle): Promise<{ status: string; exitCode?: number }> {
    return await stub.getState();
  }

  /**
   * Run the start RPC under START_RPC_TIMEOUT_MS. A wedged platform start
   * fails LOUDLY here (the caller then frees the instance slot best-effort).
   */
  private async startStub(stub: MigrationContainerHandle, dsn: string): Promise<void> {
    await Promise.race([
      stub.start({ envVars: { [MIGRATOR_DSN_ENV]: dsn } }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("container start RPC did not return within " + String(START_RPC_TIMEOUT_MS) + "ms"));
        }, START_RPC_TIMEOUT_MS);
      }),
    ]);
  }

  /**
   * One renew + getState cycle. getState() alone does not reset the platform
   * activity timer, so renewActivityTimeout() runs first when defined. On a
   * rejection this is a poll failure: free the slot best-effort, then rethrow
   * so the caller's catch surfaces a 500 (never leave a VM on max_instances=1).
   */
  private async pollOnce(
    stub: MigrationContainerHandle,
  ): Promise<{ status: string; exitCode?: number }> {
    try {
      if (stub.renewActivityTimeout !== undefined) await stub.renewActivityTimeout();
      return await this.state(stub);
    } catch (error) {
      await bestEffortStop(stub);
      throw error;
    }
  }

  async start(dsn: string, timeoutMs: number): Promise<ContainerOutcome> {
    // #1098: per-run instance identity — a wedged DO can never poison later
    // runs. (The constructor's instanceName field is kept for test seams;
    // production start() always uses a fresh per-run name.)
    const id = this.namespace.idFromName(instanceNameFor(Date.now()));
    const stub = this.namespace.get(id) as unknown as MigrationContainerHandle;
    const startedAt = Date.now();
    try {
      await this.startStub(stub, dsn);
    } catch (error) {
      // CLEANUP: the 90s start race rejected but the underlying platform start
      // is not cancelled and would otherwise occupy the max_instances=1 slot.
      await bestEffortStop(stub);
      throw error;
    }
    const deadline = Date.now() + timeoutMs;
    let state = { status: "running" };
    for (;;) {
      state = await this.pollOnce(stub);
      if (state.status === "stopped_with_code") return terminalOutcome(state);
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    // Timeout: stop() once (destroy fallback) so the slot frees; never throw a
    // 500 that hides the deadline. Default is stop() then return.
    await bestEffortStop(stub);
    return timeoutOutcome(state, startedAt);
  }
}

/** Map a stopped container's exit code onto success/failure. */
function terminalOutcome(state: { status: string; exitCode?: number }): ContainerOutcome {
  const code = state.exitCode;
  return code === 0 ? { kind: "success", exitCode: 0 } : { kind: "failure", exitCode: code ?? 1 };
}

/** Timeout outcome carrying ranMs, the last observed status, exitCode when present. */
function timeoutOutcome(
  state: { status: string; exitCode?: number },
  startedAt: number,
): ContainerOutcome {
  const base = { kind: "timeout" as const, ranMs: Date.now() - startedAt, lastStatus: state.status };
  return state.exitCode === undefined ? base : { ...base, exitCode: state.exitCode };
}

/** #1101: race a cleanup call against CLEANUP_STOP_BOUND_MS so a wedged
 * stop()/destroy() RPC can never hang the timeout/error flow. Always settles
 * within the bound and never throws. Returns true when the call rejected
 * (caller may try the destroy fallback); false when it resolved or the bound
 * expired (just continue and report the original outcome). */
async function boundedCleanup(call: () => Promise<void>): Promise<boolean> {
  try {
    await Promise.race([call(), sleep(CLEANUP_STOP_BOUND_MS)]);
    return false;
  } catch {
    return true;
  }
}

/** Best-effort stop (destroy fallback) that never throws and is bounded, so
 * slot cleanup itself can never mask the deadline or the original error. */
async function bestEffortStop(stub: MigrationContainerHandle): Promise<void> {
  if (await boundedCleanup(() => stub.stop())) {
    await bestEffortDestroy(stub);
  }
}

/** Best-effort destroy (SIGKILL) fallback when stop() rejects; bounded, never
 * throws. If the slot cannot be freed the caller still reports the original
 * outcome. */
async function bestEffortDestroy(stub: MigrationContainerHandle): Promise<void> {
  const destroy = stub.destroy;
  if (destroy === undefined) return;
  await boundedCleanup(destroy);
}
