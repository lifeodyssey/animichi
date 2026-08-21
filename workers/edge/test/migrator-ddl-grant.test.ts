import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

void test("staging owner GRANT gives migrator CREATE on public", () => {
  const sql = read("infra/neon-secrets/grant-migrator-ddl.sql");
  assert.match(sql, /GRANT USAGE,\s*CREATE ON SCHEMA public TO migrator;/);
  assert.match(sql, /ALTER TABLE public\.turn_reservations OWNER TO migrator;/);
  assert.doesNotMatch(sql, /Pulumi\.prod|production/i);
});

void test("neon-secrets staging apply runs the GRANT; production does not", () => {
  const workflow = read(".github/workflows/reusable-deploy-neon-secrets.yml");
  assert.match(workflow, /grant-migrator-ddl\.sh/);
  assert.match(workflow, /if: \$\{\{ inputs\.environment == 'staging' \}\}/);
  const prod = read(".github/workflows/ci.yml");
  const prodJob = prod.split("deploy-neon-secrets-prod:")[1]?.slice(0, 1200) ?? "";
  assert.match(prodJob, /environment: production/);
  assert.doesNotMatch(prodJob, /grant-migrator-ddl/);
});
