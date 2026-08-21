/**
 * #1051 — the migrator's core orchestration flow.
 *
 * Pure over injected boundaries so it is unit-testable at the HTTP seam:
 * snapshot the ledger (a missing ledger at start is a legal pre-state), run
 * the one-shot batch container (DSN injected), then read the applied head
 * again. No destructive path exists here: no schema
 * drop, no arbitrary SQL, no down-migration (spec §"Migration executor",
 * capability boundary). A platform `stopped` with no exit code is judged
 * against expected head plus whether this run advanced the ledger.
 */

export type ContainerOutcome =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number }
  | { kind: "unknown_exit" }
  | { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number };

export type PathVerification = "verified" | "unverified";

export type MigrationRunResult =
  | { kind: "success"; exitCode: 0; appliedHead: string | null; pathVerification: PathVerification }
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

function succeeded(appliedHead: string | null, pathVerification: PathVerification): MigrationRunResult {
  return { kind: "success", exitCode: 0, appliedHead, pathVerification };
}

function unknownExitProof(preHead: string | null, postHead: string | null): PathVerification {
  return preHead === postHead ? "unverified" : "verified";
}

/** Pre-run ledger snapshot. A missing ledger is a legal starting state, not a failure. */
async function snapshotPreRunHead(
  dsn: string,
  boundaries: MigrationBoundaries,
): Promise<string | null> {
  try {
    return await boundaries.readAppliedHead(dsn);
  } catch {
    return null;
  }
}

async function judgeUnknownExit(
  dsn: string,
  boundaries: MigrationBoundaries,
  expectedHead: string | undefined,
  preHead: string | null,
): Promise<MigrationRunResult> {
  const postHead = await boundaries.readAppliedHead(dsn);
  if (expectedHead === undefined || postHead !== expectedHead) return mismatch(postHead, expectedHead);
  return succeeded(postHead, unknownExitProof(preHead, postHead));
}

/** Run the chain and report the outcome + applied head. */
export async function runMigration(
  dsn: string,
  boundaries: MigrationBoundaries,
  expectedHead?: string,
): Promise<MigrationRunResult> {
  const preHead = await snapshotPreRunHead(dsn, boundaries);
  const outcome = await boundaries.runContainer(dsn);
  if (outcome.kind === "failure") return { kind: "failure", exitCode: outcome.exitCode };
  if (outcome.kind === "timeout") return { ...outcome };
  if (outcome.kind === "unknown_exit") return judgeUnknownExit(dsn, boundaries, expectedHead, preHead);
  return succeeded(await boundaries.readAppliedHead(dsn), "verified");
}
