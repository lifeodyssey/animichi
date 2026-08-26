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

// #1216 — the migrator's own error lived only in the discarded response body, so
// a reset staging database failed as a bare "HTTP 500". This repository is
// public: the body is logged, and any DSN in it must lose its password first.
const shellFunction = (name: string): string => {
  const lines = read(".github/scripts/promote-release-unit.sh").split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.notEqual(at, -1, `${name} must exist in the promotion script`);
  const end = lines.findIndex((line, index) => index > at && line === "}");
  return lines.slice(at, end + 1).join("\n");
};

const SECRET = "not-a-real-password";
const DSN_FORMS: readonly (readonly [string, string])[] = [
  ["URI user-info", `postgresql://migrator:${SECRET}@ep-x.neon.tech/neondb`],
  ["a URI parameter", `postgresql://ep-x.neon.tech/neondb?sslmode=require&password=${SECRET}`],
  ["a keyword/value DSN", `host=ep-x.neon.tech user=migrator password=${SECRET} dbname=neondb`],
];

const reportFailure = (body: string): { status: number | null; stdout: string } => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-body-"));
  writeFileSync(join(dir, "migrate.json"), body);
  const shipped = [shellFunction("report_migrator_failure"), shellFunction("redact_dsn_passwords")].join("\n");
  const source = `set -euo pipefail\nfail() { echo "FAILED:$*"; exit 1; }\n${shipped}\nreport_migrator_failure "migrator returned HTTP 500"`;
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: dir } });
  rmSync(dir, { force: true, recursive: true });
  return { status: result.status, stdout: result.stdout };
};

void test("a migrator failure logs its response body instead of only the status", () => {
  const reported = reportFailure(JSON.stringify({ detail: 'relation "public.atlas_schema_revisions" does not exist' }));
  assert.equal(reported.status, 1);
  assert.match(reported.stdout, /atlas_schema_revisions/);
  assert.match(reported.stdout, /FAILED:migrator returned HTTP 500/);
});

// PostgreSQL accepts the password three ways and the first version of this
// redaction covered only the first, so each form is asserted separately.
for (const [form, dsn] of DSN_FORMS) {
  void test(`the logged body keeps the host but drops a password given as ${form}`, () => {
    const reported = reportFailure(JSON.stringify({ error: `connect failed for ${dsn}` }));
    assert.doesNotMatch(reported.stdout, new RegExp(SECRET));
    assert.match(reported.stdout, /ep-x\.neon\.tech/);
  });
}

// Past the 64 KiB pipe buffer `| head -c` exits first, the redactor dies on
// SIGPIPE, and `set -e` takes the function down before `fail` reports anything.
void test("the failure message survives a body larger than the pipe buffer", () => {
  const reported = reportFailure(JSON.stringify({ error: `boom ${"x".repeat(200_000)}` }));
  assert.equal(reported.status, 1, "a large body must not turn the failure into SIGPIPE");
  assert.match(reported.stdout, /FAILED:migrator returned HTTP 500/);
  assert.ok(reported.stdout.length < 8_000, "the logged body must still be truncated");
});
