import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const BASELINE = "20260826000000_baseline.sql";

void test("Neon history is one canonical baseline", () => {
  const files = readdirSync(`${ROOT}migrations/neon`).filter((name) => name.endsWith(".sql"));
  assert.deepEqual(files, [BASELINE]);
  assert.match(read("migrations/neon/atlas.sum"), new RegExp(`^${BASELINE} h1:`, "m"));
});

void test("baseline contains only the final schema", () => {
  const sql = read(`migrations/neon/${BASELINE}`);
  assert.doesNotMatch(sql, /public\.api_keys/i);
  assert.match(sql, /CREATE TABLE "public"\."turn_reservations"/);
  assert.match(sql, /"request_digest" text NULL/);
  assert.match(sql, /"outcome_payload" jsonb NULL/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.turn_reservations/i);
});

void test("baseline closes the catalog runtime grant gap", () => {
  const sql = read(`migrations/neon/${BASELINE}`);
  assert.match(sql, /GRANT ALL ON TABLE public\.catalog_runs TO catalog_svc/);
  assert.match(sql, /GRANT ALL ON TABLE public\.raw_payload_history TO catalog_svc/);
  assert.match(sql, /GRANT SELECT, USAGE ON SEQUENCE public\.raw_payload_history_seq_seq TO catalog_svc/);
});

void test("staging reset is branch-backed and production-safe", () => {
  const sh = read("infra/database-access/reset-staging-baseline.sh");
  assert.match(sh, /Pulumi\.staging\.yaml/);
  assert.match(sh, /Pulumi\.prod\.yaml/);
  assert.match(sh, /staging-before-\$\{BASELINE_VERSION\}-baseline/);
  assert.match(sh, /branches create[\s\S]*--parent "\$BRANCH_ID"[\s\S]*--no-compute/);
  assert.match(sh, /--role-name "\$role"/);
  assert.match(sh, /staging_psql neondb_owner/);
  assert.match(sh, /neonctl@3\.6\.0/);
  assert.doesNotMatch(sh, /neonctl@latest/);
});

void test("reset SQL has one exact destructive target", () => {
  const sql = read("infra/database-access/reset-staging-baseline.sql");
  assert.match(sql, /DROP SCHEMA IF EXISTS public CASCADE/);
  assert.match(sql, /CREATE SCHEMA public/);
  assert.match(sql, /GRANT USAGE, CREATE ON SCHEMA public TO migrator/);
  assert.doesNotMatch(sql, /DROP DATABASE|DROP ROLE|production/i);
});

void test("CD resets only staging and blocks production baseline SQL", () => {
  const promotion = read(".github/scripts/promote-release-unit.sh");
  assert.match(promotion, /reset_staging_baseline\(\)/);
  assert.match(promotion, /\[ "\$TARGET_ENVIRONMENT" = staging \] \|\| return 0/);
  assert.match(promotion, /reset-staging-baseline\.sh/);
  assert.match(promotion, /STAGING_ONLY_BASELINE/);
  assert.match(promotion, /staging-only baseline requires a separately approved production cutover/);
});

void test("atlas.sum SHA-256 pins the hard-cut payload", () => {
  const sum = readFileSync(`${ROOT}migrations/neon/atlas.sum`);
  assert.equal(createHash("sha256").update(sum).digest("hex"), "08a65b2155484cc56ff905b8116eb758ecc333e73a3ab35313948ac14a977fe4");
});
