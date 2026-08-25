#!/usr/bin/env bash
# Focused contract tests for the commit-msg hygiene gate. The validator reads
# only the message file supplied by Git/pre-commit, so these cases are
# hermetic and never create commits or mutate repository history.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
GATE="$SCRIPT_DIR/commit-message.py"
CONFIG="$REPO_ROOT/.pre-commit-config.yaml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

run_gate() {
  local message="$1"
  printf '%s\n' "$message" > "$TMP/COMMIT_EDITMSG"
  python3 "$GATE" "$TMP/COMMIT_EDITMSG"
}

run_subject() {
  python3 "$GATE" --subject "$1"
}

assert_pass() {
  local name="$1" message="$2"
  run_gate "$message" >"$TMP/out" 2>&1 \
    || { cat "$TMP/out" >&2; fail "$name should pass"; }
  echo "ok: $name"
}

assert_fail() {
  local name="$1" expected="$2" message="$3"
  if run_gate "$message" >"$TMP/out" 2>&1; then
    fail "$name should fail"
  fi
  grep -qF -- "$expected" "$TMP/out" \
    || { cat "$TMP/out" >&2; fail "$name lacks: $expected"; }
  echo "ok: $name"
}

assert_subject_fail() {
  local name="$1" expected="$2" subject="$3"
  if run_subject "$subject" >"$TMP/out" 2>&1; then
    fail "$name should fail"
  fi
  grep -qF -- "$expected" "$TMP/out" \
    || { cat "$TMP/out" >&2; fail "$name lacks: $expected"; }
  echo "ok: $name"
}

test_allowed_taxonomy() {
  local type scope
  for type in feat fix refactor perf test docs ci build ops chore revert; do
    assert_pass "allowed type $type" "$type: describe a concrete outcome"
  done
  for scope in agent web chat catalog users auth edge contract db infra delivery eval e2e repo deps; do
    assert_pass "allowed scope $scope" "fix($scope): describe a concrete outcome"
  done
}

test_subject_contract() {
  local filler subject72 subject73
  printf -v filler '%*s' 60 ''
  filler="${filler// /a}"
  subject72="docs(repo): $filler"
  subject73="${subject72}a"
  [ "${#subject72}" = "72" ] || fail "72-character fixture drifted"

  assert_pass "72-character subject" "$subject72"
  assert_fail "73-character subject" "72 characters" "$subject73"
  assert_fail "unknown type" "allowed type" "style(web): refine settings layout"
  assert_fail "unknown scope" "approved scope" "feat(frontend): add settings page"
  assert_fail "missing structured subject" "expected <type>" "update chat"
  assert_fail "empty outcome" "expected <type>" "fix: "
  assert_fail "uppercase outcome" "lowercase verb" "fix(web): Preserve settings layout"
  assert_fail "PR suffix" "PR number suffix" "fix(web): preserve settings layout (#123)"
  assert_subject_fail "PR title suffix" "PR number suffix" "fix(web): preserve settings layout (#123)"
}

test_generic_subjects() {
  local outcome
  for outcome in WIP checkpoint fix update review polish format formatting lint ci tests comments; do
    assert_fail "generic $outcome subject" "generic outcome" "chore(repo): $outcome"
  done
}

test_git_maintenance_subjects() {
  assert_pass "Git merge subject" "Merge branch 'main' into codex/topic"
  assert_pass "Git revert subject" 'Revert "feat(chat): stream route progress"'
  assert_fail "non-Git maintenance subject" "expected <type>" "Bump release version"
  assert_fail "malformed revert subject" "expected <type>" "Revert feat(chat): stream route progress"
  assert_subject_fail "PR title cannot be merge" "expected <type>" "Merge branch 'main' into codex/topic"
  assert_subject_fail "PR title cannot be revert" "expected <type>" 'Revert "feat(chat): stream route progress"'
  assert_fail "maintenance AI coauthor" "AI co-author trailer" $'Merge branch \'main\' into codex/topic\n\nCo-Authored-By: Codex <codex@openai.com>'
}

test_attribution_policy() {
  local prose human dependabot
  prose=$'docs(repo): explain review provenance\n\nClaude and Codex were compared as review tools.'
  human=$'feat(chat): stream route progress\n\nCo-authored-by: Alice Example <alice@example.com>'
  dependabot=$'build(deps): update runtime dependencies\n\nCo-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>'

  assert_pass "ordinary tool prose" "$prose"
  assert_pass "human coauthor" "$human"
  assert_pass "Dependabot coauthor" "$dependabot"
  assert_pass "non-footer tool prose" $'docs(repo): record generator choice\n\nGenerated with Claude Code assistance during a local comparison.'
  assert_fail "Claude coauthor" "AI co-author trailer" $'feat(agent): add typed planning\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
  assert_fail "Anthropic coauthor" "AI co-author trailer" $'feat(agent): add typed planning\n\nco-authored-by: Helper <bot@anthropic.com>'
  assert_fail "Codex coauthor" "AI co-author trailer" $'fix(repo): enforce clean attribution\n\nCo-Authored-By: Codex <codex@openai.com>'
  assert_fail "OpenAI coauthor" "AI co-author trailer" $'fix(repo): enforce clean attribution\n\nCo-authored-by: Review Bot <review@openai.com>'
  assert_fail "Claude Code footer" "Claude Code generation footer" $'docs(repo): record commit policy\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'
}

test_precommit_wiring() {
  grep -qF -- "default_stages: [pre-commit]" "$CONFIG" \
    || fail "unspecified hooks would leak into commit-msg"
  grep -qF -- "id: commit-message" "$CONFIG" \
    || fail "pre-commit config lacks commit-message hook"
  grep -qF -- "entry: python3 scripts/local-gates/commit-message.py" "$CONFIG" \
    || fail "pre-commit config invokes the wrong validator"
  grep -qF -- "stages: [commit-msg]" "$CONFIG" \
    || fail "commit-message hook is not limited to commit-msg"
  echo "ok: pre-commit commit-msg wiring"
}

test_direct_subject_cli() {
  run_subject "fix(delivery): keep squash titles meaningful" >"$TMP/out" 2>&1 \
    || { cat "$TMP/out" >&2; fail "direct valid subject should pass"; }
  if run_subject "WIP" >"$TMP/out" 2>&1; then
    fail "direct invalid subject should fail"
  fi
  grep -qF -- "expected <type>" "$TMP/out" \
    || { cat "$TMP/out" >&2; fail "direct invalid subject lacks policy error"; }
  echo "ok: direct --subject CLI"
}

test_allowed_taxonomy
test_subject_contract
test_generic_subjects
test_git_maintenance_subjects
test_attribution_policy
test_precommit_wiring
test_direct_subject_cli
echo "commit-message.test.sh: all green"
