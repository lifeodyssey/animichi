import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRISMA_TARGET } from "../src/prisma-target";

/** The sealed native graph this repository ships, as the deployed bundle carries it. */
export const MIGRATIONS = fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/migrations"));
export const TARGET = PRISMA_TARGET;
/** The sealed graph's length, counted from the checked-in migrations — count assertions pin
 * this, never a literal that drifts with the next migration. */
const APP_MIGRATION_DIRECTORIES = readdirSync(`${MIGRATIONS}/app`, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
export const APP_MIGRATION_COUNT = APP_MIGRATION_DIRECTORIES.length;

/** How many operations the first migration executes, read from its own emitted graph — a
 * literal here would drift with the next operation the baseline gains. */
export const BASELINE_OPERATION_COUNT = (
  JSON.parse(readFileSync(`${MIGRATIONS}/app/${APP_MIGRATION_DIRECTORIES[0] ?? ""}/ops.json`, "utf8")) as unknown[]
).length;
/** A complete migration request: one schema identity plus the staging-only baseline flag. */
export const requestMetadata = { stagingOnlyBaseline: false, expectedPrismaRef: TARGET };
