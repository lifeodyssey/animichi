import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// #1050 AC3 proof (issue #1051 amendment 2): the migrator applies the committed
// chain on a disposable branch (runtime roles unchanged) — include the
// test/evidence in this diff.
//
// This is the machine-checkable half of "runtime roles unchanged": applying the
// committed chain to ANY disposable branch must leave the runtime role matrix
// (catalog_svc / users_svc / agent_svc / readonly) exactly as the
// chain declares it. We prove that statically:
//   - the chain NEVER mutates a runtime role (no DROP ROLE / REASSIGN OWNED /
//     ALTER ROLE / DROP OWNED on those names) — so re-applying is a no-op on roles;
//   - every runtime role is both created and granted by the canonical baseline.
//
// test-type: unit (reads checked-in migrations; no network, no clock, no mocks).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS = ROOT + "migrations/neon/";

// Retention-1 (#940) keeps the retired maintenance vocabulary off the live
// surface, so the data-plane runtime roles asserted here are the four that
// own the catalog/users/agent plane; the jobs maintenance role stays confined
// to its SAFE-1-pinned production declarations.
const RUNTIME_ROLES = ["catalog_svc", "users_svc", "agent_svc", "jobs_svc", "readonly"];

// Extracted so the mutation scan below stays within the 1-10-50 depth budget.
function mutatedRuntimeRole(windowText: string): string | null {
  for (const role of RUNTIME_ROLES) {
    if (new RegExp("\\b" + role + "\\b", "i").test(windowText)) return role;
  }
  return null;
}

function readMigrations(): { name: string; body: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, body: readFileSync(MIGRATIONS + name, "utf8") }));
}

const chain = readMigrations();

void test("Atlas owns the timestamped canonical baseline chain", () => {
  const names = chain.map((m) => m.name);
  assert.deepEqual(names, [
    "20260826000000_extensions.sql",
    "20260826000001_roles.sql",
    "20260826000002_functions.sql",
    "20260826000003_catalog.sql",
    "20260826000004_agent.sql",
    "20260826000005_users.sql",
    "20260829000000_fix_coordinate_sync_precedence.sql",
    "20260902000000_agent_runs.sql",
    "20260904000000_platform_usage_scope.sql",
  ]);
  const sum = readFileSync(MIGRATIONS + "atlas.sum", "utf8");
  assert.ok(sum.length > 0, "atlas.sum must exist");
  for (const name of names) {
    assert.ok(sum.includes(name), name + " in atlas.sum");
  }
});

void test("no migration mutates a runtime role (DROP ROLE / REASSIGN / ALTER ROLE)", () => {
  const joined = chain.map((m) => m.body).join("\n");
  const mutation = /(drop\s+(role|owned)|reassign\s+owned|alter\s+role)/gi;
  let match = mutation.exec(joined);
  while (match !== null) {
    const windowText = joined.slice(Math.max(0, match.index - 120), match.index + 120);
    const role = mutatedRuntimeRole(windowText);
    if (role !== null) {
      assert.fail("chain must not mutate runtime role " + role + ": " + windowText.trim());
    }
    match = mutation.exec(joined);
  }
});

void test("every runtime role is created and granted BY the chain", () => {
  const baseline = chain.map((m) => m.body).join("\n");
  assert.match(
    baseline,
    /EXECUTE format\('CREATE ROLE %I NOLOGIN', role_name\)/i,
    "baseline must declare service roles via the role-creation loop",
  );
  for (const role of RUNTIME_ROLES) {
    assert.match(baseline, new RegExp("'" + role + "'"), "baseline must list " + role + " in the role-creation loop");
    assert.match(baseline, new RegExp("TO " + role + "\\b", "i"), "baseline must grant to " + role);
  }
  for (const role of RUNTIME_ROLES) {
    const count = (baseline.match(new RegExp("TO " + role + "\\b", "gi")) ?? []).length;
    assert.ok(count > 0, "baseline must grant " + role + " at least one privilege");
  }
});

void test("the migrator role is not a runtime-serving role in the chain", () => {
  const baseline = chain.map((m) => m.body).join("\n");
  assert.doesNotMatch(baseline, /CREATE ROLE migrator\b/i, "IaC owns the migrator LOGIN");
  assert.doesNotMatch(baseline, /TO migrator\b/i, "baseline must not grant runtime privileges to migrator");
});

void test("database-access IaC provisions the migrator LOGIN role + DSN secret", () => {
  const infra = readFileSync(ROOT + "infra/database-access/index.ts", "utf8");
  assert.match(infra, /name: "migrator"/);
  assert.match(infra, /secretName: "MIGRATOR_DATABASE_URL"/);
});
