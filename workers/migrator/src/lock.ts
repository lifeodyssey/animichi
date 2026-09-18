import type { SelectedExecutor, SelectedMetadata, SelectedMigration, SelectedPreflight } from "./selected-migration";

/** Fixed-name Durable Object mutex (not per-run `migrator-job-*`). */
export const APPLY_LOCK_NAME = "migrator-apply-lock";

export interface ApplyLock {
  runExclusive<T>(work: () => Promise<T>): Promise<T>;
}

/** In-process mutex for tests. No wall clock; waiters chain on promises. */
export class QueueLock implements ApplyLock {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(swallow, swallow);
    return run;
  }
}

function swallow(): undefined {
  return undefined;
}

interface SelectedStub {
  preflight(dsn: string, metadata: SelectedMetadata): Promise<SelectedPreflight>;
  migrate(dsn: string, metadata: SelectedMetadata): Promise<SelectedMigration>;
}

/**
 * The selected migration's complete metadata crosses the fixed Durable Object RPC;
 * there is no unbounded apply request on the production path.
 */
export function productionSelected(namespace: DurableObjectNamespace): SelectedExecutor {
  const stub = namespace.get(namespace.idFromName(APPLY_LOCK_NAME)) as unknown as SelectedStub;
  return { preflight: (dsn, metadata) => stub.preflight(dsn, metadata), migrate: (dsn, metadata) => stub.migrate(dsn, metadata) };
}
