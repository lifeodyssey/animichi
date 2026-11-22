// SUT: infra/database-access/reset-staging-baseline.sh — an app marker the repository's migration
// graph does not carry, with no Atlas ledger: the state a regenerated chain leaves staging in. It is
// refused, printing every marker row and every table in `public` with its row count, unless the
// owner's dated record names exactly those lines. The script is sourced; only the reads that would
// reach Neon are replaced.
import assert from "node:assert/strict";
import test from "node:test";

import { type Outcome, sourcedResetScript, withRecordFile } from "./reset-staging-baseline-script.ts";

const HASH = "e".repeat(64);
const MARKER = `prisma_contract.marker space=app updated_at=2026-11-20T03:55:12.345678Z core_hash=${HASH}`;
const STATE = [MARKER, "public.sessions 4 rows", "public.spatial_ref_sys 8500 rows", "public.works 120 rows"];
const BACKUP = `staging-before-rebuild-${HASH.slice(0, 12)}`;

// A marker, no ledger, a graph that does not carry it; `query` answers the state's printed lines.
const offGraph = (record: string, state: readonly string[] = STATE): Outcome => sourcedResetScript(`
APPROVED_OLD_CHAIN="${record}"
app_marker_present() { return 0; }
atlas_ledger_present() { return 1; }
app_marker_in_graph() { return 1; }
query() { ROWS="${state.join("\n")}"; }
if stranded_on_atlas; then echo "REBUILD drop_marker_schema=$DROP_MARKER_SCHEMA backup=$BACKUP_NAME"; else echo NO_OP; fi`);

const withRecord = (lines: readonly string[], state: readonly string[] = STATE): Outcome =>
  withRecordFile(`# Approved on 2026-11-21: rebuild staging.\n${lines.join("\n")}\n`, (record) => offGraph(record, state));

const assertRefusedOffGraph = (outcome: Outcome): void => {
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stdout, "");
  assert.match(outcome.stderr, /^refusing reset: the Prisma app marker is no node of the repository's migration graph/);
};

void test("an off-graph marker with no record refuses, ending with its marker rows and public's tables", () => {
  const outcome = offGraph("/nonexistent/approved-old-chain");
  assertRefusedOffGraph(outcome);
  assert.match(outcome.stderr, /\(MIGRATION\.MARKER_MISMATCH\)/);
  assert.match(outcome.stderr, /name every\nline below in \/nonexistent\/approved-old-chain, with the date of that decision/);
  assert.ok(outcome.stderr.endsWith(`neondb_owner:\n${STATE.join("\n")}\n`));
});

void test("a record naming every printed line, in any order, approves the rebuild and names its backup", () => {
  withRecordFile(`# Approved on 2026-11-21.\n${[...STATE].reverse().join("\n")}\n`, (record) => {
    const outcome = offGraph(record);
    assert.equal(outcome.stderr, "");
    assert.equal(outcome.stdout, `the old chain's rebuild approved by ${record}; backup=${BACKUP}\n` +
      `REBUILD drop_marker_schema=true backup=${BACKUP}\n`);
  });
});

const MISMATCHES: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["a row count one off", STATE.map((line) => line.replace("works 120", "works 121")), STATE],
  ["an instant a microsecond off", STATE.map((line) => line.replace("12.345678Z", "12.345679Z")), STATE],
  ["another hash", STATE.map((line) => line.replace(HASH, "f".repeat(64))), STATE],
  ["a table left out", STATE.filter((line) => !line.includes("spatial_ref_sys")), STATE],
  ["a table that is not there", [...STATE, "public.walk_logs 0 rows"], STATE],
  ["a second space's marker left unnamed", STATE,
    [...STATE, `prisma_contract.marker space=geography updated_at=2026-11-20T03:55:12Z core_hash=${"c".repeat(64)}`]],
];

for (const [difference, lines, state] of MISMATCHES) {
  void test(`a record with ${difference} refuses as though there were none`, () => {
    assertRefusedOffGraph(withRecord(lines, state));
  });
}

const MALFORMED = [
  "public.*",
  "public.works",
  "pre-state: public.works 120 rows",
  `prisma_contract.marker space=app updated_at=* core_hash=${HASH}`,
  `prisma_contract.marker space=app updated_at=2026-11-20T03:55:12.345678Z core_hash=${HASH.slice(1)}`,
  `prisma_contract.marker space=app core_hash=${HASH} updated_at=2026-11-20T03:55:12.345678Z`,
];

for (const line of MALFORMED) {
  void test(`a record line that is not one printed line refuses by name: ${line}`, () => {
    const outcome = withRecord([...STATE, line]);
    assert.equal(outcome.status, 1);
    assert.equal(outcome.stdout, "");
    assert.match(outcome.stderr, /names something that is not one printed line: /);
    assert.ok(outcome.stderr.endsWith(`${line}\n`));
  });
}

void test("a record of comments alone approves nothing", () => {
  assertRefusedOffGraph(withRecordFile("# Approved on 2026-11-21.\n", (record) => offGraph(record)));
});

void test("a marker the graph carries, with no ledger, is a named no-op whatever the record says", () => {
  const outcome = withRecordFile(`${STATE.join("\n")}\n`, (record) => sourcedResetScript(`
APPROVED_OLD_CHAIN="${record}"
app_marker_present() { return 0; }
atlas_ledger_present() { return 1; }
app_marker_in_graph() { return 0; }
if stranded_on_atlas; then echo REBUILD; else echo NO_OP; fi`));
  assert.equal(outcome.stdout, "skip: the staging baseline is already applied\nNO_OP\n");
});

// The ledger decides first (#1781): beside it, the stale-marker record is the only way out, and the
// graph is never read.
void test("an off-graph marker beside the Atlas ledger takes the ledger's refusal, unread by the graph", () => {
  const outcome = sourcedResetScript(`
APPROVED_MARKER=/nonexistent/approved-marker
app_marker_present() { return 0; }
atlas_ledger_present() { return 0; }
app_marker_in_graph() { echo "GRAPH_READ" >&2; return 1; }
describe_marker_beside_ledger() { ROWS="prisma_contract.marker space=app updated_at=2026-11-20T03:55:12Z; 9 Atlas revisions, 3 tables in public"; }
if stranded_on_atlas; then echo REBUILD; else echo NO_OP; fi`);
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /^refusing reset: a Prisma app marker stands beside the Atlas ledger/);
  assert.doesNotMatch(outcome.stderr, /GRAPH_READ|no node of the repository's migration graph/);
});
