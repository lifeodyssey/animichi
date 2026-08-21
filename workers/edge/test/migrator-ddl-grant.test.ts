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

void test("GRANT SQL does not drop tables or indexes", () => {
  const sql = grantSql();
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

function atlasSumHash(file: string): string {
  const line = read("migrations/neon/atlas.sum")
    .split("\n")
    .find((row) => row.startsWith(`${file} `));
  assert.ok(line, file);
  const hash = line.slice(file.length + 1).trim();
  assert.match(hash, /^h1:/);
  return hash;
}

void test("GRANT SQL adds turn_reservations digest columns IF NOT EXISTS", () => {
  const sql = grantSql();
  assert.match(sql, /ALTER TABLE public\.turn_reservations\s+ADD COLUMN IF NOT EXISTS request_digest text;/);
  assert.match(sql, /ALTER TABLE public\.turn_reservations\s+ADD COLUMN IF NOT EXISTS outcome_payload jsonb;/);
});

void test("GRANT SQL creates turn_outbox_events IF NOT EXISTS", () => {
  const sql = grantSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.turn_outbox_events/);
  assert.match(sql, /CONSTRAINT turn_outbox_events_pkey PRIMARY KEY \(id\)/);
  assert.match(sql, /CONSTRAINT turn_outbox_events_turn_kind UNIQUE \(turn_key, kind\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_turn_outbox_undelivered/);
  assert.match(sql, /GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public\.turn_outbox_events TO agent_svc;/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.turn_outbox_events TO readonly;/);
});

void test("GRANT SQL records 20260814191301 applied with atlas.sum hash", () => {
  const hash = atlasSumHash("20260814191301_turn_idempotency_outbox.sql");
  const sql = grantSql();
  assert.match(sql, /INSERT INTO public\.atlas_schema_revisions/);
  assert.match(sql, /'20260814191301'/);
  assert.match(sql, new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sql, /applied\s*=\s*EXCLUDED\.applied/);
});

void test("Atlas 20260814191301 still ALTERs turn_reservations without IF NOT EXISTS", () => {
  const sql = read("migrations/neon/20260814191301_turn_idempotency_outbox.sql");
  assert.match(sql, /ALTER TABLE public\.turn_reservations\s+ADD COLUMN request_digest text;/);
  assert.match(sql, /ALTER TABLE public\.turn_reservations\s+ADD COLUMN outcome_payload jsonb;/);
  assert.doesNotMatch(sql, /IF NOT EXISTS/);
});
