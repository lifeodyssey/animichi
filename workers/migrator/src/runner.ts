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

/**
 * The subset of the Cloudflare Container Durable Object the migrator runner
 * drives. The real binding's stub exposes these as RPC methods; the worker's
 * container class (MigrationContainer) implements them.
 */
export interface MigrationContainerHandle {
  start(options: { envVars?: Record<string, string>; enableInternet?: boolean }): Promise<void>;
  getState(): Promise<{ status: string; exitCode?: number }>;
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

  async start(dsn: string, timeoutMs: number): Promise<ContainerOutcome> {
    // #1098: per-run instance identity — a wedged DO can never poison later
    // runs. (The constructor's instanceName field is kept for test seams;
    // production start() always uses a fresh per-run name.)
    const id = this.namespace.idFromName(instanceNameFor(Date.now()));
    const stub = this.namespace.get(id) as unknown as MigrationContainerHandle;
    await Promise.race([
      stub.start({ envVars: { [MIGRATOR_DSN_ENV]: dsn } }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("container start RPC did not return within " + String(START_RPC_TIMEOUT_MS) + "ms"));
        }, START_RPC_TIMEOUT_MS);
      }),
    ]);
    const deadline = Date.now() + timeoutMs;
    // Poll the container state until it exits or the caller's timeout expires.
    for (;;) {
      const state = await this.state(stub);
      if (state.status === "stopped_with_code") {
        const code = state.exitCode;
        return code === 0 ? { kind: "success", exitCode: 0 } : { kind: "failure", exitCode: code ?? 1 };
      }
      if (Date.now() >= deadline) return { kind: "timeout" };
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}
