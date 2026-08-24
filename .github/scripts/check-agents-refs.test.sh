#!/usr/bin/env bash
# Behavioral tests for check-agents-refs.sh, driven against throwaway fixture
# git repos in mktemp -d (the script resolves its root via
# `git rev-parse --show-toplevel`, so each case cd's into its own repo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-agents-refs.sh"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

# Commits whatever the caller has staged in the fixture repo ($1).
commit_fixture() {
  git -C "$1" init -q
  git -C "$1" add .
  git -C "$1" -c user.name=test -c user.email=test@example.com commit -q -m init
}

# Runs the real script from inside the fixture repo ($1), writing combined
# output to $2, and prints the exit code for the caller to capture.
run_check() {
  local repo="$1" out="$2" rc=0
  (cd "${repo}" && bash "${CHECK_SH}") >"${out}" 2>&1 || rc=$?
  echo "${rc}"
}

# ── Case 10: '..'-escape that resolves OUTSIDE the repo (parent dir) must not
#    count as resolved — the canonicalized path must stay under the repo root ──
test_parent_escape_not_resolved() {
  local repo out=/tmp/agents-ref-case10.out rc esc
  repo="$(mktemp -d)"
  esc="agents-ref-escape-$$.md"
  printf 'escape doc\n' > "${repo}/../${esc}"
  printf 'AGENTS.md\n`../%s`\n' "${esc}" > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"
  rm -rf "${repo}" "${repo}/../${esc}"
  [ "${rc}" -ne 0 ] || fail_test "parent-directory escape must not resolve, got exit 0"
  grep -q "AGENTS.md:2: broken reference \`../${esc}\`" "${out}" || fail_test "escape reference must be reported as broken: $(cat "${out}")"
  echo "PASS: parent-directory escape reference is not resolved"
}

# ── Case 1: root-relative reference to an existing file -> passes ──────────
test_root_relative_existing_passes() {
  local repo out=/tmp/agents-ref-case1.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs"; printf 'root doc\n' > "${repo}/docs/root.md"
  printf 'AGENTS.md\n`docs/root.md`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "existing root-relative reference should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all resolve" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: root-relative existing reference passes"
}

# ── Case 2: reference to a missing path -> fails, naming file + candidate ───
test_missing_reference_fails() {
  local repo out=/tmp/agents-ref-case2.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs"; printf 'root doc\n' > "${repo}/docs/root.md"
  printf 'AGENTS.md\n`docs/missing.md`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "missing reference should fail the gate, got exit 0"
  grep -q 'AGENTS.md:2: broken reference `docs/missing.md`' "${out}" || fail_test "output must name the file and candidate: $(cat "${out}")"
  echo "PASS: missing reference fails and names file + candidate"
}

# ── Case 3: URL, glob, <placeholder>, and bare command in backticks are all
#    ignored (no false positives, like agnix's 63%) ─────────────────────────
test_ignored_candidates_skipped() {
  local repo out=/tmp/agents-ref-case3.out rc
  repo="$(mktemp -d)"
  printf 'AGENTS.md\n`https://example.com/x` `*.yml` `<placeholder>` `git status` `git`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "URL/glob/placeholder/command references must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "0 references" "${out}" || fail_test "every candidate should have been ignored: $(cat "${out}")"
  echo "PASS: URL, glob, placeholder, and bare command references are ignored"
}

# ── Case 4: reference resolvable only relative to the file's own directory
#    (sibling file) -> passes ────────────────────────────────────────────────
test_file_relative_sibling_passes() {
  local repo out=/tmp/agents-ref-case4.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/nested"; printf 'sibling doc\n' > "${repo}/nested/sibling.md"
  printf 'AGENTS.md\n`sibling.md`\n' > "${repo}/nested/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "sibling reference should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all resolve" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: file-relative sibling reference passes"
}

# ── Case 5: '@'-prefixed scoped npm package -> ignored ──────────────────────
test_scoped_npm_package_skipped() {
  local repo out=/tmp/agents-ref-case5.out rc
  repo="$(mktemp -d)"
  printf 'AGENTS.md\n`@animichi/contract`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "scoped npm package must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "0 references" "${out}" || fail_test "scoped npm package should not be reported: $(cat "${out}")"
  echo "PASS: '@'-prefixed scoped npm package is ignored"
}

# ── Case 6: '/'-prefixed URL path -> ignored ────────────────────────────────
test_absolute_url_path_skipped() {
  local repo out=/tmp/agents-ref-case6.out rc
  repo="$(mktemp -d)"
  printf 'AGENTS.md\n`/.well-known/jwks.json`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "absolute URL path must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "0 references" "${out}" || fail_test "absolute URL path should not be reported: $(cat "${out}")"
  echo "PASS: '/'-prefixed URL path is ignored"
}

# ── Case 7: bare filename without a '/' -> ignored (too ambiguous) ──────────
test_bare_filename_skipped() {
  local repo out=/tmp/agents-ref-case7.out rc
  repo="$(mktemp -d)"
  printf 'AGENTS.md\n`ci.yml`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "bare filename must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "0 references" "${out}" || fail_test "bare filename should not be reported: $(cat "${out}")"
  echo "PASS: bare filename without '/' is ignored"
}

# ── Case 8: extensionless last segment that is not a directory -> ignored ───
test_extensionless_nondirectory_skipped() {
  local repo out=/tmp/agents-ref-case8.out rc
  repo="$(mktemp -d)"
  printf 'AGENTS.md\n`drizzle-orm/pg-core` `rollback-backups/`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "extensionless non-directory must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "0 references" "${out}" || fail_test "extensionless non-directory should not be reported: $(cat "${out}")"
  echo "PASS: extensionless non-directory reference is ignored"
}

# ── Case 9: gitignored candidate (nested .gitignore) -> skipped under both
#    resolution bases (root base for apps/web/.output/x.md, dir base for
#    .output/ with trailing slash) ───────────────────────────────────────────
test_gitignored_candidate_skipped() {
  local repo out=/tmp/agents-ref-case9.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/apps/web"
  printf 'docs\n' > "${repo}/apps/web/docs.md"
  printf '.output\n' > "${repo}/apps/web/.gitignore"
  printf 'AGENTS.md\n`apps/web/docs.md` `.output/` `apps/web/.output/x.md`\n' > "${repo}/apps/web/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "gitignored candidate must be skipped, got exit ${rc}: $(cat "${out}")"
  grep -q "all resolve" "${out}" || fail_test "gitignored candidate should not break resolution: $(cat "${out}")"
  echo "PASS: gitignored candidate is skipped under both resolution bases"
}

test_deleted_context_doc_skipped() {
  local repo out=/tmp/agents-ref-deleted.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/retired"
  printf 'AGENTS.md\n`missing/path.md`\n' > "${repo}/retired/AGENTS.md"
  commit_fixture "${repo}"
  rm "${repo}/retired/AGENTS.md"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "deleted context docs must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "0 files, 0 references" "${out}" || fail_test "deleted context doc must not be counted: $(cat "${out}")"
  echo "PASS: deleted tracked context doc is ignored"
}

test_root_relative_existing_passes
test_missing_reference_fails
test_ignored_candidates_skipped
test_file_relative_sibling_passes
test_scoped_npm_package_skipped
test_absolute_url_path_skipped
test_bare_filename_skipped
test_extensionless_nondirectory_skipped
test_gitignored_candidate_skipped
test_deleted_context_doc_skipped
test_parent_escape_not_resolved

echo "All check-agents-refs.sh behavioral tests passed."
