import { ATLAS_LEFTOVERS_PRESENT, carriesAtlasLeftovers } from "./atlas-leftovers";
import { assertDirectDsn } from "./direct-dsn";
import type { PreflightMetadata } from "./preflight-metadata";
import { hasPrismaSnapshot, PRISMA_MIGRATIONS_DIR } from "./prisma-target";
import { migratePrisma, previewPrisma, type NativeFailure, type NativeResult, type PrismaPreview, type PrismaReceipt } from "./prisma-control";
import { redactedCause } from "./redacted-cause";
import { provisionServiceRoles, type RuntimeRolePasswords } from "./service-roles";

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
   * Why the apply failed, already through `redactedCause`: what a THROWN failure threw (#1868),
   * or what Prisma REPORTED beyond its failure code (#1891). Outcomes that state nothing beyond
   * their identity — `refused`, a code-only native failure, `prisma_marker_mismatch` — carry it
   * in `failureCode` and leave this absent.
   */
  cause?: string;
};
export interface SelectedExecutor {
  preflight(dsn: string, metadata: SelectedMetadata): Promise<SelectedPreflight>;
  migrate(dsn: string, passwords: RuntimeRolePasswords, metadata: SelectedMetadata): Promise<SelectedMigration>;
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
 * #1915 — the service roles are this Worker's to provision, by SQL, before the chain's
 * precheck can assume them. A failure here is its own verdict: the chain must not run, and
 * the cause crossed `redactedCause` first because the statements it may quote carry the
 * runtime roles' passwords.
 */
async function provisionRoles(dsn: string, passwords: RuntimeRolePasswords): Promise<SelectedMigration | undefined> {
  try {
    await provisionServiceRoles(dsn, passwords);
    return undefined;
  } catch (error) {
    const cause = redactedCause(error);
    console.error(`[migrator] service role provisioning failed: ${cause}`);
    return { ...nativeFailure("service_role_provisioning_failed"), cause };
  }
}

/**
 * Prisma REPORTED this failure rather than throwing: the runner reached a verdict and the
 * control client handed its fields back as structure (#1891). `cause` crossed `redactedCause`
 * at the control boundary, so the log line and the returned field carry the same redacted text;
 * logged as well as returned, because the answer itself can be lost on the way out.
 */
function reportedDuringApply(native: NativeFailure<PrismaReceipt>): SelectedMigration {
  if (native.cause === undefined) return nativeFailure(native.error);
  console.error(`[migrator] apply failed: ${native.cause}`);
  return { ...nativeFailure(native.error), cause: native.cause };
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

function receiptOf(native: NativeResult<PrismaReceipt>, expectedRef: string): SelectedMigration {
  if (!native.ok) return reportedDuringApply(native);
  if (native.value.markerHash !== expectedRef) return nativeFailure("prisma_marker_mismatch");
  return { kind: "success", exitCode: 0, prisma: native.value };
}

async function applySelected(dsn: string, passwords: RuntimeRolePasswords, metadata: SelectedMetadata, directory: string): Promise<SelectedMigration> {
  const preview = await checkSelected(dsn, metadata, directory);
  if (!preview.compatible) return { kind: "refused", reason: preview.error };
  const provisioning = await provisionRoles(dsn, passwords);
  if (provisioning !== undefined) return provisioning;
  return receiptOf(await migratePrisma(dsn, metadata.expectedPrismaRef, directory), metadata.expectedPrismaRef);
}

/** Recheck the identity after acquiring the lock; a prior preview is no authority. */
export async function migrateSelected(dsn: string, passwords: RuntimeRolePasswords, metadata: SelectedMetadata, directory = PRISMA_MIGRATIONS_DIR): Promise<SelectedMigration> {
  try { return await applySelected(dsn, passwords, metadata, directory); }
  catch (error) { return thrownDuringApply(error); }
}
