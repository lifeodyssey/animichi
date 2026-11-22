/**
 * The values Prisma rc.24's control API answers the migrator with, built from rc.24's own types
 * and constructors so a double cannot drift from the API it stands for.
 *
 * A reported failure is a real `CliStructuredError`: `structuredError` from the facade, then
 * `errorFromCaught`, the toolchain's own path from a library error to the error a command reports.
 * A show-plan success carries exactly the `MigrateShowPlanSuccess` fields the migrator reads, so a
 * field rc.24 renamed or removed (`renderMarkerHashBySpace`, `usedLiveMarker`) is a type error here.
 */
import { errorFromCaught, type MigrateShowMigration, type MigrateShowPlanSuccess } from "@prisma/orm-toolchain/cli/control-api";
import { structuredError, type StructuredErrorOptions } from "@prisma/orm-postgres/utils/structured-error";
import type { PrismaReceipt } from "../src/prisma-control";
import { TARGET } from "./sealed-migrations";

/** The one failure shape both control operations report since rc.19. */
export function reportedFailure(code: `${string}.${string}`, summary: string, options: StructuredErrorOptions = {}) {
  return { ok: false as const, failure: errorFromCaught(structuredError(code, summary, options), () => summary) };
}

type ShownFields = Pick<MigrateShowPlanSuccess, "migrations" | "databaseMarkerHashBySpace">;

/** A preview that read the database: its app space's live marker, or `empty` for an unsigned one. */
export function shownPlan(appMarker: string, migrations: readonly MigrateShowMigration[] = []) {
  const value: ShownFields = { migrations, databaseMarkerHashBySpace: new Map([["app", appMarker]]) };
  return { ok: true as const, value };
}

/** A preview that never read the database, so it names no live marker. */
export function offlinePlan() {
  const value: ShownFields = { migrations: [] };
  return { ok: true as const, value };
}

/** The first edge of the sealed graph, as a preview of an empty database lists it. */
export const BASELINE_EDGE: MigrateShowMigration = {
  spaceId: "app", dirName: "20260913T1711_data_plane_baseline", migrationHash: "a".repeat(64), from: "empty", to: TARGET,
};

/** The receipt fields the migrator reads and publishes from a successful apply. */
export function appliedReceipt(markerHash: string) {
  const value: Pick<PrismaReceipt, "markerHash" | "migrationsApplied" | "applied"> = { markerHash, migrationsApplied: 0, applied: [] };
  return { ok: true as const, value };
}
