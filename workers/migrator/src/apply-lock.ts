import { DurableObject } from "cloudflare:workers";
import { QueueLock } from "./lock";
import { migrateSelected, preflightSelected, type SelectedMetadata, type SelectedMigration, type SelectedPreflight } from "./selected-migration";
import type { RuntimeRolePasswords } from "./service-roles";

/**
 * Fixed-name Durable Object mutex for HTTP apply. One-shot container instance names cannot
 * serialize applies. The class must `extends DurableObject` or workerd rejects stub calls as
 * non-RPC (staging migrate 2026-08-21, HTTP 500 after #1125).
 *
 * The gate is this object's own `QueueLock`, not `blockConcurrencyWhile` (#1868). The platform
 * caps that callback at 30 seconds and RESETS the object when it is exceeded — so a migration
 * longer than half a minute could not finish, and staging died at 31 s on 2026-09-22 with the
 * reset message in the logs. Nothing else about the construct was needed: the object is a
 * single instance under one fixed name, so one in-process queue serializes every caller, and
 * the object stays live for as long as an RPC is in flight, which is what bounds an apply now.
 *
 * The queue is instance state, so it is empty again if the object is evicted between requests
 * — which is exactly right: with no apply in flight there is nothing left to serialize.
 *
 * `SessionAgent.withSession` in `workers/edge` reached the same shape for the same reason: a
 * promise chain inside the object, because a Durable Object's own single thread does not
 * survive an `await`, and `blockConcurrencyWhile` costs more than it buys.
 */
export class MigratorApplyLock extends DurableObject {
  readonly #applies = new QueueLock();

  preflight(dsn: string, metadata: SelectedMetadata): Promise<SelectedPreflight> {
    return this.#applies.runExclusive(() => preflightSelected(dsn, metadata));
  }

  migrate(dsn: string, passwords: RuntimeRolePasswords, metadata: SelectedMetadata): Promise<SelectedMigration> {
    return this.#applies.runExclusive(() => migrateSelected(dsn, passwords, metadata));
  }
}
