import { fileURLToPath } from "node:url";
import { Generator, getConfig } from "@tanstack/router-generator";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Vitest globalSetup: emit `src/routeTree.gen.ts` before the suite runs.
 *
 * The TanStack Start vite plugin generates it during dev/build, but the unit
 * pool runs without that plugin, so `router.tsx` (now in the coverage sweep)
 * would fail to import the generated tree otherwise.
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
