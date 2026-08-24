import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const grantSql = (): string =>
  read("infra/neon-secrets/grant-migrator-ddl.sql").replaceAll(/^--.*$/gm, "");

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
  const sql = grantSql();
  assert.match(sql, /GRANT USAGE,\s*CREATE ON SCHEMA public TO migrator;/);
  assert.match(sql, /GRANT REFERENCES ON TABLE public.sessions TO migrator;/);
  assert.doesNotMatch(sql, /ALL TABLES/);
  assert.doesNotMatch(sql, /GRANT migrator TO/);
  assert.doesNotMatch(sql, /GRANT neondb_owner TO/);
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

void test("GRANT SQL still grants REFERENCES on sessions", () => {
  assert.match(grantSql(), /GRANT REFERENCES ON TABLE public\.sessions TO migrator;/);
});

void test("GRANT SQL EXISTS check is on conversation_messages", () => {
  assert.match(grantSql(), /EXISTS \([\s\S]*t\.relname = 'conversation_messages'/);
});

void test("GRANT SQL renames leftover to idx_conversation_messages_session_created", () => {
  assert.match(grantSql(), /RENAME TO idx_conversation_messages_session_created;/);
});

void test("GRANT SQL does not drop leftover or migrator-owned tables", () => {
  const sql = grantSql();
  assert.doesNotMatch(sql, /DROP TABLE public\.conversation_messages/i);
  assert.doesNotMatch(sql, /DROP TABLE public\.sessions/i);
  assert.doesNotMatch(sql, /DROP TABLE public\.messages/i);
  assert.doesNotMatch(sql, /DROP INDEX/i);
});

void test("Atlas 20260811000002 creates idx_messages_session_created on messages", () => {
  const sql = read("migrations/neon/20260811000002_table_messages.sql");
  assert.match(sql, /CREATE INDEX idx_messages_session_created ON public\.messages/);
});

void test("atlas.sum SHA-256 matches the SAFE-1 production pin", () => {
  const buf = readFileSync(`${ROOT}migrations/neon/atlas.sum`);
  assert.equal(createHash("sha256").update(buf).digest("hex"), "04a468633a1df3a4af234d76d8b18652142245bc132dae73ea1017b861703751");
});

void test("GRANT SQL drops turn_reservations only when owned by neondb_owner", () => {
  const sql = grantSql();
  assert.match(sql, /c\.relname = 'turn_reservations'/);
  assert.match(sql, /r\.rolname = 'neondb_owner'/);
  assert.match(sql, /DROP TABLE public\.turn_reservations CASCADE;/);
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS/);
  assert.doesNotMatch(sql, /INSERT INTO public\.atlas_schema_revisions/);
});

void test("GRANT SQL un-applies turn_reservations Atlas versions when the table is gone", () => {
  const sql = grantSql();
  assert.match(sql, /DELETE FROM public\.atlas_schema_revisions/);
  assert.match(sql, /'20260811000000'/);
  assert.match(sql, /'20260811000001'/);
  assert.match(sql, /'20260814191301'/);
});

void test("Atlas 20260814191301 still ALTERs turn_reservations without IF NOT EXISTS", () => {
  const sql = read("migrations/neon/20260814191301_turn_idempotency_outbox.sql");
  assert.match(sql, /ALTER TABLE public\.turn_reservations\s+ADD COLUMN request_digest text;/);
  assert.match(sql, /ALTER TABLE public\.turn_reservations\s+ADD COLUMN outcome_payload jsonb;/);
  assert.doesNotMatch(sql, /IF NOT EXISTS/);
});
