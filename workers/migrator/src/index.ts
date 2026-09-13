// #1051 / #1124 / #1589 — migrator Worker composition root (wrangler main).
// Wires the bounded HTTP apply and the fixed-name lock Durable Object.
import { createMigratorApp } from "./create-app";
import { MigratorApplyLock } from "./apply-lock";

export { MigratorApplyLock };
export { createMigratorApp, type Env, type MigratorDeps } from "./create-app";

export default createMigratorApp();
