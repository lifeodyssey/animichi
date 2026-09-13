/**
 * #1051 — the migrator's core orchestration flow.
 *
 * Pure over injected boundaries so it is unit-testable at the HTTP seam:
 * apply the selected chain, then read the applied head. No
 * destructive path exists here: no schema drop, no arbitrary SQL, no
 * down-migration (spec §"Migration executor", capability boundary).
 */

import type { PreflightMetadata } from "./preflight-metadata";

export type ApplyOutcome =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number; error?: string }
  /** Nothing was applied: this bundle and ledger cannot satisfy the request. */
  | { kind: "refused"; reason: string };

export type MigrationResult =
  | { kind: "success"; exitCode: 0; appliedHead: string | null; pathVerification: "verified" }
  | { kind: "failure"; exitCode: number; error?: string }
  | { kind: "refused"; reason: string };

export type BoundedChainApply = (dsn: string, metadata: PreflightMetadata) => Promise<ApplyOutcome>;

export interface ApplyBoundaries {
  applyChain: BoundedChainApply;
  readAppliedHead: (dsn: string) => Promise<string | null>;
}

function failOf(outcome: Extract<ApplyOutcome, { kind: "failure" }>): MigrationResult {
  if (outcome.error === undefined) return { kind: "failure", exitCode: outcome.exitCode };
  return { kind: "failure", exitCode: outcome.exitCode, error: outcome.error };
}

function succeeded(appliedHead: string | null): MigrationResult {
  return { kind: "success", exitCode: 0, appliedHead, pathVerification: "verified" };
}

/** Apply the bounded chain and report its settled ledger head. */
export async function applyMigration(
  dsn: string,
  boundaries: ApplyBoundaries,
  metadata: PreflightMetadata,
): Promise<MigrationResult> {
  const outcome = await boundaries.applyChain(dsn, metadata);
  if (outcome.kind === "failure") return failOf(outcome);
  if (outcome.kind === "refused") return { ...outcome };
  return succeeded(await boundaries.readAppliedHead(dsn));
}
