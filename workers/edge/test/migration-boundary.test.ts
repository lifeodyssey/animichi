import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

// One job's own text, cut at the next line indented like a job key. A `[\s\S]*`
// from a job header runs to end of file, so `stage:[\s\S]*id-token: write` was
// satisfied by `promote-production`'s copy of that permission and would have
// stayed green with `stage`'s deleted.
const jobBlock = (workflow: string, id: string): string => {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `cd.yml has no ${id} job`);
  const body = workflow.slice(start + 1);
  const end = body.search(/\n {2}[A-Za-z]/);
  return end === -1 ? body : body.slice(0, end);
};

// One authority owns the Neon data plane (#1636): the committed Prisma chain, whose identity is
// the contract's own `storage.storageHash`. What this pins is that the chain exists, that the
// runbook sends an operator to it, and — the part a text search would miss — that no second
// directory of `.sql` migrations has appeared beside it.
void test("the Prisma chain is the only Neon migration authority", () => {
  const chain = `${ROOT}packages/pi-session-neon/migrations/app`;
  const migrations = readdirSync(chain, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.notEqual(migrations.length, 0);
  for (const migration of migrations) {
    assert.ok(existsSync(`${chain}/${migration.name}/migration.json`), `${migration.name} has no manifest`);
  }
  assert.match(read("docs/ops/migrations.md"), /packages\/pi-session-neon\/migrations/);
  assert.deepEqual(readdirSync(ROOT).filter((entry) => entry === "migrations"), []);
});

void test("Drizzle schemas cannot become migration runners", () => {
  // Every worker that maps the data plane, discovered rather than listed: a new
  // service's schema must not slip past this boundary by not being enumerated.
  const workers = readdirSync(`${ROOT}workers`);
  const schemas = workers.map((worker) => `workers/${worker}/src/db/schema.ts`);
  const present = schemas.filter((path) => existsSync(`${ROOT}${path}`));
  assert.deepEqual(present.sort(), ["workers/catalog/src/db/schema.ts", "workers/users/src/db/schema.ts"]);
  for (const path of present) {
    const source = read(path);
    assert.doesNotMatch(source, /drizzle-kit|drizzle\s+(?:migrate|generate|push|pull)/i);
    assert.match(source, /typing only|query-only/i);
  }
});

// Both workflow-shape halves of this file are gone, for the same reason: a fact
// about a workflow's shape asserted from the edge package made the edge lane
// fail for a workflow's reasons. The PR lane's — which job validates, in what
// order, and that no job applies — went to
// .github/test/pr-verification-schema.test.rb with B5 (#1363); the CD lane's —
// which job needs which — went to .github/test/cd-delivery-jobs.test.rb
// with C1 (#1364). What stays here is the boundary itself: who may migrate, and
// from what source. Both environments reach the database only through the
// migrator Worker on each job's own OIDC identity — C3 (#1365) moved production
// onto that path and deleted the last database credential CI held.
void test("both environments migrate through the migrator Worker on an OIDC identity", () => {
  const cd = read(".github/workflows/cd.yml");
  const handshake = read("scripts/delivery/migrate-through-worker.sh");
  // #1468 collapsed the five staging stages into one `stage` job, so the job
  // that proves an identity to the migrator is that one; what this pins is
  // unchanged — the staging migration runs under an `id-token: write` job.
  const stage = jobBlock(cd, "stage");
  assert.match(stage, /id-token: write/);
  assert.match(stage, /MIGRATOR_URL: \$\{\{ vars\.MIGRATOR_STAGING_URL \}\}/);
  assert.match(stage, /migrate-through-worker\.sh staging/);
  const production = jobBlock(cd, "promote-production");
  assert.match(production, /id-token: write/);
  assert.match(production, /MIGRATOR_URL: \$\{\{ vars\.MIGRATOR_PRODUCTION_URL \}\}/);
  assert.match(production, /migrate-through-worker\.sh production/);
  assert.match(handshake, /audience=animichi:github-actions:migrator/);
  assert.doesNotMatch(cd, /NEON_DATABASE_URL/);
});

// Every environment reaches the database through the migrator Worker's OIDC door, so no CD job
// may carry a migration CLI or a client of its own.
void test("no job applies the chain itself", () => {
  const cd = read(".github/workflows/cd.yml");
  assert.doesNotMatch(cd, /prisma db migrate/);
  assert.doesNotMatch(cd, /\bpsql\b/);
});

// #1332: the deploy call returning is not the new bundle serving. The handshake waits on the
// schema identity the Worker itself reports before it POSTs anything, and treats the Worker's
// own `409 stale_prisma_bundle` as the same fact from the far side. With one migration
// authority there is one identity to wait for (#1634).
void test("the migration waits for the migrator to serve the selected identity", () => {
  const handshake = read("scripts/delivery/migrate-through-worker.sh");
  const poll = read("scripts/delivery/migrator-bundle.sh");
  assert.match(poll, /healthz/);
  assert.match(poll, /prismaTarget/);
  assert.match(handshake, /await_migrator_bundle/);
  assert.match(handshake, /stale_prisma_bundle/);
});

void test("README points operators to the migration runbook", () => {
  for (const path of ["README.md", "README.zh.md", "README.ja.md"]) {
    assert.match(read(path), /docs\/ops\/migrations\.md/);
  }
});
