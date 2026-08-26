import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const BASELINE_FILES = [
  "20260826000000_extensions.sql",
  "20260826000001_roles.sql",
  "20260826000002_functions.sql",
  "20260826000003_catalog.sql",
  "20260826000004_agent.sql",
  "20260826000005_users.sql",
];
const baselineSql = (): string => BASELINE_FILES.map((name) => read(`migrations/neon/${name}`)).join("\n");

void test("Neon history is the six canonical baseline files, applied in dependency order", () => {
  const files = readdirSync(`${ROOT}migrations/neon`).filter((name) => name.endsWith(".sql"));
  assert.deepEqual(files.sort(), [...BASELINE_FILES].sort());
  const sum = read("migrations/neon/atlas.sum");
  for (const name of BASELINE_FILES) {
    assert.match(sum, new RegExp(`^${name} h1:`, "m"));
  }
});

void test("baseline contains only the final schema", () => {
  const sql = baselineSql();
  assert.doesNotMatch(sql, /public\.api_keys/i);
  assert.match(sql, /CREATE TABLE public\.turn_reservations/);
  assert.match(sql, /request_digest text NULL/);
  assert.match(sql, /outcome_payload jsonb NULL/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.turn_reservations/i);
});

void test("baseline closes the catalog runtime grant gap", () => {
  const sql = read("migrations/neon/20260826000003_catalog.sql");
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

// The assertions above only prove the message is present in the file. A stray
// `+` shipped on this branch left them all green while turning the guard into
// `+: command not found`, so these run the shipped lines against a real payload.
const productionGuard = (): string => {
  const lines = read(".github/scripts/promote-release-unit.sh").split("\n");
  const at = lines.findIndex((line) => line.includes('migrations/STAGING_ONLY_BASELINE"'));
  assert.notEqual(at, -1, "promotion script must guard on the staging-only marker");
  return lines.slice(at, at + 2).join("\n");
};

const runProductionGuard = (marked: boolean): { status: number | null; stdout: string } => {
  const payload = mkdtempSync(join(tmpdir(), "promote-guard-"));
  mkdirSync(join(payload, "migrations"), { recursive: true });
  if (marked) writeFileSync(join(payload, "migrations", "STAGING_ONLY_BASELINE"), "");
  const source = `set -euo pipefail\nfail() { echo "BLOCKED:$*"; exit 1; }\n${productionGuard()}\necho PROCEEDED`;
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8", env: { ...process.env, PAYLOAD_DIR: payload } });
  rmSync(payload, { force: true, recursive: true });
  return { status: result.status, stdout: result.stdout };
};

void test("the shipped guard blocks production when the staging-only marker is present", () => {
  const blocked = runProductionGuard(true);
  assert.equal(blocked.status, 1, "guard must exit 1 through fail, not a shell error");
  assert.match(blocked.stdout, /BLOCKED:staging-only baseline requires a separately approved production cutover/);
});

void test("the shipped guard lets a payload without the marker through", () => {
  const allowed = runProductionGuard(false);
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /PROCEEDED/);
});

void test("atlas.sum SHA-256 pins the hard-cut payload", () => {
  const sum = readFileSync(`${ROOT}migrations/neon/atlas.sum`);
  assert.equal(createHash("sha256").update(sum).digest("hex"), "0145e2c1489db593740d9234c62f4f964cb3141949de262e082e7527d9a71960");
});
