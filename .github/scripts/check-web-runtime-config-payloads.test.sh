#!/usr/bin/env bash
# Behavioral self-test for check-web-runtime-config-payloads.sh (#1013 P0).
# It must accept the committed payloads (Case 1) and reject a missing-comma
# mutation (Case 2) so the regression cannot silently return. Runs the real
# check against throwaway fixture git repos; never mutates this repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-web-runtime-config-payloads.sh"

fail_test() { echo "FAIL: $1" >&2; exit 1; }

# ── Case 1: committed payloads validate (locks today's reality) ─────────────
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
output="$(cd "${REPO_ROOT}" && bash "${CHECK_SH}")" && rc=0 || rc=$?
[ "${rc}" -eq 0 ] || fail_test "committed payloads must pass, exit ${rc}: ${output}"
grep -q "all RUNTIME_CONFIG payloads are valid" <<< "${output}" \
  || fail_test "expected the valid summary line: ${output}"
echo "PASS: committed payloads validate"

# ── Case 2: a missing-comma payload must fail the gate ──────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
mkdir -p "${TMP}/.github/actions/cross-stack-e2e"
mkdir -p "${TMP}/.github/scripts"
cp "${REPO_ROOT}/.github/actions/cross-stack-e2e/action.yml" "${TMP}/.github/actions/cross-stack-e2e/"
cp "${REPO_ROOT}/.github/scripts/pr-verification-gate.sh" "${TMP}/.github/scripts/"
# Inject the exact P0 mutation: drop the comma before "featureFlags".
TARGET_FILE="${TMP}/.github/actions/cross-stack-e2e/action.yml"
python3 -c "import pathlib; p=pathlib.Path('${TARGET_FILE}'); s=p.read_text(); s=s.replace('\"false\",\"featureFlags\"','\"false\"\"featureFlags\"',1); p.write_text(s)"
git -C "${TMP}" init -q
git -C "${TMP}" add .
git -C "${TMP}" -c user.name=test -c user.email=test@example.com commit -q -m init
rc=0
out="$(cd "${TMP}" && bash "${CHECK_SH}" 2>&1)" || rc=$?
[ "${rc}" -ne 0 ] || fail_test "broken payload must fail the gate, got exit 0: ${out}"
printf '%s' "${out}" | grep -qE 'not valid JSON|invalid RUNTIME_CONFIG' \
  || fail_test "expected the gate to name the broken payload: ${out}"
echo "PASS: missing-comma payload fails the gate"

# ── Case 3: deleting a required payload must fail closed ────────────────
cp "${REPO_ROOT}/.github/actions/cross-stack-e2e/action.yml" "${TARGET_FILE}"
python3 -c "import pathlib,re; p=pathlib.Path('${TARGET_FILE}'); s=p.read_text(); p.write_text(re.sub(r\"^\\s*RUNTIME_CONFIG='[^']*'\\n\", '', s, count=1, flags=re.M))"
rc=0
out="$(cd "${TMP}" && bash "${CHECK_SH}" 2>&1)" || rc=$?
[ "${rc}" -ne 0 ] || fail_test "missing payload must fail the gate, got exit 0: ${out}"
printf '%s' "${out}" | grep -q 'no RUNTIME_CONFIG payload found' \
  || fail_test "expected the gate to name the missing payload: ${out}"
echo "PASS: missing payload fails the gate"

rm -rf "${TMP}"

echo "All check-web-runtime-config-payloads.sh behavioral tests passed."
