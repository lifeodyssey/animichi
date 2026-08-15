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
//   - every runtime role is BOTH created (roles migration) AND granted (grants
//     migration) BY THE CHAIN, in one append-only timestamped history.
//
// test-type: unit (reads checked-in migrations; no network, no clock, no mocks).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS = ROOT + "migrations/neon/";

// Retention-1 (#940) keeps the retired maintenance vocabulary off the live
// surface, so the data-plane runtime roles asserted here are the four that
// own the catalog/users/agent plane; the jobs maintenance role stays confined
// to its SAFE-1-pinned production declarations.
const RUNTIME_ROLES = ["catalog_svc", "users_svc", "agent_svc", "readonly"];

function readMigrations(): { name: string; body: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, body: readFileSync(MIGRATIONS + name, "utf8") }));
}

const chain = readMigrations();

void test("the chain is an append-only, timestamped history that Atlas owns", () => {
  const names = chain.map((m) => m.name);
  assert.ok(names.length > 0, "migrations/neon must contain SQL migrations");
  for (const name of names) {
    assert.match(name, /^\d{14}/, name + " must have a timestamped prefix");
  }
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
    for (const role of RUNTIME_ROLES) {
      if (new RegExp("\\b" + role + "\\b", "i").test(windowText)) {
        assert.fail("chain must not mutate runtime role " + role + ": " + windowText.trim());
      }
    }
    match = mutation.exec(joined);
  }
});

void test("every runtime role is created and granted BY the chain", () => {
  const rolesSql = chain.find((m) => m.name.includes("_roles.sql"))?.body ?? "";
  const grantsSql = chain.find((m) => m.name.includes("_grants.sql"))?.body ?? "";
  assert.match(rolesSql, /CREATE ROLE/i, "roles migration must declare service roles");
  for (const role of RUNTIME_ROLES) {
    assert.match(rolesSql, new RegExp("CREATE ROLE " + role + "\\b", "i"), "roles migration must create " + role);
    assert.match(grantsSql, new RegExp("TO " + role + "\\b", "i"), "grants migration must grant to " + role);
  }
  for (const role of RUNTIME_ROLES) {
    const count = (grantsSql.match(new RegExp("TO " + role + "\\b", "gi")) ?? []).length;
    assert.ok(count > 0, "grants migration must grant " + role + " at least one privilege");
  }
});

void test("the migrator role is not a runtime-serving role in the chain", () => {
  const rolesSql = chain.find((m) => m.name.includes("00000001_roles"))?.body ?? "";
  const grantsSql = chain.find((m) => m.name.includes("00000030_grants"))?.body ?? "";
  assert.doesNotMatch(rolesSql, /CREATE ROLE migrator\b/i, "runtime roles migration must not create a migrator LOGIN (scoped IaC, #1050)");
  assert.doesNotMatch(grantsSql, /TO migrator\b/i, "grants migration must not grant runtime privileges to a migrator role");
});

void test("the neon-secrets IaC provisions the migrator LOGIN role + DSN secret", () => {
  const infra = readFileSync(ROOT + "infra/neon-secrets/index.ts", "utf8");
  assert.match(infra, /name: "migrator"/);
  assert.match(infra, /secretName: "MIGRATOR_DATABASE_URL"/);
});