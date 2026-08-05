import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  fileURLToPath(new URL("../../../../.github/workflows/reusable-deploy-component.yml", import.meta.url)),
  "utf8",
);
const sourceFiles = import.meta.glob("../../src/**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});
const source = Object.values(sourceFiles).join("\n");
const readNames = new Set(
  [...source.matchAll(/\b(?:env|import\.meta\.env)\.(VITE_[A-Z0-9_]+)/g)].map((match) => match[1]),
);
const buildStepMatch = /- name: Build component[\s\S]*?run: pnpm --filter [^\n]+ build/.exec(workflow);
const buildStep = buildStepMatch?.[0] ?? "";
const injectedNames = new Set(
  [...buildStep.matchAll(/^\s+(VITE_[A-Z0-9_]+): \$\{\{ vars\.\1 \}\}$/gm)].map((match) => match[1]),
);
const preflightMatch = /- name: Preflight - Vite build environment[\s\S]*?(?=\n {6}- name: )/.exec(
  workflow,
);
const preflightStep = preflightMatch?.[0] ?? "";
// The shape rules themselves live in .github/scripts/vite-env-preflight.sh
// (behavioral tests: vite-env-preflight.test.sh) — this step just passes the
// variable names to the script. Every injected name must be on that run line:
// the script runs universal secret-shape checks on every name passed to it,
// not just the required ones.
const preflightedNames = new Set(
  [
    ...(/run: bash \.github\/scripts\/vite-env-preflight\.sh(?: |\n)([\s\S]*)/.exec(preflightStep)?.[1] ?? "").matchAll(
      /\b(VITE_[A-Z0-9_]+)/g,
    ),
  ].map((match) => match[1]),
);
const preflightEnvNames = new Set(
  [...preflightStep.matchAll(/^\s+(VITE_[A-Z0-9_]+): \$\{\{ vars\.\1 \}\}$/gm)].map((match) => match[1]),
);

// Required means "an empty value ships a broken feature", not "the code crashes
// without it". Both of these degrade gracefully at runtime — which is precisely
// why they need a build-time gate: the degradation is invisible in CI and
// surfaces as a dead sign-in form in production (#506).
//
// The five optional names (VITE_SITE_ORIGIN, VITE_CATALOG_URL, VITE_USERS_URL,
// VITE_AGENT_URL, VITE_CF_BEACON_TOKEN) may be empty — the first four fall back
// to the current origin (correct for a same-origin deploy) and the beacon token
// merely disables analytics. They still reach the script, whose universal
// secret-shape rules apply to every name passed, optional or not.
//
// VITE_SHOWCASE_MODE is required because showcase.ts (features/config) throws
// at module init on any value other than exactly "true"/"false" — an unset or
// malformed value fails the whole SSR bundle, and the preflight additionally
// validates the allowed values, not just presence.

describe("deploy workflow Vite build environment", () => {
  it("injects every VITE_* read by apps/web/src", () => {
    expect(buildStep).not.toBe("");
    expect([...readNames].sort()).toEqual([...injectedNames].sort());
  });

  it("preflights every VITE_* the build step injects", () => {
    expect(preflightStep).not.toBe("");
    expect([...preflightEnvNames].sort()).toEqual([...injectedNames].sort());
  });

  it("passes every injected VITE_* name to the preflight script", () => {
    // Equality, not superset: a VITE_* that is injected but not preflighted
    // silently escapes the universal secret-shape checks — the exact drift
    // this suite exists to catch.
    expect([...preflightedNames].sort()).toEqual([...injectedNames].sort());
  });

  it("keeps Vite shape checks in a testable script, not inline YAML", () => {
    expect(preflightStep).toMatch(/vite-env-preflight\.sh/);
    expect(preflightStep).not.toMatch(/if \[ -z "\$\{VITE_/);
  });
});
