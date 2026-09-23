#!/usr/bin/env bash
# SUT: scripts/delivery/migrate-through-worker.sh — redact_dsn_passwords
# Behaviour tests for redact_dsn_passwords in migrate-through-worker.sh (card #1872).
#
# The orchestration cases live in migrate-through-worker.test.sh and drive the whole script
# against a `curl` stub; these cases call one pure text transform, so they belong in their
# own file, one responsibility per file, and both suites stay under the 200-line test cap.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/migrate-through-worker.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- redact_dsn_passwords (#1872) ---------------------------------------------
#
# report_failure prints the first 4000 characters of the migrator's response body to the CD
# run log, so this function stands between a DSN in that body and a public repository's log.
# Every credential below is the zero-entropy placeholder `xxxxxxxx`: a realistic value is
# refused by the repository's secret scanner, and it would also let a survivor hide.
#
# Each case compares the WHOLE line, both directions — a rule that fires on ordinary words
# fails the same case that fails when the rule goes missing — with `cmp`, not `[ = ]`, so a
# stray byte counts. The driver is the shipped definition lifted verbatim, so these exercise
# the function the script runs rather than a copy of it.
#
# BSD and GNU sed (AC 4): this suite runs under the BSD sed macOS ships and no GNU sed is
# installed here, nor may this suite pull one. The program was checked statically instead:
# POSIX ERE operators, `[[:class:]]`, a `g` flag, and `\1` in the REPLACEMENT only (POSIX
# ERE defines no backreference inside a pattern) — no `\b`, `\w`, `\s`, `\t`, no lookbehind,
# no `\+`/`\?` BRE escape, no `I`/`M` s-command flag, no GNU-only address or command.
# `-E` itself is POSIX.
make_redact_driver() {
  { sed -n '/^redact_dsn_passwords()/,/^}/p' "$SCRIPT"; printf 'redact_dsn_passwords "$1"\n'; } > "$1/redact"
}

# One line in, its whole redacted line out. Scratch directory and driver are made per
# assertion, so a case needs neither setup nor teardown and no two cases share a file.
assert_redacts() {
  local work
  work="$(mktemp -d)"
  make_redact_driver "$work"
  printf '%s\n' "$1" > "$work/body"
  printf '%s\n' "$2" > "$work/want"
  bash "$work/redact" "$work/body" > "$work/got"
  cmp "$work/got" "$work/want" || fail "[$1] gave [$(cat "$work/got")]"
  rm -rf "$work"
}

# The four shapes the card names, then the two rules the function already had: every rule is
# exercised here for the first time. Removing a rule turns its cases red and only those —
# rule 1 `case_redacts_a_scheme_userinfo_password`; rule 2 the four quoted/JSON/colon cases
# plus `case_redacts_a_uri_password_parameter`; rule 3 `case_redacts_schemeless_userinfo` and
# `case_redacts_userinfo_whose_secret_contains_an_at_sign`.
case_redacts_a_single_quoted_password() {
  assert_redacts "password='xxxxxxxx'" 'password=***'
}

case_redacts_a_double_quoted_password() {
  assert_redacts 'password="xxxxxxxx"' 'password=***'
}

case_redacts_a_json_password() {
  assert_redacts '{"password":"xxxxxxxx"}' '{"password":***}'
}

case_redacts_a_colon_separated_password() {
  assert_redacts 'password: xxxxxxxx' 'password: ***'
}

case_redacts_a_scheme_userinfo_password() {
  assert_redacts 'postgresql://migrator:xxxxxxxx@ep-x.neon.tech/db' \
                 'postgresql://migrator:***@ep-x.neon.tech/db'
}

case_redacts_a_uri_password_parameter() {
  assert_redacts 'postgresql://ep-x.neon.tech/db?password=xxxxxxxx' \
                 'postgresql://ep-x.neon.tech/db?password=***'
}

case_redacts_schemeless_userinfo() {
  assert_redacts 'migrator:xxxxxxxx@ep-x.neon.tech/db' 'migrator:***@ep-x.neon.tech/db'
}

# The secret class admits the at-sign the rule is hunting, so the match lands on the LAST
# one — the split `new URL` performs. Narrowed to a class without the at-sign the rule does
# not tighten, it stops firing, and role, secret and endpoint all reach the log intact.
case_redacts_userinfo_whose_secret_contains_an_at_sign() {
  assert_redacts 'migrator:xxxxxxxx@yyyyyyyy@ep-x.neon.tech/db' \
                 'migrator:***@ep-x.neon.tech/db'
}

# The other direction, byte for byte, with a guard line per rule: a passwordless URL, the
# driver's own FATAL message, a keyword pair, and prose carrying a colon and an at-sign. The
# body is passed as both the input and the expectation, so any byte the redactor adds, drops
# or reorders fails here. Over-redaction destroys exactly the diagnostic #1868 restored.
case_keeps_an_ordinary_failure_body_byte_identical() {
  local body='postgresql://ep-x.neon.tech/db
FATAL: password authentication failed for user "migrator"
connect_timeout=30
session 12:30 at ops@example.com failed'
  assert_redacts "$body" "$body"
}

for test_case in \
  case_redacts_a_single_quoted_password \
  case_redacts_a_double_quoted_password \
  case_redacts_a_json_password \
  case_redacts_a_colon_separated_password \
  case_redacts_a_scheme_userinfo_password \
  case_redacts_a_uri_password_parameter \
  case_redacts_schemeless_userinfo \
  case_redacts_userinfo_whose_secret_contains_an_at_sign \
  case_keeps_an_ordinary_failure_body_byte_identical; do
  "$test_case"
done

echo "PASS: redact-dsn-passwords.test.sh"
