import type { SelectedExecutor, SelectedMetadata, SelectedMigration, SelectedPreflight } from "./selected-migration";
import type { RuntimeRolePasswords } from "./service-roles";

/** Fixed-name Durable Object mutex (not per-run `migrator-job-*`). */
export const APPLY_LOCK_NAME = "migrator-apply-lock";

export interface ApplyLock {
  runExclusive<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * The apply gate itself: `MigratorApplyLock` holds one of these, and the disposable-PostgreSQL
 * fixture holds another in place of the Durable Object, so the double and the deployed object
 * serialize through the same class rather than through two different mechanisms (#1868).
 * No wall clock; waiters chain on promises, so nothing here bounds how long a migration runs.
 */
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
  migrate(dsn: string, passwords: RuntimeRolePasswords, metadata: SelectedMetadata): Promise<SelectedMigration>;
}

/**
 * The selected migration's complete metadata crosses the fixed Durable Object RPC;
 * there is no unbounded apply request on the production path. The runtime role passwords
 * cross with it (#1915): the provisioning step they feed runs inside the same gate.
 */
export function productionSelected(namespace: DurableObjectNamespace): SelectedExecutor {
  const stub = namespace.get(namespace.idFromName(APPLY_LOCK_NAME)) as unknown as SelectedStub;
  return {
    preflight: (dsn, metadata) => stub.preflight(dsn, metadata),
    migrate: (dsn, passwords, metadata) => stub.migrate(dsn, passwords, metadata),
  };
}
