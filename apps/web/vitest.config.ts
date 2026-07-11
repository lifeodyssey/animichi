import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // SSR wiring is exercised by the integration build test and the browser 404 test; excluded from the unit-coverage sweep because routeTree.gen.ts only exists after a build.
        "src/routeTree.gen.ts",
        "src/router.tsx",
        "src/routes/**",
      ],
      // Iteration-0 measured floor (components-only surface, 2 statements) — repo rule: ratchet UP only; lowering requires explicit user approval.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
