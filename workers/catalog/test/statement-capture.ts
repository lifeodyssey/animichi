/**
 * A Prisma seam that records every statement its runtime sends to Postgres: the
 * count a round-trip assertion reads.
 *
 * The production serverless client builds its own `pg.Client` with no seam to
 * record, but it takes middleware, and `beforeQuery` runs after the plan is
 * lowered to SQL and before the driver sends it (the capture
 * `outbound-adapters.integration.test.ts` and `nearby-plan.ts` use). `pg` sends
 * each statement as one Parse/Bind/Execute/Sync batch and reads its answer, so
 * one recorded statement is one round trip. Plans built on the shared catalog
 * client run here because the runtime matches a plan by its contract's storage
 * hash, which both clients read from the same contract.
 *
 * The seam is `catalogPrisma` over that runtime, so a transaction is a real one,
 * as in the Worker.
 */
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import postgresServerless from "@prisma/orm-postgres/serverless";
import { catalogPrisma, type CatalogPrisma } from "../src/db/prisma";

export interface StatementCapture {
  /** The seam to hand the code under test. */
  readonly prisma: CatalogPrisma;
  /** Every statement the runtime has sent so far, as SQL text, in order. */
  statements(): readonly string[];
  close(): Promise<void>;
}

/** Open a capturing runtime against `dsn`; the caller closes it. */
export async function openStatementCapture(dsn: string): Promise<StatementCapture> {
  const recorded: string[] = [];
  const client = postgresServerless<Contract>({
    contractJson,
    extensions: [geographyRuntimeDescriptor],
    middleware: [{
      name: "statement-capture",
      beforeQuery: (plan: { sql: string }) => {
        recorded.push(plan.sql);
      },
    }],
  });
  const runtime = await client.connect({ url: dsn });
  return {
    prisma: catalogPrisma(runtime),
    statements: () => [...recorded],
    close: async () => { await runtime[Symbol.asyncDispose](); },
  };
}
