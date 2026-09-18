import { ATLAS_LEFTOVERS_PRESENT, carriesAtlasLeftovers } from "./atlas-leftovers";
import { assertDirectDsn } from "./direct-dsn";
import type { PreflightMetadata } from "./preflight-metadata";
import { hasPrismaSnapshot, PRISMA_MIGRATIONS_DIR } from "./prisma-target";
import { migratePrisma, previewPrisma, type PrismaPreview, type PrismaReceipt } from "./prisma-control";

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
  catch { return nativeFailure("migration_unavailable"); }
}
