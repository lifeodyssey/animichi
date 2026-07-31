import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKFLOW = readFileSync(`${ROOT}.github/workflows/dependabot-agent.yml`, "utf8");
const PACKAGE_JSON = readFileSync(`${ROOT}package.json`, "utf8");
const DEPLOY_WORKFLOWS = ["_deploy-component.yml", "deploy.yml"].map((name) =>
  readFileSync(`${ROOT}.github/workflows/${name}`, "utf8"),
);
interface PackageManifest {
  devDependencies?: Record<string, string>;
}
const DEPLOY_PACKAGES = [
  "package.json",
  "apps/web/package.json",
  "workers/catalog/package.json",
  "workers/users/package.json",
].map((name) => JSON.parse(readFileSync(`${ROOT}${name}`, "utf8")) as PackageManifest);

function stepNamed(name: string): string {
  const start = WORKFLOW.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing workflow step ${name}`);
  const next = WORKFLOW.indexOf("\n      - ", start + 1);
  return WORKFLOW.slice(start, next === -1 ? undefined : next);
}

function wranglerActionSteps(workflow: string): string[] {
  return workflow
    .split(/\n(?= {6}- )/)
    .filter((step) => /^\s+uses: cloudflare\/wrangler-action@/m.test(step));
}

function assertUsesLockedWrangler(workflow: string): void {
  const steps = wranglerActionSteps(workflow);
  assert.notEqual(steps.length, 0);
  assert.doesNotMatch(workflow, /wranglerVersion:/);
  assert.doesNotMatch(workflow, /\bnpx\b[^\n]*\bwrangler(?:@|\b)/);
  for (const step of steps) {
    assert.equal(step.match(/^\s+packageManager:/gm)?.length, 1);
    assert.match(step, /^\s+packageManager:\s+pnpm\s*$/m);
  }
}

void test("Dependabot gate checks repository structure without assuming uv is preinstalled", () => {
  assert.equal(stepNamed("Verify gate contract").includes("command -v uv"), false);
});

void test("Dependabot installs locked Python wheels without running build scripts", () => {
  const safeSync =
    /- run: uv sync --python "\$PYTHON_VERSION" --all-extras --locked --no-build --no-install-project\n\s+working-directory: apps\/agent/g;
  assert.equal(WORKFLOW.match(safeSync)?.length, 1);
  assert.doesNotMatch(WORKFLOW, /- run: uv sync --all-extras\n/);
  assert.doesNotMatch(WORKFLOW, /uv run (?!--no-build --no-sync)/);
});

void test("Dependabot uses the shared Node verification command", () => {
  assert.match(PACKAGE_JSON, /"verify:dependabot": "[^"]*typecheck[^"]*web build"/);
  assert.equal(WORKFLOW.match(/pnpm run verify:dependabot/g)?.length, 1);
});

void test("deploy workflows use the locked workspace Wrangler", () => {
  DEPLOY_WORKFLOWS.forEach(assertUsesLockedWrangler);
});

void test("deploy packages declare Wrangler", () => {
  DEPLOY_PACKAGES.forEach((manifest) => {
    assert.equal(typeof manifest.devDependencies?.wrangler, "string");
  });
});

void test("Dependabot reports success only for two successful quality outcomes", () => {
  const report = stepNamed("Report verification outcomes");
  assert.match(report, /\[ "\$BACKEND_OUTCOME" = "success" \] && \[ "\$WEB_OUTCOME" = "success" \]/);
  assert.match(report, /verification incomplete/);
  assert.doesNotMatch(WORKFLOW, /continue-on-error/);
});

void test("Dependabot leaves verified upgrades for manual review", () => {
  const allGreen = /gate_contract_ok == 'success' &&\n\s+needs\.verify\.outputs\.backend_ok == 'success' &&\n\s+needs\.verify\.outputs\.web_ok == 'success'/;
  assert.match(WORKFLOW, allGreen);
  assert.match(stepNamed("Report verified upgrade"), /ready for manual review/);
  assert.doesNotMatch(WORKFLOW, /gh pr merge/);
});

void test("Dependabot reports incomplete verification without an autonomous writer", () => {
  const report = stepNamed("Report incomplete or failed verification");
  assert.match(WORKFLOW, /!cancelled\(\)/);
  assert.match(WORKFLOW, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.match(WORKFLOW, /needs\.verify\.result != 'success'/);
  assert.match(WORKFLOW, /needs\.verify\.outputs\.gate_contract_ok != 'success'/);
  assert.match(WORKFLOW, /needs\.verify\.outputs\.backend_ok != 'success'/);
  assert.match(WORKFLOW, /needs\.verify\.outputs\.web_ok != 'success'/);
  assert.match(report, /gh pr comment/);
  assert.doesNotMatch(WORKFLOW, /contents: write/);
  assert.doesNotMatch(WORKFLOW, /claude-code-action|anthropic_api_key|Agent Fix/);
});

void test("Dependabot runs tests from source without installing the local project", () => {
  const backend = stepNamed("Backend quality + tests");
  assert.match(backend, /uv run --no-build --no-sync python -m pytest/);
  assert.match(backend, /SUPABASE_DB_URL: postgresql:\/\/test:test@127\.0\.0\.1:5432\/test/);
  assert.match(backend, /MIMO_API_KEY: test-only/);
});
