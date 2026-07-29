import { fileURLToPath } from "node:url";
import { Generator, getConfig } from "@tanstack/router-generator";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Emit `src/routeTree.gen.ts`. Used as the vitest globalSetup and, via the
 * `routes:generate` script, by `lint:oxlint` and `typecheck`.
 *
 * The TanStack Start vite plugin generates it during dev/build, but the unit
 * pool runs without that plugin and a fresh checkout has never built, so both
 * the suite and the type-aware gates would otherwise see an unresolved import.
 */
export default async function setup(): Promise<void> {
  const config = getConfig(
    {
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    },
    appRoot,
  );
  await new Generator({ config, root: appRoot }).run();
}

if (import.meta.main) await setup();
