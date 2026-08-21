import type { ContainerOutcome } from "./migration";

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

interface ApplyStub {
  run(dsn: string): Promise<ContainerOutcome>;
}

export function productionApply(namespace: DurableObjectNamespace): (dsn: string) => Promise<ContainerOutcome> {
  const stub = namespace.get(namespace.idFromName(APPLY_LOCK_NAME)) as unknown as ApplyStub;
  return (dsn) => stub.run(dsn);
}
