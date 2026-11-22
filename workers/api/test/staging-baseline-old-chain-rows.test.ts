// SUT: infra/database-access/reset-staging-baseline.sh — when the owner's record of an old chain,
// rather than the Atlas path's approved rows, decides whether `public`'s rows may go. It does after
// it approved the whole rebuild, and after a half-reset: the migrator's drop committed, the owner's
// did not, and a re-run finds no marker schema and `public` exactly as the record names it. The
// script is sourced; only the reads that would reach Neon are replaced.
import assert from "node:assert/strict";
import test from "node:test";

import { type Outcome, sourcedResetScript, withRecordFile } from "./reset-staging-baseline-script.ts";

const HASH = "e".repeat(64);
const MARKER = `prisma_contract.marker space=app updated_at=2026-11-20T03:55:12.345678Z core_hash=${HASH}`;
const PUBLIC = ["public.sessions 4 rows", "public.works 120 rows"];
const BACKUP = `staging-before-rebuild-${HASH.slice(0, 12)}`;

const answer = (present: boolean): string => (present ? "return 0" : "return 1");

// A re-run on the leftovers path: `marker_schema_exists` says whether the migrator's drop committed,
// and `query` answers `public`'s printed lines.
const rowsDecision = (record: string, publicLines: readonly string[], markerSchema = false): Outcome => sourcedResetScript(`
APPROVED_OLD_CHAIN="${record}"
marker_schema_exists() { echo "READ marker schema" >&2; ${answer(markerSchema)}; }
query() { echo "READ public" >&2; ROWS="${publicLines.join("\n")}"; }
if old_chain_rows_approved; then echo "ROWS_APPROVED backup=$BACKUP_NAME"; else echo NOT_APPROVED; fi`);

const recorded = (lines: readonly string[], publicLines: readonly string[], markerSchema = false): Outcome =>
  withRecordFile(`# Approved on 2026-11-21: rebuild staging.\n${lines.join("\n")}\n`,
    (record) => rowsDecision(record, publicLines, markerSchema));

void test("after a half-reset, `public` exactly as the record names it is the record's to drop", () => {
  withRecordFile(`# Approved on 2026-11-21.\n${[MARKER, ...PUBLIC].join("\n")}\n`, (record) => {
    const outcome = rowsDecision(record, PUBLIC);
    assert.equal(outcome.stdout, `a half-reset of the old chain's rebuild approved by ${record}; backup=${BACKUP}\n` +
      `ROWS_APPROVED backup=${BACKUP}\n`);
  });
});

void test("after a half-reset, a `public` that changed since the record is not the record's", () => {
  assert.equal(recorded([MARKER, ...PUBLIC], ["public.sessions 5 rows", "public.works 120 rows"]).stdout, "NOT_APPROVED\n");
});

void test("with the marker schema still standing, it is no half-reset, and `public` is not read", () => {
  const outcome = recorded([MARKER, ...PUBLIC], PUBLIC, true);
  assert.equal(outcome.stdout, "NOT_APPROVED\n");
  assert.doesNotMatch(outcome.stderr, /READ public/);
});

void test("a record that names no app marker approves no half-reset", () => {
  assert.equal(recorded(PUBLIC, PUBLIC).stdout, "NOT_APPROVED\n");
});

// Until the owner signs, the record does not exist: the leftovers path then reads nothing more than
// it did before this path, and the Atlas path's approved rows decide.
void test("without a record, nothing is read and the Atlas path's approval decides", () => {
  const outcome = rowsDecision("/nonexistent/approved-old-chain", PUBLIC);
  assert.equal(outcome.stdout, "NOT_APPROVED\n");
  assert.equal(outcome.stderr, "");
});

void test("once the record has approved the whole rebuild, the rows are its, unread", () => {
  const outcome = sourcedResetScript(`
OLD_CHAIN_APPROVED=true
marker_schema_exists() { echo "READ marker schema" >&2; return 0; }
if old_chain_rows_approved; then echo ROWS_APPROVED; else echo NOT_APPROVED; fi`);
  assert.equal(outcome.stdout, "ROWS_APPROVED\n");
  assert.equal(outcome.stderr, "");
});

// `main` after the dispatcher approved an old chain's rebuild: the Atlas path's approved-rows check
// does not run, the backup is the one named after the marker, and it precedes both transactions.
void test("an approved old-chain rebuild skips the approved rows and backs up under the marker's name first", () => {
  const writes = sourcedResetScript(`
NEON_API_KEY=stub
load_target() { :; }
stranded_on_atlas() { DROP_MARKER_SCHEMA=true; OLD_CHAIN_APPROVED=true; BACKUP_NAME="${BACKUP}"; }
refuse_business_rows() { echo "CALL refuse_business_rows" >&2; }
neonctl() { echo "CALL neonctl $*" >&2; }
staging_psql() { echo "CALL psql $*" >&2; }
main`).stderr.split("\n").filter((line) => /^CALL (neonctl branches create|psql \S+ -1|refuse_business_rows)/.test(line));
  assert.equal(writes.length, 3);
  assert.match(writes[0] ?? "", new RegExp(`^CALL neonctl branches create .*--name ${BACKUP} --no-compute`));
  assert.match(writes[1] ?? "", /^CALL psql migrator -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=true -v public_reset=false -f /);
  assert.match(writes[2] ?? "", /^CALL psql neondb_owner -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=false -v public_reset=true -f /);
});
