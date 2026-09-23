import { ATLAS_LEFTOVERS_PRESENT, carriesAtlasLeftovers } from "./atlas-leftovers";
import { assertDirectDsn } from "./direct-dsn";
import type { PreflightMetadata } from "./preflight-metadata";
import { hasPrismaSnapshot, PRISMA_MIGRATIONS_DIR } from "./prisma-target";
import { migratePrisma, previewPrisma, type PrismaPreview, type PrismaReceipt } from "./prisma-control";
import { redactedCause } from "./redacted-cause";

/**
 * The migrator's whole apply path. One authority — the Prisma migration graph — decides what
 * runs, in what order, inside which transaction, and what the database's marker becomes
 * (#1634). The Worker's job is narrower than it used to be: refuse a request this bundle
 * cannot satisfy BEFORE any SQL, then let Prisma apply and report what it did.
 */

export type MigrationResult =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number; error?: string }
  /** Nothing was applied: this bundle cannot satisfy the request. */
  | { kind: "refused"; reason: string };

export type SelectedMetadata = PreflightMetadata & { expectedPrismaRef: string };
export type SelectedPreflight =
  | { compatible: true; prisma: PrismaPreview }
  | { compatible: false; error: string };
export type SelectedMigration = MigrationResult & {
  prisma?: PrismaReceipt;
  /** A public native code or a local stable code; never a driver message. */
  failureCode?: string;
  /**
   * Why a THROWN failure threw, already through `redactedCause` (#1868). Handled outcomes —
   * `refused`, a native failure code, `prisma_marker_mismatch` — carry their identity in
   * `failureCode` and leave this absent, so its presence is itself the "something threw" fact.
   */
  cause?: string;
};
export interface SelectedExecutor {
  preflight(dsn: string, metadata: SelectedMetadata): Promise<SelectedPreflight>;
  migrate(dsn: string, metadata: SelectedMetadata): Promise<SelectedMigration>;
}

async function checkSelected(dsn: string, metadata: SelectedMetadata, directory: string): Promise<SelectedPreflight> {
  assertDirectDsn(dsn);
  if (!await hasPrismaSnapshot(metadata.expectedPrismaRef, directory)) {
    return { compatible: false, error: "stale_prisma_bundle" };
  }
  if (await carriesAtlasLeftovers(dsn)) return { compatible: false, error: ATLAS_LEFTOVERS_PRESENT };
  const native = await previewPrisma(dsn, metadata.expectedPrismaRef, directory);
  return native.ok ? { compatible: true, prisma: native.value } : { compatible: false, error: native.error };
}

/** Both routes call this inside the same fixed Durable Object gate. */
export async function preflightSelected(dsn: string, metadata: SelectedMetadata, directory = PRISMA_MIGRATIONS_DIR): Promise<SelectedPreflight> {
  try { return await checkSelected(dsn, metadata, directory); }
  catch { return { compatible: false, error: "preflight_unavailable" }; }
}

function nativeFailure(code: string): SelectedMigration {
  return { kind: "failure", exitCode: 1, error: code, failureCode: code };
}

/**
 * The apply threw rather than reporting an outcome. The class keeps its public name; what
 * changes is that the one fact an operator needs — what threw — survives the catch (#1868).
 * Logged as well as returned, because the answer itself can be lost on the way out.
 */
function thrownDuringApply(error: unknown): SelectedMigration {
  const cause = redactedCause(error);
  console.error(`[migrator] apply threw: ${cause}`);
  return { ...nativeFailure("migration_unavailable"), cause };
}

async function applySelected(dsn: string, metadata: SelectedMetadata, directory: string): Promise<SelectedMigration> {
  const preview = await checkSelected(dsn, metadata, directory);
  if (!preview.compatible) return { kind: "refused", reason: preview.error };
  const native = await migratePrisma(dsn, metadata.expectedPrismaRef, directory);
  if (!native.ok) return nativeFailure(native.error);
  if (native.value.markerHash !== metadata.expectedPrismaRef) return nativeFailure("prisma_marker_mismatch");
  return { kind: "success", exitCode: 0, prisma: native.value };
}

/** Recheck the identity after acquiring the lock; a prior preview is no authority. */
export async function migrateSelected(dsn: string, metadata: SelectedMetadata, directory = PRISMA_MIGRATIONS_DIR): Promise<SelectedMigration> {
  try { return await applySelected(dsn, metadata, directory); }
  catch (error) { return thrownDuringApply(error); }
}
