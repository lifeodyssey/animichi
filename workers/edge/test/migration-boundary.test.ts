import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS = `${ROOT}migrations/neon/`;
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

void test("STAGING: deploy workflows carry no Atlas and no database credential; schema-before-app", () => {
  // #1052 (US-24/25): the staging path is "schema before app" - the migrator
  // trigger (migrate-staging) is the ONLY applier of the committed chain, so the
  // staging component deploys must contain NO Atlas invocation and NO database
  // credential reference (NEON_DATABASE_URL / NEON_API_KEY). The reusable
  // component keeps the Atlas path only for production (SAFE-1 pinned apply until
  // #1055); its Atlas step is gated on the run_atlas input, and every staging
  // caller passes run_atlas: false so it never runs for staging. The production
  // assertions in the "CI and deploy workflows use Atlas" test above stay until
  // #1055 removes them.
  const ci = read(".github/workflows/ci.yml");
  const promotion = read(".github/workflows/reusable-deploy-component.yml");

  const stagingComponentJobs = [
    "deploy-staging",
    "deploy-web-staging",
    "deploy-users-staging",
    "deploy-root-staging",
    "deploy-migrator-staging",
  ];

  // Extract each job's YAML block from the raw ci.yml source by slicing from its
  // two-space-indented header to the next two-space job header (or EOF).
  const lines = ci.split(/\r?\n/);
  const jobIndex = (id: string): number => lines.findIndex((l) => l === `  ${id}:`);
  const segmentOf = (id: string): string => {
    const start = jobIndex(id);
    assert.notEqual(start, -1, `ci.yml must contain a ${id} job`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^ {2}[a-zA-Z][a-zA-Z0-9_-]*:$/.test(lines[i] ?? "")) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  };

  const doorbellJobs = [
    "deploy-staging",
    "deploy-web-staging",
    "deploy-users-staging",
    "deploy-root-staging",
  ];
  for (const id of stagingComponentJobs) {
    const seg = segmentOf(id);
    assert.doesNotMatch(seg, /\batlas\b/i, `${id} must not invoke Atlas`);
    assert.doesNotMatch(seg, /NEON_DATABASE_URL/, `${id} must not reference NEON_DATABASE_URL`);
    assert.doesNotMatch(seg, /NEON_API_KEY/, `${id} must not reference NEON_API_KEY`);
  }
  for (const id of doorbellJobs) {
    const seg = segmentOf(id);
    assert.match(seg, /reusable-ring-doorbell\.yml/, `${id} must ring doorbell`);
    assert.doesNotMatch(seg, /run_atlas:/, `${id} must not pass run_atlas`);
  }
  const migratorSeg = segmentOf("deploy-migrator-staging");
  assert.match(migratorSeg, /run_atlas:\s*false/, "deploy-migrator-staging must pass run_atlas: false");

  // The shared component ships the Atlas step ONLY behind run_atlas (default true
  // for the production path). Removing the gate (or the input) must go red.
  assert.match(promotion, /run_atlas:\s*\{\s*required:\s*false,\s*type:\s*boolean,\s*default:\s*true\s*}/);
  const atlasStepGated = /- name: Atlas migrate[\s\S]*?if: \$\{\{ inputs\.run_atlas \}\}/.test(promotion);
  assert.ok(atlasStepGated, "reusable-deploy-component.yml Atlas step must be gated on inputs.run_atlas");

  // #1052 / #1051: the migrator trigger job must precede every component deploy in
  // the needs-graph. This is also the failure-semantics assertion (AC): because each
  // component deploy names migrate-staging in needs, a failed trigger step fails the
  // trigger job and GitHub blocks every dependent component deploy - components are
  // never deployed on a failed schema apply.
  assert.ok(jobIndex("migrate-staging") !== -1, "ci.yml must contain a migrate-staging trigger job");
  for (const id of ["deploy-staging", "deploy-web-staging", "deploy-users-staging", "deploy-root-staging"]) {
    const seg = segmentOf(id);
    const needsLine = seg.split(/\r?\n/).find((l) => l.trim().startsWith("needs:"));
    assert.ok(needsLine, `${id} must declare a needs array`);
    assert.match(needsLine, /migrate-staging/, `${id} must depend on migrate-staging (schema before app; failed trigger blocks this deploy)`);
  }
});
