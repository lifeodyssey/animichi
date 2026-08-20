/**
 * #1051 — the migrator's core orchestration flow.
 *
 * Pure over injected boundaries so it is unit-testable at the HTTP seam:
 * run the one-shot batch container (DSN injected), then read the applied head
 * from the ledger on a clean exit. No destructive path exists here: no schema
 * drop, no arbitrary SQL, no down-migration (spec §"Migration executor",
 * capability boundary). A platform `stopped` with no exit code is judged
 * against the expected head the trigger sent.
 */

export type ContainerOutcome =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number }
  | { kind: "unknown_exit" }
  | { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number };

export type MigrationRunResult =
  | { kind: "success"; exitCode: 0; appliedHead: string | null }
  | { kind: "failure"; exitCode: number }
  | { kind: "head_mismatch"; appliedHead: string | null; expectedHead: string | null }
  | { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number };

export interface MigrationBoundaries {
  runContainer: (dsn: string) => Promise<ContainerOutcome>;
  readAppliedHead: (dsn: string) => Promise<string | null>;
}

function mismatch(appliedHead: string | null, expectedHead: string | undefined): MigrationRunResult {
  return { kind: "head_mismatch", appliedHead, expectedHead: expectedHead ?? null };
}

async function judgeUnknownExit(
  dsn: string,
  boundaries: MigrationBoundaries,
  expectedHead: string | undefined,
): Promise<MigrationRunResult> {
  const appliedHead = await boundaries.readAppliedHead(dsn);
  if (expectedHead !== undefined && appliedHead === expectedHead) {
    return { kind: "success", exitCode: 0, appliedHead };
  }
  return mismatch(appliedHead, expectedHead);
}

/** Run the chain and report the outcome + applied head. */
export async function runMigration(
  dsn: string,
  boundaries: MigrationBoundaries,
  expectedHead?: string,
): Promise<MigrationRunResult> {
  const outcome = await boundaries.runContainer(dsn);
  if (outcome.kind === "failure") return { kind: "failure", exitCode: outcome.exitCode };
  if (outcome.kind === "timeout") return { ...outcome };
  if (outcome.kind === "unknown_exit") return judgeUnknownExit(dsn, boundaries, expectedHead);
  const appliedHead = await boundaries.readAppliedHead(dsn);
  return { kind: "success", exitCode: 0, appliedHead };
}
