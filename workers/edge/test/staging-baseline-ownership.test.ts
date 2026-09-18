// SUT: infra/database-access/reset-staging-baseline.sh — who owns staging, and whose rows the
// rebuild may drop (#1781). The script is sourced, so the shipped functions run as written; only
// the reads that would reach Neon are replaced, each by the answer a case needs.
import assert from "node:assert/strict";
import test from "node:test";

import { type Outcome, sourcedResetScript, withRecordFile } from "./reset-staging-baseline-script.ts";

const answer = (present: boolean): string => (present ? "return 0" : "return 1");

// Under a marker, the one Atlas leftover that can tell the chains apart is the ledger: a
// Prisma-owned `public` holds tables too. Without one, any table the chain left counts.
const ownership = (marker: boolean, leftovers: boolean): Outcome => sourcedResetScript(`
APPROVED_MARKER=/nonexistent/approved-marker
app_marker_present() { ${answer(marker)}; }
atlas_ledger_present() { ${answer(leftovers)}; }
atlas_leftovers_present() { ${answer(leftovers)}; }
describe_marker_beside_ledger() {
  ROWS="prisma_contract.marker space=app updated_at=2026-09-12T06:49:00Z; 10 Atlas revisions, 42 tables in public"
}
if stranded_on_atlas; then echo REBUILD; else echo NO_OP; fi`);

void test("a marker with no Atlas ledger is Prisma's: a named no-op", () => {
  const outcome = ownership(true, false);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stdout, "skip: the staging baseline is already applied\nNO_OP\n");
});

void test("Atlas leftovers with no marker are what the rebuild exists for", () => {
  const outcome = ownership(false, true);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stdout, "REBUILD\n");
});

void test("neither a marker nor leftovers is a named no-op", () => {
  const outcome = ownership(false, false);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stdout, "skip: staging holds no Atlas leftovers\nNO_OP\n");
});

void test("a marker beside the Atlas ledger refuses, quoting both signals and the way out", () => {
  const outcome = ownership(true, true);
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stdout, "");
  assert.match(outcome.stderr, /^refusing reset: a Prisma app marker stands beside the Atlas ledger/);
  assert.match(outcome.stderr, /space=app updated_at=2026-09-12T06:49:00Z; 10 Atlas revisions, 42 tables in public/);
  assert.match(outcome.stderr, /refuses this database as atlas_leftovers_present/);
  assert.match(outcome.stderr, /name each marker row above in \/nonexistent\/approved-marker; the rebuild then drops the whole prisma_contract\nschema \(marker, ledger, contract\) with public, in one transaction, after its backup branch\.\n$/);
  assert.doesNotMatch(outcome.stderr, /drop the/i);
});

// The committed approval (#1781) names the seven tables staging held rows in on 2026-09-18.
const STAGING_2026_09_18 = [
  "public.agent_admissions", "public.agent_settlements", "public.ingest_jobs", "public.pi_records",
  "public.pi_scalar_values", "public.pi_sessions", "public.sessions",
];

const businessRows = (tables: readonly string[], record = ""): Outcome => sourcedResetScript(`
${record && `APPROVED_ROWS="${record}"`}
query() { ROWS="${tables.join("\n")}"; }
refuse_business_rows
echo PROCEEDS`);

// Through the shipped `query` and the shape neonctl actually emits (#1793): the connection
// diagnostic reaches the read on stderr, ahead of the table names.
const businessRowsLive = (tables: readonly string[], record = ""): Outcome => sourcedResetScript(`
${record && `APPROVED_ROWS="${record}"`}
staging_psql() {
  printf 'INFO: Connecting to the database using psql...\\n' >&2
  printf '%s\\n' ${tables.map((table) => `"${table}"`).join(" ")}
}
refuse_business_rows
echo PROCEEDS`);

void test("rows only in the tables the committed record approves proceed", () => {
  const outcome = businessRows(STAGING_2026_09_18);
  assert.equal(outcome.stderr, "");
  assert.equal(outcome.stdout, "PROCEEDS\n");
});

void test("the connection diagnostic is not mistaken for a table holding rows", () => {
  const outcome = businessRowsLive(STAGING_2026_09_18);
  assert.equal(outcome.stderr, "INFO: Connecting to the database using psql...\n");
  assert.equal(outcome.stdout, "PROCEEDS\n");
});

void test("no rows at all proceed", () => {
  assert.equal(businessRows([]).stdout, "PROCEEDS\n");
});

void test("a table outside the approved set refuses, naming only the difference", () => {
  const outcome = businessRows(["public.sessions", "public.bangumi", "public.points"]);
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /^refusing reset: business rows in public\.bangumi, public\.points, which \S+reset-staging-baseline\.approved-rows does not approve\n$/);
});

void test("a table created after the approval refuses once it holds a row", () => {
  const outcome = businessRows([...STAGING_2026_09_18, "public.walk_logs"]);
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /^refusing reset: business rows in public\.walk_logs, which /);
});

void test("a record line that is not one literal table refuses, whatever holds rows", () => {
  withRecordFile("# a wildcard\npublic.*\npublic.sessions\n", (record) => {
    const outcome = businessRows([], record);
    assert.equal(outcome.status, 1);
    assert.match(outcome.stderr, /names something that is not a table: public\.\*\n$/);
  });
});

void test("a record approving nothing refuses every row", () => {
  withRecordFile("# only comments\n", (record) => {
    const outcome = businessRows(["public.sessions"], record);
    assert.equal(outcome.status, 1);
    assert.match(outcome.stderr, /^refusing reset: business rows in public\.sessions, which /);
  });
});

void test("a record that cannot be read refuses", () => {
  const outcome = businessRows([], "/nonexistent/approved-rows");
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stderr, "refusing reset: cannot read /nonexistent/approved-rows\n");
});
