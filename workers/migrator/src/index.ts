// #1051 — migrator Worker composition root (wrangler main). Wires the default
// deps (GitHub JWKS verifier + one-shot container runner) and exports the
// MigrationContainer Durable Object class for the wrangler container binding.
import { createMigratorApp } from "./create-app";
import { MigrationContainer } from "./container";

export { MigrationContainer };
export { createMigratorApp, type Env, type MigratorDeps } from "./create-app";
export { MIGRATOR_DSN_ENV } from "./runner";

export default createMigratorApp();