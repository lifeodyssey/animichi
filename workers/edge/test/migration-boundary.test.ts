import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

void test("Atlas files are the only Neon migration authority", () => {
  const files = readdirSync(`${ROOT}migrations/neon`).filter((file) => file.endsWith(".sql"));
  const sum = read("migrations/neon/atlas.sum");
  assert.notEqual(files.length, 0);
  for (const file of files) assert.match(sum, new RegExp(`^${file} h1:`, "m"));
  assert.match(read("docs/ops/migrations.md"), /migrations\/neon\/\*\.sql.*atlas\.sum/s);
});

void test("Drizzle schemas cannot become migration runners", () => {
  for (const path of ["workers/catalog/src/db/schema.ts", "workers/users/src/db/schema.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /drizzle-kit|drizzle\s+(?:migrate|generate|push|pull)/i);
    assert.match(source, /typing only|query-only/i);
  }
});

void test("PR CI validates migrations without applying a live database", () => {
  const gate = read("scripts/local-gates/pre-push.sh");
  const workflow = read(".github/workflows/pr-verification.yml");
  assert.match(workflow, /matrix\.component/);
  assert.match(gate, /atlas migrate validate --dir file:\/\/migrations\/neon/);
  assert.doesNotMatch(gate, /atlas migrate apply/);
  assert.doesNotMatch(workflow, /supabase db push/);
});

void test("main CD orders migration between foundation and services", () => {
  const cd = read(".github/workflows/cd.yml");
  assert.match(cd, /stage-migration:[\s\S]*needs: \[route, stage-foundation\]/);
  assert.match(cd, /stage-services:[\s\S]*needs: \[route, stage-migration\]/);
  assert.match(cd, /uses: \.\/\.github\/workflows\/reusable-promote-release-phase\.yml/);
});

void test("staging migration uses OIDC while production applies the sealed Atlas chain", () => {
  const reusable = read(".github/workflows/reusable-promote-release-phase.yml");
  const promotion = read(".github/scripts/promote-release-unit.sh");
  assert.match(reusable, /id-token: write/);
  assert.match(reusable, /MIGRATOR_URL: \$\{\{ vars\.MIGRATOR_STAGING_URL \}\}/);
  assert.match(promotion, /audience=animichi:github-actions:migrator/);
  assert.match(promotion, /atlas migrate validate --dir "file:\/\/\$PAYLOAD_DIR\/migrations"/);
  assert.match(promotion, /atlas migrate apply[\s\S]*--revisions-schema public/);
});

void test("README points operators to the migration runbook", () => {
  for (const path of ["README.md", "README.zh.md", "README.ja.md"]) {
    assert.match(read(path), /docs\/ops\/migrations\.md/);
  }
});
