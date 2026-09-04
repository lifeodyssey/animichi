/**
 * The modules `workers/edge` reads at RUNTIME must stay free of runtime
 * imports (issue #1285).
 *
 * The edge Worker is bundled: a single value import from a module that imports
 * zod drags all 79 of zod's files into every isolate it starts, which is what
 * `AGENT_PATHS` and `DEFAULT_IDENTITY_POLICY` did before they were extracted
 * into their own modules. `workers/edge/bundle-smoke/entry-bundle.test.ts`
 * measures the built artifact; this gate fails one package earlier, on the
 * line that would cause it, and says which module lost the property.
 *
 * A type-only import is allowed: TypeScript erases it, so it reaches no
 * bundle.
 *
 * test-type: unit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every contract module `workers/edge/src` takes a VALUE from. `jwt.ts` and
 * `oidc-github.ts` are the deliberate exceptions: they import jose, which the
 * Worker's own identity code loads anyway, so no bundle grows for them.
 */
const WORKER_READ_MODULES = [
  "src/agent-paths.ts",
  "src/agent-tool-schemas.ts",
  "src/constants.ts",
  "src/identity-policy.ts",
  "src/internal-binding.ts",
];

/** The `import`/`export … from` statements a module executes at load time. */
function runtimeImports(module: string): string[] {
  const source = readFileSync(new URL(`../${module}`, import.meta.url), "utf8");
  const statements = source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm);
  return [...statements].map((statement) => statement[1]);
}

describe("the contract modules the edge Worker reads at runtime", () => {
  it.each(WORKER_READ_MODULES)("loads %s without executing an import", (module) => {
    expect(runtimeImports(module)).toStrictEqual([]);
  });
});
