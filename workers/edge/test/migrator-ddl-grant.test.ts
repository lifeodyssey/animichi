import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

const GRANT_STEP = "- name: Grant migrator DDL on staging public";
const PROD_JOB = "deploy-neon-secrets-prod:";

function namedBlock(source: string, marker: string, width: number): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const block = source.slice(start, start + width);
  assert.ok(block.length > 0, marker);
  return block;
}

void test("staging GRANT gives migrator CREATE on public", () => {
  const sql = read("infra/neon-secrets/grant-migrator-ddl.sql").replaceAll(/^--.*$/gm, "");
  assert.match(sql, /GRANT USAGE,\s*CREATE ON SCHEMA public TO migrator;/);
  assert.match(sql, /GRANT REFERENCES ON TABLE public.sessions TO migrator;/);
  assert.doesNotMatch(sql, /ALL TABLES/);
  assert.doesNotMatch(sql, /GRANT migrator TO/);
  assert.doesNotMatch(sql, /OWNER TO/);
  assert.doesNotMatch(sql, /Pulumi\.prod|production/i);
});

void test("staging owner GRANT is applied as neondb_owner", () => {
  const sh = read("infra/neon-secrets/grant-migrator-ddl.sh");
  assert.match(sh, /Pulumi\.staging\.yaml/);
  assert.match(sh, /--role-name neondb_owner/);
  assert.match(sh, /ON_ERROR_STOP=1/);
  assert.match(sh, /neonctl@3\.6\.0/);
  assert.doesNotMatch(sh, /neonctl@latest/);
  assert.match(sh, /Failed to read neonProjectId\/neonBranchId/);
});

void test("neon-secrets staging apply runs the GRANT as one named step", () => {
  const workflow = read(".github/workflows/reusable-deploy-neon-secrets.yml");
  const step = namedBlock(workflow, GRANT_STEP, 600);
  assert.match(step, /if: \$\{\{ inputs\.environment == 'staging' \}\}/);
  assert.match(step, /grant-migrator-ddl\.sh/);
});

void test("ci.yml production neon-secrets job does not run the GRANT", () => {
  const ciProd = namedBlock(read(".github/workflows/ci.yml"), PROD_JOB, 1500);
  assert.match(ciProd, /environment: production/);
  assert.doesNotMatch(ciProd, /grant-migrator-ddl/);
});

void test("deploy.yml production neon-secrets job does not run the GRANT", () => {
  const deployProd = namedBlock(read(".github/workflows/deploy.yml"), PROD_JOB, 1500);
  assert.match(deployProd, /environment: production/);
  assert.doesNotMatch(deployProd, /grant-migrator-ddl/);
});

void test("GRANT SQL renames leftover messages index so Atlas can create it", () => {
  const sql = read("infra/neon-secrets/grant-migrator-ddl.sql");
  assert.match(sql, /GRANT REFERENCES ON TABLE public\.sessions TO migrator;/);
  assert.match(sql, /ALTER INDEX IF EXISTS public\.idx_messages_session_created\s+RENAME TO idx_conversation_messages_session_created;/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP INDEX/i);
});

void test("Atlas 20260811000002 creates idx_messages_session_created on messages", () => {
  const sql = read("migrations/neon/20260811000002_table_messages.sql");
  assert.match(sql, /CREATE INDEX idx_messages_session_created ON public\.messages/);
});

void test("atlas.sum SHA-256 matches the SAFE-1 production pin", () => {
  const buf = readFileSync(`${ROOT}migrations/neon/atlas.sum`);
  assert.equal(createHash("sha256").update(buf).digest("hex"), "408d6b353b073dee99da33dc93cdb518354cd41f47ea87e24ef2301feeaef484");
});
