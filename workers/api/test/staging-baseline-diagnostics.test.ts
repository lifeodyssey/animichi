// SUT: infra/database-access/reset-staging-baseline.sh — the diagnostic file `query` opens for
// staging_psql's stderr (#1793; the #1796 review). The file is what lets a read relay neonctl's
// connection notice byte for byte, and quote it into the refusal when the read cannot be
// confirmed; it must not outlive the read on any path, because CD runs the script on every
// staging deploy and a state that refuses every run would collect one file per deploy.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { type Outcome, sourcedResetScript } from "./reset-staging-baseline-script.ts";

interface DiagnosticCase {
  outcome: Outcome;
  opened: readonly string[];
  left: readonly string[];
}

// The file the shipped `query` opens is named by `mktemp`, which macOS resolves outside TMPDIR,
// so the case names it instead: a `mktemp` standing where `query` calls it, making the file in a
// directory the case can read afterwards and recording every name it handed out. Nothing else
// about the call changes, so a file that survives the read is a file the shipped code left.
const diagnosticCase = (body: string): DiagnosticCase => {
  const parent = mkdtempSync(join(tmpdir(), "baseline-diagnostic-"));
  const diagnostics = join(parent, "diagnostics");
  const names = join(parent, "opened");
  mkdirSync(diagnostics);
  const outcome = sourcedResetScript(`mktemp() {
  local file
  file="$(command mktemp "${diagnostics}/diagnostic.XXXXXX")"
  printf '%s\\n' "$file" >> "${names}"
  printf '%s\\n' "$file"
}
${body}`);
  const opened = readFileSync(names, "utf8").split("\n").filter((line) => line !== "");
  const left = readdirSync(diagnostics);
  rmSync(parent, { recursive: true, force: true });
  return { outcome, opened, left };
};

// The bytes as a `printf` format string: the escapes are the shell's, and the assertion compares
// against the payload itself.
const asPrintf = (text: string): string => text.replaceAll("\n", "\\n");

// What the success path relays, exactly: neonctl's connection notice, a psql NOTICE beside it,
// and an empty line — two trailing newlines a command substitution would have eaten.
const DIAGNOSTIC = 'INFO: Connecting to the database using psql...\nNOTICE:  relation "bangumi" does not exist, skipping\n\n';

void test("a successful read relays its diagnostics byte for byte", () => {
  const { outcome, opened, left } = diagnosticCase(`
staging_psql() { printf '${asPrintf(DIAGNOSTIC)}' >&2; echo t; }
query "SELECT 1"
printf 'ROWS=[%s]\\n' "$ROWS"`);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stderr, DIAGNOSTIC);
  assert.equal(outcome.stdout, "ROWS=[t]\n");
  assert.equal(opened.length, 1);
  assert.deepEqual(left, []);
});

void test("a read with no diagnostics relays nothing at all", () => {
  const { outcome, opened, left } = diagnosticCase(`
staging_psql() { echo t; }
query "SELECT 1"`);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stderr, "");
  assert.equal(opened.length, 1);
  assert.deepEqual(left, []);
});

// The reachable refusal: psql exits 2 on a dead connection (neonctl propagates it), `fail` ends
// the script at line "cannot confirm staging state", and the read's file has to be gone before
// that exit — the refusal quotes it, so it is read first.
void test("a read that cannot be confirmed removes its diagnostic file before refusing", () => {
  const { outcome, opened, left } = diagnosticCase(`
staging_psql() { printf 'connection to server failed\\n' >&2; return 2; }
query "SELECT 1"`);
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stderr, "cannot confirm staging state: connection to server failed\n");
  assert.equal(opened.length, 1);
  assert.deepEqual(left, []);
});

// The other ending: the relay itself cannot write to stderr — a runner whose log stream is gone,
// fd 2 closed — and `cat`'s failure is a status `set -e` acts on, so the removal must sit before
// it rather than after. `REACHED` is the proof the read never returned.
void test("a relay that cannot reach stderr removes its diagnostic file before failing", () => {
  const { outcome, opened, left } = diagnosticCase(`
staging_psql() { printf 'INFO: Connecting to the database using psql...\\n' >&2; echo t; }
exec 2>&-
query "SELECT 1"
echo REACHED_AFTER_THE_RELAY`);
  assert.equal(outcome.status, 1);
  assert.equal(outcome.stdout, "");
  assert.equal(opened.length, 1);
  assert.deepEqual(left, []);
});
