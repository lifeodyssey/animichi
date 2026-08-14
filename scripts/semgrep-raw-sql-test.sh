#!/usr/bin/env bash
# Fail-closed self-test for the repository-owned raw-SQL Semgrep ruleset (#999).
#
# Proves the ORM-only boundary gate:
#   (a) the ruleset FLAGS every representative forbidden example (Python inline
#       SQL execute / sqlalchemy text() / direct asyncpg-psycopg; TypeScript
#       complete sql`` DML, sql.raw(), direct neon() client) — the scan must
#       FAIL (--error) on the forbidden fixtures.
#   (b) the ruleset PASSES the sanctioned exceptions (db/client.ts,
#       db/expressions.ts, persistence/expressions.py, persistence/database.py) —
#       the scan must return ZERO findings.
#
# Why a temp-mirror scan: the rules carry `paths.include` scoped to
# /workers/... and /apps/agent, and .semgrepignore ignores the .semgrep config
# dir, so each fixture set is scanned from a throwaway tree that mirrors those
# include paths. Run from the repo root.
#
# Usage:   scripts/semgrep-raw-sql-test.sh
# Env:     SEMGREP_BIN  semgrep executable to use (default: `semgrep`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEMGREP_BIN="${SEMGREP_BIN:-semgrep}"
RULES="${REPO_ROOT}/.semgrep"

if ! command -v "${SEMGREP_BIN}" >/dev/null 2>&1; then
  echo "ERROR: semgrep not found (SEMGREP_BIN=${SEMGREP_BIN})." >&2
  exit 1
fi

forbidden() {
  # Forbidden examples must FAIL the gate (each rule must fire).
  local root forbidden_dir t
  root="$(mktemp -d)"
  forbidden_dir="${REPO_ROOT}/.semgrep/tests/fixtures/forbidden"
  t="${root}/workers/catalog/src"
  mkdir -p "${t}" "${root}/workers/users/src" "${root}/apps/agent"
  cp "${forbidden_dir}"/*.ts "${t}/"
  cp "${forbidden_dir}"/*.py "${root}/apps/agent/"
  if (cd "${root}" && "${SEMGREP_BIN}" --config "${RULES}" --error . >/dev/null 2>&1); then
    echo "FAIL: ruleset did not reject the forbidden raw-SQL fixtures (expected --error to fail)." >&2
    rm -rf "${root}"
    return 1
  fi
  rm -rf "${root}"
  echo "ok: forbidden raw-SQL examples rejected by the ruleset."
}

approved() {
  # Sanctioned exceptions must PASS (zero findings on the real seam files).
  local root
  root="$(mktemp -d)"
  mkdir -p "${root}/workers/catalog/src/db" "${root}/workers/users/src/db" \
    "${root}/apps/agent/src/animichi/infrastructure/persistence"
  cp "${REPO_ROOT}/workers/catalog/src/db/client.ts" "${root}/workers/catalog/src/db/"
  cp "${REPO_ROOT}/workers/catalog/src/db/expressions.ts" "${root}/workers/catalog/src/db/"
  cp "${REPO_ROOT}/workers/users/src/db/client.ts" "${root}/workers/users/src/db/"
  cp "${REPO_ROOT}/apps/agent/src/animichi/infrastructure/persistence/expressions.py" \
    "${root}/apps/agent/src/animichi/infrastructure/persistence/"
  cp "${REPO_ROOT}/apps/agent/src/animichi/infrastructure/persistence/database.py" \
    "${root}/apps/agent/src/animichi/infrastructure/persistence/"
  if ! (cd "${root}" && "${SEMGREP_BIN}" --config "${RULES}" --error . >/dev/null 2>&1); then
    echo "FAIL: ruleset flagged a sanctioned exception (expected zero findings)." >&2
    rm -rf "${root}"
    return 1
  fi
  rm -rf "${root}"
  echo "ok: sanctioned exceptions (seam files) pass the ruleset."
}

baseline() {
  # The live runtime trees must already be clean — no pre-existing violations.
  # Scan the whole repo ROOT as a dot target from REPO_ROOT, mirroring the CI
  # scan. The anchored paths.include (/apps/agent, /workers/catalog/src, ...)
  # resolve against the git/scan root, so a '.' target guarantees every rule
  # fires and .semgrepignore still applies (test/ and tests/ are excluded).
  # Scanning the three include dirs explicitly would scope the check only to
  # those subtrees and miss any violation elsewhere in the repo.
  if ! (cd "${REPO_ROOT}" && "${SEMGREP_BIN}" --config "${RULES}" --error . >/dev/null 2>&1); then
    echo "FAIL: existing runtime source already violates the raw-SQL policy." >&2
    return 1
  fi
  echo "ok: current runtime source is clean under the ruleset."
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
