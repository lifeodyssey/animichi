import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS = `${ROOT}migrations/neon/`;
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STAGING_APP_JOBS = [
  "deploy-staging",
  "deploy-web-staging",
  "deploy-users-staging",
  "deploy-root-staging",
  "deploy-migrator-staging",
] as const;
const STAGING_DOORBELL_JOBS = [
  "deploy-staging",
  "deploy-web-staging",
  "deploy-users-staging",
  "deploy-root-staging",
] as const;

function nextJobIndex(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-zA-Z][a-zA-Z0-9_-]*:$/.test(lines[i] ?? "")) return i;
  }
  return lines.length;
}

function yamlJobSegment(source: string, id: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${id}:`);
  assert.notEqual(start, -1, `ci.yml must contain a ${id} job`);
  return lines.slice(start, nextJobIndex(lines, start)).join("\n");
}

void test("Atlas files are the only Neon migration authority", () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
  const sum = read("migrations/neon/atlas.sum");
  assert.notEqual(files.length, 0, "migrations/neon must contain SQL migrations");
  for (const file of files) {
    assert.match(sum, new RegExp(`^${escapeRegExp(file)} h1:`, "m"), `${file} is missing from atlas.sum`);
  }
  assert.match(read("docs/ops/migrations.md"), /migrations\/neon\/\*\.sql.*atlas\.sum/s);
  assert.match(read("docs/ops/migrations.md"), /Drizzle[\s\S]*metadata.*only/s);
  for (const path of [
    "docs/specs/2026-07-06-frontend-rebuild-spec.md",
    "docs/specs/2026-07-06-frontend-rebuild/iter-0.md",
  ]) {
    const source = read(path);
    assert.match(source, /S0\.9 authority amendment \(2026-08-02\)/, `${path} needs the S0.9 amendment`);
    assert.match(source, /migrations\/neon\/\*\.sql[\s\S]*atlas\.sum/);
    assert.match(source, /Drizzle[\s\S]*runtime query\/type metadata only/);
    assert.doesNotMatch(source, /dual-chain\s*\+\s*atlas-provider-drizzle|Drizzle TS schema.*single source/i);
  }
});

void test("Drizzle schemas cannot become migration runners", () => {
  for (const path of ["workers/catalog/src/db/schema.ts", "workers/users/src/db/schema.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /drizzle-kit/);
    assert.doesNotMatch(source, /drizzle\s+(?:migrate|generate|push|pull)/i);
    assert.match(source, /typing only|query-only/i, `${path} must state its runtime-only role`);
  }
});

void test("CI and deploy workflows use Atlas, never the old all-schema push", () => {
  // S0-v2 B4: the migration lane moved out of ci.yml into pipeline-db.yml
  // (CI-1 union method); ci.yml now carries only the deploy chain.
  const dbLane = read(".github/workflows/pipeline-db.yml");
  const ci = read(".github/workflows/ci.yml");
  const deploy = read(".github/workflows/deploy.yml");
  const promotion = read(".github/workflows/reusable-deploy-component.yml");
  assert.match(dbLane, /atlas migrate validate --dir file:\/\/migrations\/neon/);
  // #1053: the live Neon dry-run was dropped with the test-infra retirement;
  // pipeline-db is hermetic (no DSN) — the boundary guard + validate remain.
  assert.doesNotMatch(dbLane, /atlas migrate apply --dry-run/);
  // #486 thin caller: the manual path cannot skip Atlas — every job runs the reusable pipeline.
  assert.match(deploy, /uses: \.\/\.github\/workflows\/reusable-deploy-component\.yml/);
  assert.match(promotion, /atlas migrate apply --dir ["']?file:\/\/migrations\/neon[\s\S]*--revisions-schema public/);
  assert.match(promotion, /atlas migrate validate --dir ["']?file:\/\/migrations\/neon/);
  assert.doesNotMatch(ci, /supabase db push/);
  assert.doesNotMatch(deploy, /supabase db push/);
});

void test("README points operators to the migration runbook", () => {
  for (const path of ["README.md", "README.zh.md", "README.ja.md"]) {
    const source = read(path);
    assert.match(source, /docs\/ops\/migrations\.md/);
    assert.doesNotMatch(source, /Supabase CLI for all schema changes|使用 Supabase CLI 管理所有 schema 变更|スキーマ変更には Supabase CLI を使用/);
  }
  const makefile = read("Makefile");
  assert.match(makefile, /\.PHONY:[\s\S]*db-new[\s\S]*db-hash[\s\S]*db-validate/);
  assert.doesNotMatch(makefile, /\.PHONY:[^\n]*\bdb-diff\b/);
  assert.match(makefile, /db-diff\/db-pull\/db-reset are retired/);
});

void test("historical deployment notes cannot look like the current migration path", () => {
  const deployment = read("docs/ops/deployment.md");
  assert.match(deployment, /HISTORICAL[\s\S]*Historical only; no longer current/i);
  assert.match(deployment, /current\s+Neon migration authority[\s\S]*migrations\/neon[\s\S]*Atlas/i);
  assert.match(deployment, /Historical Supabase schema event \(not a current apply\)/);
});

void test("STAGING: component jobs carry no Atlas and no database credential", () => {
  const ci = read(".github/workflows/ci.yml");
  for (const id of STAGING_APP_JOBS) {
    const seg = yamlJobSegment(ci, id);
    assert.doesNotMatch(seg, /\batlas\b/i, `${id} must not invoke Atlas`);
    assert.doesNotMatch(seg, /NEON_DATABASE_URL/, `${id} must not reference NEON_DATABASE_URL`);
    assert.doesNotMatch(seg, /NEON_API_KEY/, `${id} must not reference NEON_API_KEY`);
  }
});

void test("STAGING: app jobs ring doorbell; migrator keeps run_atlas false", () => {
  const ci = read(".github/workflows/ci.yml");
  const promotion = read(".github/workflows/reusable-deploy-component.yml");
  for (const id of STAGING_DOORBELL_JOBS) {
    const seg = yamlJobSegment(ci, id);
    assert.match(seg, /reusable-ring-doorbell\.yml/, `${id} must ring doorbell`);
    assert.doesNotMatch(seg, /run_atlas:/, `${id} must not pass run_atlas`);
  }
  assert.match(yamlJobSegment(ci, "deploy-migrator-staging"), /run_atlas:\s*false/);
  assert.match(promotion, /run_atlas:\s*\{\s*required:\s*false,\s*type:\s*boolean,\s*default:\s*true\s*}/);
  assert.ok(/- name: Atlas migrate[\s\S]*?if: \$\{\{ inputs\.run_atlas \}\}/.test(promotion));
});

void test("STAGING: doorbell rings need migrate-staging (schema before app)", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /^ {2}migrate-staging:$/m);
  for (const id of STAGING_DOORBELL_JOBS) {
    const needsLine = yamlJobSegment(ci, id).split(/\r?\n/).find((line) => line.trim().startsWith("needs:"));
    assert.ok(needsLine, `${id} must declare needs`);
    assert.match(needsLine, /migrate-staging/, `${id} must depend on migrate-staging`);
  }
});
