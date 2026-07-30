import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKFLOW = readFileSync(`${ROOT}.github/workflows/dependabot-agent.yml`, "utf8");
const PACKAGE_JSON = readFileSync(`${ROOT}package.json`, "utf8");

function stepNamed(name: string): string {
  const start = WORKFLOW.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing workflow step ${name}`);
  const next = WORKFLOW.indexOf("\n      - ", start + 1);
  return WORKFLOW.slice(start, next === -1 ? undefined : next);
}

test("Dependabot gate checks repository structure without assuming uv is preinstalled", () => {
  assert.equal(stepNamed("Verify gate contract").includes("command -v uv"), false);
});

test("Dependabot syncs both Python phases from the agent project", () => {
  const agentSync = /- run: uv sync --all-extras\n\s+working-directory: apps\/agent/g;
  assert.equal(WORKFLOW.match(agentSync)?.length, 2);
});

test("Dependabot uses one Node verification command in all three phases", () => {
  assert.match(PACKAGE_JSON, /"verify:dependabot": "[^"]*typecheck[^"]*web build"/);
  assert.equal(WORKFLOW.match(/pnpm run verify:dependabot/g)?.length, 3);
});

test("Dependabot reports success only for two successful quality outcomes", () => {
  const report = stepNamed("Report verification outcomes");
  assert.match(report, /\[ "\$BACKEND_OUTCOME" = "success" \] && \[ "\$WEB_OUTCOME" = "success" \]/);
  assert.match(report, /verification incomplete/);
});

test("Dependabot leaves verified upgrades for manual review", () => {
  const allGreen = /gate_contract_ok == 'success' &&\n\s+needs\.verify\.outputs\.backend_ok == 'success' &&\n\s+needs\.verify\.outputs\.web_ok == 'success'/;
  assert.match(WORKFLOW, allGreen);
  assert.match(stepNamed("Report verified upgrade"), /ready for manual review/);
  assert.doesNotMatch(WORKFLOW, /gh pr merge/);
});
