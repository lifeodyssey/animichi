import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS = `${ROOT}db/migrations/`;
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

void test("Atlas files are the only Neon migration authority", () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
  const sum = read("db/migrations/atlas.sum");
  assert.notEqual(files.length, 0, "db/migrations must contain SQL migrations");
  for (const file of files) {
    assert.match(sum, new RegExp(`^${escapeRegExp(file)} h1:`, "m"), `${file} is missing from atlas.sum`);
  }
  assert.match(read("docs/ops/migrations.md"), /db\/migrations\/\*\.sql.*atlas\.sum/s);
  assert.match(read("docs/ops/migrations.md"), /Drizzle[\s\S]*metadata.*only/s);
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
  const ci = read(".github/workflows/ci.yml");
  const deploy = read(".github/workflows/deploy.yml");
  const promotion = read(".github/workflows/_deploy-component.yml");
  assert.match(ci, /atlas migrate validate --dir file:\/\/db\/migrations/);
  assert.match(ci, /atlas migrate apply --dry-run[\s\S]*--revisions-schema public/);
  assert.match(deploy, /atlas migrate validate --dir file:\/\/db\/migrations/);
  assert.match(promotion, /atlas migrate apply --dir ["']?file:\/\/db\/migrations/);
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
  assert.match(deployment, /current\s+Neon migration authority[\s\S]*db\/migrations[\s\S]*Atlas/i);
  assert.match(deployment, /Historical Supabase schema event \(not a current apply\)/);
});
