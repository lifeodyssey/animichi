import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    css: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    globalSetup: ["tests/setup/generate-route-tree.ts"],
    setupFiles: [
      "tests/setup/auth-hermetic.ts",
      "tests/setup/turnstile-hermetic.ts",
      "tests/setup/msw-lifecycle.ts",
    ],
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // routeTree.gen.ts is generated (excluded per repo pitfall); routes and
      // router.tsx are now in the sweep per campaign plan §0.6 (owner-signed
      // 100%->90% analytics-real ratchet: the denominator now includes routes).
      exclude: [
        "src/routeTree.gen.ts",
        // WebGL map glue: instantiates maplibre-gl (requires a real GL context + dynamic imports),
        // unrunnable under jsdom. Its pure inputs (style/layers/pins/geometry) are unit-covered; the
        // live mount is covered by S0.4's browser ACs (Tester). Per campaign plan §0.6 exclude ledger.
        "src/features/map-spike/mapController.ts",
        // The _dev map-spike route only wires the maplibre container mount (attachMapSpike ->
        // mapController above). It cannot render under jsdom for the same GL reason; the mount is a
        // browser AC (S0.4). Same §0.6 exclude-ledger rationale as mapController.ts (surfaced when
        // routes/** entered the sweep in C0.1).
        "src/routes/_dev/map-spike.tsx",
        // Bubble-map WebGL basemap glue: instantiates maplibre-gl (real GL context + dynamic
        // imports), unrunnable under jsdom. Its pure inputs (bubbleGeometry) are unit-covered and
        // the interactive bubble overlay/sheet are DOM-covered; the live mount is an S5.2 browser AC
        // (Tester). Same §0.6 exclude-ledger rationale as mapController.ts.
        "src/features/bubble-map/bubbleMapController.ts",
        // BubbleMap entry only owns the ref + effect that mounts the basemap (attachBubbleMap ->
        // bubbleMapController above); it cannot render under jsdom for the same GL reason. The
        // testable state/overlay/sheet live in BubbleMapPanel. Same §0.6 exclude-ledger rationale
        // as routes/_dev/map-spike.tsx.
        "src/features/bubble-map/BubbleMap.tsx",
      ],
      // S1.10 (#282) ratchet: measured 98.61/95.48/98.94/99.49 on the tree
      // rebased onto #462/#463/#467. Branches ratchet 94 -> 95. Functions is
      // deliberately left at 98: the D12 files are themselves at 100%, but the
      // freshly merged BYOK/Turnstile code dilutes the global ratio below the
      // 99 this branch measured pre-rebase, and inventing coverage for other
      // people's code to hold a number is not a ratchet. Ratchet UP only.
      thresholds: { statements: 98, branches: 95, functions: 98, lines: 99 },
    },
  },
});
