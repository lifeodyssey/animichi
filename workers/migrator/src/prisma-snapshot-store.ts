/**
 * The sealed-snapshot reads the migrator calls, imported only through `prisma-first-use.ts`.
 *
 * A dynamic import keeps the whole namespace it names, so the migrator imports this slice rather
 * than Prisma's module: these named re-exports let esbuild leave out what the Worker never calls.
 * A static import of this file evaluates Prisma at startup.
 */
export { readContractSnapshotJson, readContractSnapshotJsonTolerant } from "@prisma/orm-postgres/migration-tools/contract-snapshot-store";
