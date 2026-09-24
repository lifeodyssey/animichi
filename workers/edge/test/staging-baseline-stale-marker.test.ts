// SUT: infra/database-access/reset-staging-baseline.sh — the owner's record of a stale marker, and
// when the rebuild may clear it (#1781). A marker beside the Atlas ledger is refused unless the
// record names every row the reset would take; the reset clears it only after the backup branch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

import { type Outcome, sourcedResetScript, withRecordFile } from "./reset-staging-baseline-script.ts";

const STALE = "prisma_contract.marker space=app updated_at=2026-09-12T06:49:07.123456Z";

// Staging's state in #1781: a marker and the ledger both stand. `query` answers the rows the
// marker table holds, in the rendering the script asks for.
const besideLedger = (markerRows: readonly string[], record: string): Outcome => sourcedResetScript(`
APPROVED_MARKER="${record}"
app_marker_present() { return 0; }
atlas_ledger_present() { return 0; }
describe_marker_beside_ledger() { ROWS="${markerRows.join(", ")}; 10 Atlas revisions, 42 tables in public"; }
query() { ROWS="${markerRows.join("\n")}"; }
if stranded_on_atlas; then echo "REBUILD drop_marker_schema=$DROP_MARKER_SCHEMA"; else echo NO_OP; fi`);

const withRecord = (markerRows: readonly string[], record: string): Outcome =>
  withRecordFile(`# approved\n${record}\n`, (approved) => besideLedger(markerRows, approved));

// The real Neon path (#1793): `neonctl psql` announces every connection on stderr
// (neonctl's log.info), and the shipped `query` reads the command's output — so the record is
// matched against what the query actually reads back, diagnostic and all.
const besideLedgerLive = (markerRows: readonly string[], record: string): Outcome => sourcedResetScript(`
APPROVED_MARKER="${record}"
app_marker_present() { return 0; }
atlas_ledger_present() { return 0; }
describe_marker_beside_ledger() { ROWS="${markerRows.join(", ")}; 10 Atlas revisions, 42 tables in public"; }
staging_psql() {
  printf 'INFO: Connecting to the database using psql...\\n' >&2
  printf '%s\\n' ${markerRows.map((row) => `"${row}"`).join(" ")}
}
if stranded_on_atlas; then echo "REBUILD drop_marker_schema=$DROP_MARKER_SCHEMA"; else echo NO_OP; fi`);

const withRecordLive = (markerRows: readonly string[], lines: string): Outcome =>
  withRecordFile(`# approved\n${lines}\n`, (approved) => besideLedgerLive(markerRows, approved));

const assertRefusedBesideLedger = (outcome: Outcome): void => {
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stdout, "");
  assert.match(outcome.stderr, /^refusing reset: a Prisma app marker stands beside the Atlas ledger/);
};

void test("a record naming the one marker that stands lets the rebuild clear it", () => {
  withRecordFile(`# approved\n${STALE}\n`, (record) => {
    const outcome = besideLedger([STALE], record);
    assert.equal(outcome.stderr, "");
    assert.equal(outcome.stdout, `stale marker approved by ${record}: ${STALE}\nREBUILD drop_marker_schema=true\n`);
  });
});

void test("a record naming another instant refuses, even a microsecond away", () => {
  assertRefusedBesideLedger(withRecord([STALE], STALE.replace("07.123456Z", "07.123457Z")));
});

void test("a record naming another space refuses", () => {
  assertRefusedBesideLedger(withRecord([STALE], STALE.replace("space=app", "space=geography")));
});

void test("a record that leaves a row of the marker table unnamed refuses", () => {
  const extension = "prisma_contract.marker space=geography updated_at=2026-09-12T06:49:07.200000Z";
  assertRefusedBesideLedger(withRecord([STALE, extension], STALE));
});

void test("a connection diagnostic ahead of the row is read as the row alone", () => {
  withRecordFile(`# approved\n${STALE}\n`, (record) => {
    const outcome = besideLedgerLive([STALE], record);
    assert.equal(outcome.status, 0);
    assert.equal(outcome.stdout, `stale marker approved by ${record}: ${STALE}\nREBUILD drop_marker_schema=true\n`);
    assert.equal(outcome.stderr, "INFO: Connecting to the database using psql...\n");
  });
});

void test("the diagnostic does not soften the match: one character off still refuses", () => {
  const outcome = withRecordLive([STALE.replace("07.123456Z", "07.123457Z")], STALE);
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stdout, "");
  assert.match(outcome.stderr, /^INFO: Connecting to the database using psql\.\.\.\nrefusing reset: a Prisma app marker stands beside the Atlas ledger/);
});

void test("no record is the refusal the rebuild already gave", () => {
  assertRefusedBesideLedger(besideLedger([STALE], "/nonexistent/approved-marker"));
});

void test("a record approving nothing is the same refusal", () => {
  assertRefusedBesideLedger(withRecord([STALE], "# only comments"));
});

// The owner's read of staging on 2026-09-18 found one marker row; the committed record approves
// that row and nothing else.
void test("the committed record names staging's one marker, to the microsecond", () => {
  const record = readFileSync(fileURLToPath(new URL("../../../infra/database-access/reset-staging-baseline.approved-marker", import.meta.url)), "utf8");
  const rows = record.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  assert.deepEqual(rows, ["prisma_contract.marker space=app updated_at=2026-09-12T06:49:39.423732Z"]);
});

const WILDCARDS = [
  "prisma_contract.marker space=app updated_at=*",
  "prisma_contract.marker space=app",
  "prisma_contract.marker space=.* updated_at=2026-09-12T06:49:07.123456Z",
  "prisma_contract.marker space=app updated_at=2026-09-12T06:49Z",
  "prisma_contract.*",
];

for (const line of WILDCARDS) {
  void test(`a record line that is not one marker row refuses by name: ${line}`, () => {
    const outcome = withRecord([STALE], `${STALE}\n${line}`);
    assert.equal(outcome.status, 1);
    assert.equal(outcome.stdout, "");
    assert.match(outcome.stderr, /names something that is not one marker row: /);
    assert.ok(outcome.stderr.endsWith(`${line}\n`));
  });
}

// `main` with every read answered and every write recorded, in the order it reaches Neon; the
// record goes to stderr because `ensure_backup` discards what `neonctl` prints.
const neonCalls = (stubs: string): string[] => sourcedResetScript(`
NEON_API_KEY=stub
load_target() { :; }
record_pre_state() { :; }
refuse_business_rows() { :; }
npx() { echo "CALL neonctl $*" >&2; }
staging_psql() { echo "CALL psql $*" >&2; }
${stubs}
main`).stderr.split("\n").filter((line) => line.startsWith("CALL "));

// #1949: the reset is two transactions, one per role — the marker schema's drop as its owner
// `migrator`, then the rebuild of `public` as `neondb_owner` — so the call log pins both halves.
void test("the backup branch is taken before the reset that clears the marker schema", () => {
  const calls = neonCalls(`stranded_on_atlas() { DROP_MARKER_SCHEMA=true; }\nbackup_exists() { return 1; }`);
  assert.equal(calls.length, 3);
  assert.match(calls[0] ?? "", /^CALL neonctl --yes neonctl@3\.6\.0 branches create /);
  assert.match(calls[1] ?? "", /^CALL psql migrator -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=true -v public_reset=false -f \S+\/reset-staging-baseline\.sql$/);
  assert.match(calls[2] ?? "", /^CALL psql neondb_owner -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=false -v public_reset=true -f \S+\/reset-staging-baseline\.sql$/);
});

void test("without an approved marker the reset leaves the marker schema alone", () => {
  const calls = neonCalls(`stranded_on_atlas() { :; }\nbackup_exists() { return 1; }`);
  assert.equal(calls.length, 2);
  assert.match(calls[1] ?? "", /^CALL psql neondb_owner -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=false -v public_reset=true -f \S+\/reset-staging-baseline\.sql$/);
});

// A retried run reuses the backup branch; one older than the marker schema's last write, in any of
// its three tables, could not give that write back.
const reusedBackup = (createdAt: string, holdsMarker: boolean): Outcome => sourcedResetScript(`
DROP_MARKER_SCHEMA=true
backup_exists() { BACKUP_CREATED_AT="${createdAt}"; }
query() { echo "READ $1"; ROWS="${holdsMarker ? "t" : "f"}"; }
ensure_backup
echo REUSED`);

void test("a reused backup taken after the marker is kept", () => {
  const outcome = reusedBackup("2026-09-18T09:00:00Z", true);
  assert.match(outcome.stdout, /^READ SELECT '2026-09-18T09:00:00Z'::timestamptz >= greatest\(\(SELECT max\(updated_at\) FROM prisma_contract\.marker\),\n {2}\(SELECT max\(created_at\) FROM prisma_contract\.ledger\), \(SELECT max\(created_at\) FROM prisma_contract\.contract\)\)\nREUSED\n$/);
});

void test("a reused backup taken before the marker schema's last write refuses", () => {
  const outcome = reusedBackup("2026-09-10T00:00:00Z", false);
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stderr, "refusing reset: staging-before-prisma-baseline was taken at 2026-09-10T00:00:00Z, before the prisma_contract writes it would have to restore\n");
});

void test("a backup whose creation time is not a timestamp refuses without reading it into SQL", () => {
  const outcome = reusedBackup("x'; DROP SCHEMA public; --", true);
  assert.equal(outcome.status, 1);
  assert.doesNotMatch(outcome.stdout, /READ/);
  assert.match(outcome.stderr, /^refusing reset: cannot read when staging-before-prisma-baseline was taken/);
});
