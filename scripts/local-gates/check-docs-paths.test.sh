#!/usr/bin/env bash
# SUT: scripts/local-gates/check-docs-paths.sh
# Behavioral tests for check-docs-paths.sh against throwaway fixture git repos
# (the script resolves its root via `git rev-parse --show-toplevel`). Each case
# builds its own repo, runs the real script, and asserts pass/fail + output.
# NOTE: fixture content deliberately contains broken docs/ paths — this file is
# itself exempt from the check (.github/scripts/*.test.sh carve-out).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-docs-paths.sh"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

commit_fixture() {
  git -C "$1" init -q
  git -C "$1" add .
  git -C "$1" -c user.name=test -c user.email=test@example.com commit -q -m init
}

run_check() {
  local repo="$1" out="$2" rc=0
  (cd "${repo}" && bash "${CHECK_SH}") >"${out}" 2>&1 || rc=$?
  echo "${rc}"
}

# ── Case 1: good refs (backticked doc path + code comment) -> passes ────────
test_good_refs_pass() {
  local repo out=/tmp/docs-path-case1.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/ops" "${repo}/src"
  printf 'x\n' > "${repo}/docs/ops/deployment.md"
  printf 'AGENTS.md\nsee `docs/ops/deployment.md`\n' > "${repo}/AGENTS.md"
  printf '# see docs/ops/deployment.md\n' > "${repo}/src/thing.py"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "existing docs/ refs should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all resolve" "${out}" || fail_test "missing one-line summary: $(cat "${out}")"
  echo "PASS: backticked and code-comment docs/ refs pass"
}

# ── Case 2: missing path -> fails, naming file + line + candidate ───────────
test_missing_ref_fails() {
  local repo out=/tmp/docs-path-case2.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs"
  printf 'AGENTS.md\n`docs/missing.md`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "missing docs/ ref must fail the gate, got exit 0"
  grep -q 'AGENTS.md:2: broken docs/ reference `docs/missing.md`' "${out}" || fail_test "must name file+line+candidate: $(cat "${out}")"
  echo "PASS: missing docs/ ref fails and names file, line, candidate"
}

# ── Case 3: external URLs (https and host.tld/docs/...) -> skipped ──────────
test_external_urls_skipped() {
  local repo out=/tmp/docs-path-case3.out rc
  repo="$(mktemp -d)"
  printf 'README.md\nhttps://pulumi.com/docs/install and https://x.com/a?b=c\n' > "${repo}/README.md"
  printf 'docs/notes\nneon.tech/docs/introduction/branch-restore and motion.dev/docs/ai-kit\n' > "${repo}/docs-list.txt"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "external URL docs/ tokens must be skipped, got exit ${rc}: $(cat "${out}")"
  grep -q "0 docs/ references" "${out}" || fail_test "URL candidates should not count: $(cat "${out}")"
  echo "PASS: https and hostname-prefixed docs/ URLs are skipped"
}

# ── Case 4: extensionless non-directory tail (branch name) -> skipped ───────
test_branch_name_skipped() {
  local repo out=/tmp/docs-path-case4.out rc
  repo="$(mktemp -d)"
  printf 'README.md\nbranch docs/frontend-rebuild-plan and docs/s0v2-F1-agents-refresh\n' > "${repo}/README.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "branch-name tokens must be skipped, got exit ${rc}: $(cat "${out}")"
  grep -q "0 docs/ references" "${out}" || fail_test "branch names should not count: $(cat "${out}")"
  echo "PASS: extensionless non-directory tails (branch names) are skipped"
}

# ── Case 5: quoted path containing spaces -> resolves -> passes ─────────────
test_quoted_space_path_passes() {
  local repo out=/tmp/docs-path-case5.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/design"
  printf 'x\n' > "${repo}/docs/design/Landing - Hero.html"
  printf 'AGENTS.md\n`docs/design/Landing - Hero.html`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "quoted path with a space must resolve, got exit ${rc}: $(cat "${out}")"
  grep -q "all resolve" "${out}" || fail_test "space path should pass: $(cat "${out}")"
  echo "PASS: quoted docs/ path with spaces resolves"
}

# ── Case 6: broken refs inside docs/archive/ are exempt (read-only history) ─
test_archive_exempt() {
  local repo out=/tmp/docs-path-case6.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/archive/old" "${repo}/docs/ops"
  printf 'x\n' > "${repo}/docs/ops/deployment.md"
  printf 'was in `docs/archive/old/gone.md` but that file is gone\n' > "${repo}/docs/archive/old/report.md"
  printf 'README.md\nlive ref `docs/ops/deployment.md`\n' > "${repo}/README.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "archive-internal broken ref must be exempt, got exit ${rc}: $(cat "${out}")"
  echo "PASS: broken docs/ refs inside docs/archive/ are exempt"
}

# ── Case 7: trailing punctuation, anchors, line refs, ?raw -> stripped ──────
test_suffix_stripping() {
  local repo out=/tmp/docs-path-case7.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/ops"
  printf 'x\n' > "${repo}/docs/ops/deployment.md"
  printf 'x\n' > "${repo}/docs/ops/secrets.md"
  printf 'AGENTS.md\n`docs/ops/deployment.md.` `docs/ops/deployment.md#L10` `docs/ops/deployment.md:12`\n' > "${repo}/AGENTS.md"
  printf '// see ../../../docs/ops/secrets.md?raw\n' > "${repo}/src.ts"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "punctuation/anchor/line/?raw suffixes must strip, got exit ${rc}: $(cat "${out}")"
  grep -q "all resolve" "${out}" || fail_test "suffix-stripped refs should pass: $(cat "${out}")"
  echo "PASS: trailing punctuation, #anchor, :line, ?raw, and ../ prefixes resolve"
}

# ── Case 8: glob patterns -> skipped (unprovable by design) ─────────────────
test_glob_skipped() {
  local repo out=/tmp/docs-path-case8.out rc
  repo="$(mktemp -d)"
  printf 'README.md\n`docs/*.md` `docs/archive/frontend-*.md`\n' > "${repo}/README.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "glob candidates must be skipped, got exit ${rc}: $(cat "${out}")"
  echo "PASS: glob candidates are skipped"
}

# ── Case 9: '..'-escape resolving outside the repo -> fails ─────────────────
test_parent_escape_fails() {
  local repo out=/tmp/docs-path-case9.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs"
  esc="docs-escape-$$.md"
  printf 'escape\n' > "${repo}/../${esc}"
  printf 'AGENTS.md\n`docs/../../%s`\n' "${esc}" > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"
  rm -rf "${repo}" "${repo}/../${esc}"
  [ "${rc}" -ne 0 ] || fail_test "parent-directory escape must not resolve, got exit 0"
  grep -q "broken docs/ reference" "${out}" || fail_test "escape must be reported broken: $(cat "${out}")"
  echo "PASS: '..'-escape outside the repo fails"
}

# ── Case 10: the gate's own test scripts are exempt (they need broken refs) ─
test_test_script_exempt() {
  local repo out=/tmp/docs-path-case10.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/scripts"
  printf '#!/usr/bin/env bash\n# fixture: `docs/definitely-missing.md`\n' > "${repo}/.github/scripts/some.test.sh"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "broken refs in *.test.sh fixtures must be exempt, got exit ${rc}: $(cat "${out}")"
  echo "PASS: .github/scripts/*.test.sh fixtures are exempt"
}

# ── Case 11: a single-digit `:<line>` suffix strips, like a multi-digit one ─
# The suffix glob needed two digits, so `…spec.md:4` kept its `:4` and was
# reported as a missing file. The count assertion also pins that the citation
# was actually seen — skipping the token would pass the exit code alone.
test_single_digit_line_suffix() {
  local repo out=/tmp/docs-path-case11.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/specs"
  printf 'x\n' > "${repo}/docs/specs/2026-08-16-migration-executor-spec.md"
  printf 'AGENTS.md\n`docs/specs/2026-08-16-migration-executor-spec.md:4`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "single-digit :line suffix must strip, got exit ${rc}: $(cat "${out}")"
  grep -q "1 docs/ references, all resolve" "${out}" || fail_test "the ref must count as one and resolve: $(cat "${out}")"
  echo "PASS: a single-digit :line suffix strips and the ref still counts"
}

# ── Case 12: a test program's docs/ strings are fixtures, and the gate says so
# The checker's subject is what a reader is meant to follow. A corpus in a test
# program has to name real `docs/archive/**` keys to exercise the real
# allowlist (#1650) — and those keys are exactly the objects DOCS_POLICY rule 7
# keeps in R2 instead of in the tree, so the string is an input, not a link.
test_test_program_refs_are_fixtures() {
  local repo out=/tmp/docs-path-case12.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/ops" "${repo}/workers/edge/test"
  printf 'x\n' > "${repo}/docs/ops/deployment.md"
  printf 'const APPROVABLE = [\n  "docs/archive/a..b.png",\n  "docs/archive/A-Z_0.9.gif",\n];\n' \
    > "${repo}/workers/edge/test/allowlist-corpus.test.ts"
  printf 'AGENTS.md\nlive ref `docs/ops/deployment.md`\n' > "${repo}/AGENTS.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "a test program's docs/ corpus must not fail the gate, got exit ${rc}: $(cat "${out}")"
  grep -q "skipped 1 test programs" "${out}" \
    || fail_test "the gate must report what it skipped, not skip silently: $(cat "${out}")"
  echo "PASS: a test program's docs/ strings are fixtures and the skip is reported"
}

# ── Case 13: prose under a test/ directory is still prose ──────────────────
# The exclusion is the file's NAME, not its directory. This is the difference
# between "test programs" and "all of **/test/**": widening the carve-out to
# the directory turns this case red instead of passing quietly, which is the
# only way the gate can say how much of the tree it still reads.
test_prose_under_test_dir_still_caught() {
  local repo out=/tmp/docs-path-case13.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/workers/edge/test"
  printf 'the runbook moved to `docs/ops/gone.md`\n' > "${repo}/workers/edge/test/notes.md"
  printf 'const APPROVABLE = ["docs/archive/a..b.png"];\n' \
    > "${repo}/workers/edge/test/allowlist-corpus.test.ts"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "a broken docs/ ref in prose under a test/ dir must fail, got exit 0"
  grep -q 'workers/edge/test/notes.md:1: broken docs/ reference `docs/ops/gone.md`' "${out}" \
    || fail_test "prose under a test/ dir must still be reported: $(cat "${out}")"
  if grep -q 'allowlist-corpus.test.ts' "${out}"; then
    fail_test "a test program's docs/ strings are inputs, not references: $(cat "${out}")"
  fi
  echo "PASS: prose under a test/ directory is still caught; the corpus file is still exempt"
}

# ── Case 14: a bare ref in a file that quotes no docs/ span is still read ───
# The quoted-span pass runs first and exits 1 when it matches nothing; under
# `pipefail` + errexit that took the whole extraction subshell with it, so a
# file with no backticked `docs/` span had every bare token dropped. A broken
# bare ref — the ordinary way prose cites a doc — went unseen entirely.
test_bare_ref_in_file_without_quoted_span() {
  local repo out=/tmp/docs-path-case14.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/ops" "${repo}/src"
  printf 'x\n' > "${repo}/docs/ops/deployment.md"
  printf '// the procedure lives in docs/ops/never-written.md now\n' > "${repo}/src/bare.ts"
  printf 'see docs/ops/deployment.md for the runbook\n' > "${repo}/README.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "a broken bare docs/ ref must fail the gate, got exit 0"
  grep -q 'src/bare.ts:1: broken docs/ reference `docs/ops/never-written.md`' "${out}" \
    || fail_test "the bare ref must be named: $(cat "${out}")"
  if grep -q 'README.md' "${out}"; then
    fail_test "the resolving bare ref must still resolve: $(cat "${out}")"
  fi
  echo "PASS: a bare docs/ ref is read even when the file quotes no docs/ span"
}

test_good_refs_pass
test_missing_ref_fails
test_external_urls_skipped
test_branch_name_skipped
test_quoted_space_path_passes
test_archive_exempt
test_suffix_stripping
test_glob_skipped
test_parent_escape_fails
test_test_script_exempt
test_single_digit_line_suffix
test_test_program_refs_are_fixtures
test_prose_under_test_dir_still_caught
test_bare_ref_in_file_without_quoted_span

echo "All check-docs-paths.sh behavioral tests passed."
