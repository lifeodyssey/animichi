#!/usr/bin/env bash
# Fail-closed self-test for the repository-owned raw-SQL Semgrep rule (#999,
# rewritten for the Prisma data plane by #1633).
#
# Proves the plan-only boundary in BOTH directions:
#   (a) the rule FLAGS the escape hatches — the client's whole-query raw lane
#       and a hand-built `RawExpr` — so the scan must FAIL on the forbidden
#       fixtures;
#   (b) the rule PASSES the sanctioned shapes — the `fns.raw` / `match.raw`
#       fragment form the query layer is made of, and the seam directory's own
#       plan repairs — so the scan must return ZERO findings on them.
#   (c) the live runtime trees are already clean.
#
# (b) is the half that matters most: a rule that rejected `fns.raw` would reject
# most of the query layer, which is why the approved set holds a real builder
# plan and not only the exempted seam.
#
# Why a temp-mirror scan: the rule carries `paths.include` scoped to
# /workers/... and /packages/..., and .semgrepignore ignores the .semgrep config
# dir, so each fixture set is scanned from a throwaway tree that mirrors those
# include paths. Run from the repo root.
#
# Usage:   scripts/semgrep-raw-sql-test.sh
# Env:     SEMGREP_BIN  semgrep executable to use (default: `semgrep`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEMGREP_BIN="${SEMGREP_BIN:-semgrep}"
RULES="${REPO_ROOT}/.semgrep"
# The rule this gate is about. `forbidden()` asserts THIS id fired, so a deleted
# ruleset cannot pass the gate by making semgrep exit non-zero for its own
# reasons.
RULE_ID="ts-no-prisma-raw-escape"

if ! command -v "${SEMGREP_BIN}" >/dev/null 2>&1; then
  echo "ERROR: semgrep not found (SEMGREP_BIN=${SEMGREP_BIN})." >&2
  exit 1
fi

# Every `cp` below is checked explicitly rather than left to `set -e`: these
# functions are invoked from a `||` list, which suppresses errexit for their
# whole body. A silently-skipped copy is how this script came to report
# "sanctioned exceptions pass" while scanning a tree that was missing one of
# the files it claimed to have proved (the users seam, deleted by #1632).
copy_into() {
  local destination="$1"
  shift
  local source
  for source in "$@"; do
    if ! cp "${source}" "${destination}/"; then
      echo "FAIL: ${source} is missing — the gate cannot prove what it does not scan." >&2
      return 1
    fi
  done
}

# One forbidden fixture, scanned ALONE. Returns success when RULE_ID fired on it.
scan_forbidden_case() {
  local fixture="$1" root target findings
  root="$(mktemp -d)"
  target="${root}/workers/catalog/src"
  mkdir -p "${target}"
  copy_into "${target}" "${fixture}" || { rm -rf "${root}"; return 1; }
  findings="$(cd "${root}" && "${SEMGREP_BIN}" --config "${RULES}" --json . 2>/dev/null || true)"
  rm -rf "${root}"
  grep -q "${RULE_ID}" <<<"${findings}"
}

# The rule's forbidden surface is a `pattern-either`; the gate must prove EVERY
# branch of it, so there is a fixture per branch and none may be left unproved.
rule_branch_count() {
  grep -cE '^[[:space:]]+- pattern: ' "${RULES}/${RULE_ID}.yaml"
}

forbidden() {
  # Forbidden examples must FAIL the gate, and must fail BY NAME, one at a time.
  #
  # A non-zero exit is not enough on its own: `semgrep --error` also exits
  # non-zero when it loaded no rules at all, so a gate that only read the exit
  # code would report "rejected" for a ruleset that had been deleted. What is
  # asserted instead is that RULE_ID itself produced a finding, which nothing
  # but the rule can do.
  #
  # And it is asserted PER FIXTURE. Scanning the forbidden set together and
  # asking only whether RULE_ID appeared somewhere let one branch's finding
  # stand in for the other's: deleting `$DB.raw.sql`...`` from the rule left
  # this gate green while that escape hatch was wide open.
  local fixture scanned=0 branches missing=0
  for fixture in "${REPO_ROOT}/.semgrep/tests/fixtures/forbidden"/*.ts; do
    [[ -f "${fixture}" ]] || continue
    scanned=$((scanned + 1))
    if scan_forbidden_case "${fixture}"; then
      echo "ok: $(basename "${fixture}") rejected by ${RULE_ID}."
    else
      echo "FAIL: ${RULE_ID} did not fire on $(basename "${fixture}") — that escape hatch is unproved." >&2
      missing=1
    fi
  done
  # Without this, an emptied fixture directory would skip the loop entirely and
  # report success having proved nothing — the same silent pass in a new place.
  branches="$(rule_branch_count)"
  if [[ "${scanned}" -lt "${branches}" ]]; then
    echo "FAIL: ${scanned} forbidden fixture(s) for ${branches} rule branch(es) — each branch needs its own." >&2
    missing=1
  fi
  return "${missing}"
}

approved() {
  # Sanctioned shapes must PASS: the builder-plan fixture (the `fns.raw` /
  # `match.raw` fragment form) and the real seam directories' own modules.
  local root
  root="$(mktemp -d)"
  mkdir -p "${root}/workers/catalog/src" "${root}/workers/catalog/src/db" "${root}/workers/users/src/db"
  copy_into "${root}/workers/catalog/src" "${REPO_ROOT}/.semgrep/tests/fixtures/approved"/*.ts \
    || { rm -rf "${root}"; return 1; }
  copy_into "${root}/workers/catalog/src/db" \
    "${REPO_ROOT}/workers/catalog/src/db/prisma.ts" "${REPO_ROOT}/workers/catalog/src/db/plans.ts" \
    || { rm -rf "${root}"; return 1; }
  copy_into "${root}/workers/users/src/db" "${REPO_ROOT}/workers/users/src/db/prisma.ts" \
    || { rm -rf "${root}"; return 1; }
  if ! (cd "${root}" && "${SEMGREP_BIN}" --config "${RULES}" --error . >/dev/null 2>&1); then
    echo "FAIL: the rule flagged a sanctioned shape (expected zero findings)." >&2
    rm -rf "${root}"
    return 1
  fi
  rm -rf "${root}"
  echo "ok: the builder-plan fragment form and the seam directories pass the rule."
}

baseline() {
  # The live runtime trees must already be clean — no pre-existing violations.
  # Scan the whole repo ROOT as a dot target from REPO_ROOT, mirroring the CI
  # scan. The anchored paths.include (/workers/catalog/src, ...) resolve against
  # the git/scan root, so a '.' target guarantees the rule fires and
  # .semgrepignore still applies (test/ and tests/ are excluded). Scanning the
  # include dirs explicitly would scope the check to those subtrees and miss any
  # violation elsewhere in the repo.
  if ! (cd "${REPO_ROOT}" && "${SEMGREP_BIN}" --config "${RULES}" --error . >/dev/null 2>&1); then
    echo "FAIL: existing runtime source already violates the raw-SQL policy." >&2
    return 1
  fi
  echo "ok: current runtime source is clean under the rule."
}

fail=0
forbidden || fail=1
approved || fail=1
baseline || fail=1

if [[ "${fail}" -eq 0 ]]; then
  echo "Pass: raw-SQL policy gate self-test succeeded."
else
  echo "Fail: raw-SQL policy gate self-test reported errors above." >&2
fi
exit "${fail}"
