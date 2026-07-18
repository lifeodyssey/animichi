import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    css: true,
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
        // WebGL map glue: instantiates maplibre-gl (requires a real GL context + dynamic imports),
        // unrunnable under jsdom. Its pure inputs (style/layers/pins/geometry) are unit-covered; the
        // live mount is covered by S0.4's browser ACs (Tester). Per campaign plan §0.6 exclude ledger.
        "src/features/map-spike/mapController.ts",
      ],
      // Iteration-0 measured floor (components-only surface, 2 statements) — repo rule: ratchet UP only; lowering requires explicit user approval.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
