import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  fileURLToPath(new URL("../../../../.github/workflows/_deploy-component.yml", import.meta.url)),
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
const preflightedNames = new Set(
  [...preflightStep.matchAll(/if \[ -z "\$\{(VITE_[A-Z0-9_]+)\}" \]/g)].map((match) => match[1]),
);

// Required means "an empty value ships a broken feature", not "the code crashes
// without it". Both of these degrade gracefully at runtime — which is precisely
// why they need a build-time gate: the degradation is invisible in CI and
// surfaces as a dead sign-in form in production (#506).
//
// The four omitted names (VITE_SITE_ORIGIN, VITE_CATALOG_URL, VITE_USERS_URL,
// VITE_AGENT_URL) fall back to the current origin, which is correct for a
// same-origin deploy — empty there is a real configuration, not a hole.
const requiredViteNames = ["VITE_NEON_AUTH_BASE_URL", "VITE_TURNSTILE_SITE_KEY"];

describe("deploy workflow Vite build environment", () => {
  it("injects every VITE_* read by apps/web/src", () => {
    expect(buildStep).not.toBe("");
    expect([...readNames].sort()).toEqual([...injectedNames].sort());
  });

  it("preflights every required VITE_* value before the build", () => {
    expect(preflightStep).not.toBe("");
    expect([...preflightedNames].sort()).toEqual([...requiredViteNames].sort());
  });
});
