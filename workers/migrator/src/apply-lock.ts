import { productionChain } from "./bundled-chain";
import { applyChain } from "./http-apply";
import type { ContainerOutcome } from "./migration";
import { neonClient } from "./sql";

/**
 * Fixed-name Durable Object mutex for Option 2 HTTP apply. Incoming `run`
 * RPCs are serialized with `blockConcurrencyWhile` (input gate plus an
 * explicit hold). One-shot container instance names cannot serialize applies.
 */
export class MigratorApplyLock {
  constructor(private readonly ctx: DurableObjectState) {}

  async run(dsn: string): Promise<ContainerOutcome> {
    return this.ctx.blockConcurrencyWhile(() => applyWithBundle(dsn));
  }
}

function applyWithBundle(dsn: string): Promise<ContainerOutcome> {
  return applyChain({ dsn, source: productionChain, connect: neonClient, now: () => new Date() });
}
