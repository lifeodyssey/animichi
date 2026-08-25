import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const grantSql = (): string =>
  read("infra/database-access/grant-migrator-ddl.sql").replaceAll(/^--.*$/gm, "");

void test("staging GRANT gives migrator CREATE on public", () => {
  const sql = grantSql();
  assert.match(sql, /GRANT USAGE,\s*CREATE ON SCHEMA public TO migrator;/);
  assert.match(sql, /GRANT REFERENCES ON TABLE public.sessions TO migrator;/);
  assert.doesNotMatch(sql, /ALL TABLES/);
  assert.doesNotMatch(sql, /GRANT neondb_owner TO/);
  assert.doesNotMatch(sql, /Pulumi\.prod|production/i);
});

// The blanket `GRANT migrator TO` ban banned both directions at once. Only one
// is an escalation: handing neondb_owner (already the admin) the narrower role
// is what PostgreSQL requires before it will let it transfer ownership, and it
// must not outlive the script. `GRANT neondb_owner TO migrator` — the direction
// that would widen migrator — stays banned in the case above.
void test("GRANT SQL takes the migrator role only for neondb_owner, and gives it back", () => {
  const sql = grantSql();
  assert.match(sql, /^GRANT migrator TO neondb_owner;$/m);
  assert.match(sql, /^REVOKE migrator FROM neondb_owner;$/m);
  assert.doesNotMatch(sql, /GRANT migrator TO (?!neondb_owner;)/);
  assert.ok(
    sql.indexOf("GRANT migrator TO neondb_owner;") < sql.indexOf("REVOKE migrator FROM neondb_owner;"),
    "the membership must be granted before it is revoked",
  );
});

// Ownership replaced a blanket `OWNER TO` ban here. DDL is not a grantable
// privilege in PostgreSQL, so migrator can only ALTER what it owns; the ban
// made the 26 baselined tables permanently unmigratable. What still must hold
// is that the transfer is narrow: only relations neondb_owner actually owns,
// only to migrator, and never by handing over the role itself.
void test("GRANT SQL moves only neondb_owner's own relations, and only to migrator", () => {
  const sql = grantSql();
  assert.match(sql, /ALTER TABLE public\.%I OWNER TO migrator/);
  assert.match(sql, /ALTER SEQUENCE public\.%I OWNER TO migrator/);
  assert.match(sql, /c\.relkind IN \('r', 'S'\)/);
  assert.match(sql, /r\.rolname = 'neondb_owner'/);
  assert.doesNotMatch(sql, /OWNER TO (?!migrator)/);
  assert.doesNotMatch(sql, /OWNER TO CURRENT_USER|OWNER TO SESSION_USER/i);
});

void test("staging owner GRANT is applied as neondb_owner", () => {
  const sh = read("infra/database-access/grant-migrator-ddl.sh");
  assert.match(sh, /Pulumi\.staging\.yaml/);
  assert.match(sh, /--role-name neondb_owner/);
  assert.match(sh, /ON_ERROR_STOP=1/);
  assert.match(sh, /neonctl@3\.6\.0/);
  assert.doesNotMatch(sh, /neonctl@latest/);
  assert.match(sh, /Failed to read neonProjectId\/neonBranchId/);
});

void test("sealed infra promotion grants migrator DDL only on staging", () => {
  const promotion = read(".github/scripts/promote-release-unit.sh");
  assert.match(promotion, /grant_staging_migrator_ddl\(\)/);
  assert.match(promotion, /\[ "\$TARGET_ENVIRONMENT" = staging \] \|\| return 0/);
  assert.match(promotion, /\$PAYLOAD_DIR\/infra\/database-access\/grant-migrator-ddl\.sh/);
  assert.match(promotion, /apply_pulumi_project[\s\S]*grant_staging_migrator_ddl[\s\S]*apply_pulumi_project/);
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
  assert.equal(createHash("sha256").update(buf).digest("hex"), "408d6b353b073dee99da33dc93cdb518354cd41f47ea87e24ef2301feeaef484");
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
