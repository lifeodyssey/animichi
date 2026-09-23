#!/usr/bin/env bash
# SUT: scripts/delivery/migrate-through-worker.sh — redact_dsn_passwords
# Behaviour tests for redact_dsn_passwords in migrate-through-worker.sh (#1872, #1881).
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
# `-E` itself is POSIX. A second layer, and the one #1881's class touched: the `s` delimiter
# `#` stays out of every bracket expression. A sed scans for its delimiter before it compiles
# the ERE, and POSIX gives only the backslash escape for a literal one — nothing there says a
# bracket hides it, so `[^...#...]` is a shape two seds may cut in two different places.
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

# The four shapes #1872 names, the two rules the function already had, the pair #1881 adds
# per class it changed, and the escaped surface #1887 adds to rule 2: every rule is exercised
# here. Removing a rule turns its cases red and only those — rule 1 the three `scheme_userinfo`
# cases; rule 2 the four quoted/JSON/colon cases, the two escaped-quote cases, plus
# `case_redacts_a_uri_password_parameter`; rule 3 the other three `redacts` cases. A #1881
# pair runs one case per direction, so widening a class is as red as dropping it: the at-sign
# case against the endpoint case, the one-slash case against rule 1's own output.
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

# #1887. A quoted assignment carried inside a JSON string — the encoder's escaped form, and
# the shape a driver echoing a config line takes inside a response body. The bare branch ends
# at the raw quote and the secret survives; the escaped branch is bounded where the JSON
# string's own escapes end, so the closing quote and brace stay.
case_redacts_an_escaped_quoted_password_in_a_json_string() {
  assert_redacts '{"cause":"password=\"xxxxxxxx\""}' '{"cause":"password=***"}'
}

# The same surface in the direction it is paid: the branch is quote-terminated, not
# whitespace-terminated, so a multi-word secret behind escaped quotes is not left halved —
# leak above lost diagnostic is this pass's own ranking.
case_redacts_an_escaped_quoted_password_with_spaces_inside() {
  assert_redacts 'password=\"xx xx\"' 'password=***'
}

case_redacts_a_scheme_userinfo_password() {
  assert_redacts 'postgresql://migrator:xxxxxxxx@ep-x.neon.tech/db' \
                 'postgresql://migrator:***@ep-x.neon.tech/db'
}

# Gap 1 (#1881). Rule 1's class refuses `/` and `?` rather than the at-sign, so the match ends
# at the last at-sign the authority holds — `new URL`'s own split. A class that refuses the
# at-sign stops at the first one and publishes everything after it.
case_redacts_a_scheme_userinfo_secret_with_an_at_sign() {
  assert_redacts 'postgresql://migrator:abcd@efgh@ep-x.neon.tech/db' \
                 'postgresql://migrator:***@ep-x.neon.tech/db'
}

# What that class costs, in the direction it is paid: an at-sign PAST the authority must not
# drag the match with it. Widened to `[^[:space:]]+` the match runs on to `a@b.c`, and the
# endpoint — the diagnostic #1868 restored — leaves the log with it.
case_keeps_a_scheme_userinfo_endpoint_past_a_later_at_sign() {
  assert_redacts 'postgresql://migrator:xxxxxxxx@ep-x.neon.tech/db?opt=a@b.c' \
                 'postgresql://migrator:***@ep-x.neon.tech/db?opt=a@b.c'
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

# Gap 3 (#1881). One slash may open a schemeless secret; two are the `://` of rule 1's output.
case_redacts_a_schemeless_secret_opening_with_a_slash() {
  assert_redacts 'migrator:/xxxxxxxx@ep-x.neon.tech/db' 'migrator:***@ep-x.neon.tech/db'
}

# That distinction, in the direction it is paid: rule 1 runs first and rule 3 must leave its
# output alone. Let the secret open with any character and `postgresql` reads as the user and
# `//migrator:***` as the secret, so a line already safe is rewritten into a different one.
case_keeps_an_already_redacted_userinfo_untouched() {
  assert_redacts 'postgresql://migrator:***@ep-x.neon.tech/db' \
                 'postgresql://migrator:***@ep-x.neon.tech/db'
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
  case_redacts_an_escaped_quoted_password_in_a_json_string \
  case_redacts_an_escaped_quoted_password_with_spaces_inside \
  case_redacts_a_scheme_userinfo_password \
  case_redacts_a_scheme_userinfo_secret_with_an_at_sign \
  case_keeps_a_scheme_userinfo_endpoint_past_a_later_at_sign \
  case_redacts_a_uri_password_parameter \
  case_redacts_schemeless_userinfo \
  case_redacts_userinfo_whose_secret_contains_an_at_sign \
  case_redacts_a_schemeless_secret_opening_with_a_slash \
  case_keeps_an_already_redacted_userinfo_untouched \
  case_keeps_an_ordinary_failure_body_byte_identical; do
  "$test_case"
done

echo "PASS: migrate-through-worker-redaction.test.sh"
