/**
 * The Prisma control calls behind preview and apply, imported only through `prisma-first-use.ts`.
 *
 * A dynamic import keeps the whole namespace it names. Importing Prisma's modules that way kept code
 * the Worker never calls, Prisma 7's contract provider among it, and added 278 KiB to the upload;
 * these named re-exports let esbuild leave it out. A static import of this file evaluates Prisma at
 * startup.
 */
export { createPostgresControlClient } from "@prisma/orm-postgres/control";
export { default as geographyExtensionDescriptor } from "@animichi/prisma-geography/control";
export { defineConfig } from "@prisma/orm-postgres/config";
export { executeMigrateShowPlan } from "@prisma/orm-toolchain/cli/control-api";
