/**
 * #1051 — the migrator's core orchestration flow.
 *
 * Pure over injected boundaries so it is unit-testable at the HTTP seam:
 * run the one-shot batch container (DSN injected), then read the applied head
 * from the ledger on a clean exit. No destructive path exists here: no schema
 * drop, no arbitrary SQL, no down-migration (spec §"Migration executor",
 * capability boundary).
 */

export type ContainerOutcome =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number }
  | { kind: "timeout" };

export type MigrationRunResult =
  | { kind: "success"; exitCode: 0; appliedHead: string | null }
  | { kind: "failure"; exitCode: number }
  | { kind: "timeout" };

export interface MigrationBoundaries {
  runContainer: (dsn: string) => Promise<ContainerOutcome>;
  readAppliedHead: (dsn: string) => Promise<string | null>;
}

/** Run the chain and report the outcome + applied head. */
export async function runMigration(
  dsn: string,
  boundaries: MigrationBoundaries,
): Promise<MigrationRunResult> {
  const outcome = await boundaries.runContainer(dsn);
  if (outcome.kind === "failure") return { kind: "failure", exitCode: outcome.exitCode };
  if (outcome.kind === "timeout") return { kind: "timeout" };
  const appliedHead = await boundaries.readAppliedHead(dsn);
  return { kind: "success", exitCode: 0, appliedHead };
}
