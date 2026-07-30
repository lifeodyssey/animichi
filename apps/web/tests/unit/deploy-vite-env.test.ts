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

describe("deploy workflow Vite build environment", () => {
  it("injects every VITE_* read by apps/web/src", () => {
    expect(buildStep).not.toBe("");
    expect([...readNames].sort()).toEqual([...injectedNames].sort());
  });
});
