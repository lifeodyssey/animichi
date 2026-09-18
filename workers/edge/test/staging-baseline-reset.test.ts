import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
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
void test("staging reset is branch-backed and production-safe", () => {
  const sh = read("infra/database-access/reset-staging-baseline.sh");
  assert.match(sh, /Pulumi\.staging\.yaml/);
  assert.match(sh, /Pulumi\.prod\.yaml/);
  assert.match(sh, /BACKUP_NAME="staging-before-prisma-baseline"/);
  assert.match(sh, /branches create[\s\S]*--parent "\$BRANCH_ID"[\s\S]*--no-compute/);
  assert.match(sh, /--role-name "\$role"/);
  assert.match(sh, /OWNER_ROLE="neondb_owner"/);
  assert.match(sh, /neonctl@3\.6\.0/);
  assert.doesNotMatch(sh, /neonctl@latest/);
});

// audit §2.6: the reset SQL's three statements ran without a transaction wrapper — a
// mid-script failure could leave the schema dropped but not yet recreated/granted.
void test("the reset SQL runs as a single transaction", () => {
  const sh = read("infra/database-access/reset-staging-baseline.sh");
  assert.match(sh, /staging_psql "\$OWNER_ROLE" -1 -v ON_ERROR_STOP=1 -v drop_marker_schema="\$DROP_MARKER_SCHEMA" -f "\$RESET_SQL"/);
});

// #1781: the marker schema is a second target, only when the owner's record names its marker, and
// only its three tables by name: without CASCADE, anything else there rolls the reset back.
void test("reset SQL drops public, and prisma_contract only when told to", () => {
  const sql = read("infra/database-access/reset-staging-baseline.sql");
  assert.match(sql, /^\\if :drop_marker_schema\nDROP TABLE prisma_contract\.marker, prisma_contract\.ledger, prisma_contract\.contract;\nDROP SCHEMA prisma_contract;\n\\endif\n/);
  assert.match(sql, /DROP SCHEMA IF EXISTS public CASCADE/);
  assert.match(sql, /CREATE SCHEMA public/);
  assert.match(sql, /GRANT USAGE, CREATE ON SCHEMA public TO migrator/);
  assert.deepEqual(sql.match(/DROP \w+/g), ["DROP TABLE", "DROP SCHEMA", "DROP SCHEMA"]);
  assert.deepEqual(sql.match(/CASCADE/g), ["CASCADE"]);
  assert.doesNotMatch(sql, /neon_auth|production/i);
});

// Owner decision 2026-08-27 (reverses #539 for STAGING ONLY): the CD smoke
// probes workers.dev because the zone front door bot-challenges GitHub-runner
// IPs. Production must never re-open it.
void test("workers_dev is open for staging only, never production", () => {
  const toml = read("workers/edge/wrangler.toml");
  const staging = toml.slice(toml.indexOf("[env.staging]"));
  assert.match(staging, /^workers_dev = true$/m);
  // Production carries no explicit workers_dev: wrangler defaults it to false,
  // and the guard is that nobody ever writes `true` there.
  const production = toml.slice(toml.indexOf("[env.production]"), toml.indexOf("[env.staging]"));
  assert.doesNotMatch(production, /^workers_dev = true$/m);
});

// #1216 — the migrator's own error lived only in the discarded response body, so
// a reset staging database failed as a bare "HTTP 500". This repository is
// public: the body is logged, and any DSN in it must lose its password first.
const shellFunction = (name: string): string => {
  const lines = read("scripts/delivery/migrate-through-worker.sh").split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.notEqual(at, -1, `${name} must exist in the migration handshake`);
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
  const response = join(dir, "migrate.json");
  writeFileSync(response, body);
  const shipped = [shellFunction("report_failure"), shellFunction("redact_dsn_passwords")].join("\n");
  const source = `set -euo pipefail\nRESPONSE="${response}"\nfail() { echo "FAILED:$*"; exit 1; }\n${shipped}\nreport_failure "migrator returned HTTP 500"`;
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8" });
  rmSync(dir, { force: true, recursive: true });
  return { status: result.status, stdout: result.stdout };
};

void test("a migrator failure logs its response body instead of only the status", () => {
  const reported = reportFailure(JSON.stringify({ detail: 'relation "prisma_contract.marker" does not exist' }));
  assert.equal(reported.status, 1);
  assert.match(reported.stdout, /prisma_contract\.marker/);
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

// audit §2.6: a failed `staging_psql` call (connection/permission failure) produced the
// same empty stdout as a successful query answering "false" — both fell through
// `grep -qx t` to "not applied" and triggered `DROP SCHEMA CASCADE`. These run the shipped
// `query`/`fail_unconfirmed`/`query_bool`/`marker_schema_exists`/`app_marker_present` functions
// with a stub `staging_psql` standing in for the real connection, so "cannot confirm" and
// "confirmed unapplied" are proven to take different paths rather than just asserting the source
// text says so.
const resetShellFunction = (name: string): string => {
  const lines = read("infra/database-access/reset-staging-baseline.sh").split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.notEqual(at, -1, `${name} must exist in the reset script`);
  const end = lines.findIndex((line, index) => index > at && line === "}");
  return lines.slice(at, end + 1).join("\n");
};

const shippedBaselineCheck = [
  resetShellFunction("query"),
  resetShellFunction("fail_unconfirmed"),
  resetShellFunction("query_bool"),
  resetShellFunction("marker_schema_exists"),
  resetShellFunction("app_marker_present"),
].join("\n");

const runBaselineApplied = (stagingPsqlBody: string): { status: number | null; stdout: string } => {
  const source = `set -euo pipefail
MARKER_SCHEMA="prisma_contract"
OWNER_ROLE="neondb_owner"
ROWS=""
fail() { echo "FAILED:$*"; exit 1; }
staging_psql() {
${stagingPsqlBody}
}
${shippedBaselineCheck}
if app_marker_present; then echo "ALREADY_APPLIED"; else echo "NOT_APPLIED"; fi`;
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
};

void test("a psql connection failure refuses the reset instead of treating it as unapplied", () => {
  const result = runBaselineApplied('echo "connection to server failed" >&2\n  return 2');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAILED:cannot confirm staging state/);
  assert.doesNotMatch(result.stdout, /NOT_APPLIED|ALREADY_APPLIED/);
});

// `app_marker_present` calls `staging_psql` twice — once through `marker_schema_exists` (does the
// marker schema exist), once for the marker row (has this chain been applied). A
// call-counter file lets the stub answer each call differently.
const runBaselineAppliedTwoCalls = (
  firstAnswer: string,
  secondAnswer: string,
): { status: number | null; stdout: string } => {
  const dir = mkdtempSync(join(tmpdir(), "baseline-check-"));
  const counter = join(dir, "calls");
  const stub = `count=0
[ -f "${counter}" ] && count="$(cat "${counter}")"
count=$((count + 1))
echo "$count" > "${counter}"
if [ "$count" = 1 ]; then echo "${firstAnswer}"; else echo "${secondAnswer}"; fi`;
  const result = runBaselineApplied(stub);
  rmSync(dir, { force: true, recursive: true });
  return result;
};

void test("a confirmed-unapplied baseline (marker schema exists, marker query answers f) allows the reset to proceed", () => {
  const result = runBaselineAppliedTwoCalls("t", "f");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NOT_APPLIED/);
});

void test("a confirmed-applied baseline (marker schema exists, marker query answers t) skips the reset", () => {
  const result = runBaselineAppliedTwoCalls("t", "t");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ALREADY_APPLIED/);
});
