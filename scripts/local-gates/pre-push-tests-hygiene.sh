#!/usr/bin/env bash
# Hygiene tests for the pre-push gate scripts — sourced by pre-push.test.sh
# (the single entry point); not standalone.
#
# Covers AC5/AC6/AC7: no gate script may contain a forbidden cloud-mutation
# command (wrangler deploy without --dry-run, mutating pulumi, codecov/gh pr/
# lighthouse/test-eval, atlas apply outside the disposable local schema), and
# a missing prerequisite must fail the orchestrator with an actionable install
# hint instead of a silent pass.
#
# The scan is comment-aware (#1003): the gate scripts legitimately mention the
# forbidden commands in explanatory prose (the routing contract documents
# `GATE_CHANGED_PACKAGES=web git push`) but never execute them. Only
# executable lines are scanned — comments are stripped from the EXECUTABLE
# command (a full-line comment, or an inline ` # ...` tail on an executable
# line), backslash-newline continuations are joined so a split forbidden
# command is seen whole, and command words match across arbitrary whitespace.
# test_comment_tokens_do_not_fail_scan / test_inline_comment_tokens_do_not_fail_scan
# and test_executable_forbidden_command_fails_scan /
# test_arbitrary_whitespace_forbidden_command_fails_scan /
# test_split_continuation_forbidden_command_fails_scan pin both directions
# (the URL-fragment case lives in pre-push-tests-hygiene-url.sh).
# Version-gate semantics (node >= 24; atlas accepts any printed version) are
# tested in pre-push-tests-prereqs.sh.

# join_continuations: fold `\`-newline shell continuations onto one line so a
# forbidden command split across lines (e.g. `pulumi \` + `up`) is scanned as
# the single command the shell would execute.
join_continuations() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    while [[ "$line" == *\\ ]]; do
      IFS= read -r continuation || break
      line="${line%\\} ${continuation}"
    done
    printf '%s\n' "$line"
  done < "$1"
}

# strip_inline_comments: drop a `#` that starts a comment from each
# executable line. A comment start is a `#` at line start (after optional
# whitespace) or a `#` preceded by whitespace; a `#` glued to a token
# (shebang, URL fragment) is not a comment and is left intact. Reads stdin
# (the piped continuation-joined output), so it must not take a filename
# under `set -u`.
strip_inline_comments() {
  sed -e 's/^[[:space:]]*#[^!].*$//' -e 's/[[:space:]][[:space:]]*#.*$//'
}

executable_lines() {
  join_continuations "$1" | strip_inline_comments
}

assert_no_wrangler_deploy() {
  if executable_lines "$1" | grep -E "wrangler[[:space:]]+deploy([[:space:]]|$)" | grep -qv -- "--dry-run"; then
    echo "FAIL: $1 contains a wrangler deploy without --dry-run" >&2
    exit 1
  fi
}

assert_no_mutating_pulumi() {
  if executable_lines "$1" | grep -qE "pulumi[[:space:]]+(up|destroy|stack[[:space:]]+rm|refresh)"; then
    echo "FAIL: $1 contains a mutating pulumi command" >&2
    exit 1
  fi
}

assert_no_cloud_only_commands() {
  if executable_lines "$1" | grep -qE "codecov|git[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+|wrangler[[:space:]]+secret|lighthouse|lhci|test-eval"; then
    echo "FAIL: $1 contains a forbidden cloud-only command" >&2
    exit 1
  fi
}

assert_atlas_apply_local_only() {
  if executable_lines "$1" | grep -E "atlas[[:space:]]+migrate[[:space:]]+apply" | grep -qv -- "--url postgresql://postgres:gate@127.0.0.1"; then
    echo "FAIL: $1 runs atlas apply outside the disposable local schema" >&2
    exit 1
  fi
}

assert_script_hygiene() {
  assert_no_wrangler_deploy "$1"
  assert_no_mutating_pulumi "$1"
  assert_no_cloud_only_commands "$1"
  assert_atlas_apply_local_only "$1"
}

test_no_forbidden_cloud_mutation_commands() {
  local script
  for script in "$SCRIPT_DIR"/{pre-push,quality,infra-check,db-fresh-schema,changed-packages,contract-drift}.sh; do
    assert_script_hygiene "$script"
  done
  echo "ok: no forbidden cloud-mutation command in gate scripts"
}

# ── comment-aware scan regression (#1003) ──
# The scan must ignore forbidden tokens inside comments (the routing contract
# documents `GATE_CHANGED_PACKAGES=web git push` in prose) yet still fail on
# a genuinely executable forbidden command. Fixtures: one file whose tokens
# live only in full-line comments, one whose token is an executable line, one
# whose token sits after an inline `#` on an executable line, one whose words
# are split by arbitrary whitespace, and one whose command is split across a
# shell continuation.
write_scan_fixtures() {
  printf '#!/usr/bin/env bash\n' > "$GATE_STUB_ROOT/scan-comment.sh"
  printf '# comment: git push, codecov, gh pr, wrangler secret, lighthouse, lhci, test-eval\n' >> "$GATE_STUB_ROOT/scan-comment.sh"
  printf '# comment: pulumi up, atlas migrate apply --url file://remote, wrangler deploy --prod\n' >> "$GATE_STUB_ROOT/scan-comment.sh"
  printf 'printf "clean\\n"\n' >> "$GATE_STUB_ROOT/scan-comment.sh"
  printf '#!/usr/bin/env bash\ngit push origin main\n' > "$GATE_STUB_ROOT/scan-exec.sh"
  printf '#!/usr/bin/env bash\ntrue # git push origin main\n' > "$GATE_STUB_ROOT/scan-inline-comment.sh"
  printf '#!/usr/bin/env bash\ngit  push origin main\n' > "$GATE_STUB_ROOT/scan-multi-space.sh"
  printf '#!/usr/bin/env bash\npulumi \\\nup\n' > "$GATE_STUB_ROOT/scan-continuation.sh"
}

test_comment_tokens_do_not_fail_scan() {
  write_scan_fixtures
  assert_script_hygiene "$GATE_STUB_ROOT/scan-comment.sh"
  echo "ok: forbidden tokens inside comments do not fail the scan"
}

test_executable_forbidden_command_fails_scan() {
  write_scan_fixtures
  if ( assert_script_hygiene "$GATE_STUB_ROOT/scan-exec.sh" ) 2>/dev/null; then
    echo "FAIL: an executable forbidden command must fail the scan" >&2
    exit 1
  fi
  echo "ok: an executable forbidden command fails the scan"
}

test_inline_comment_tokens_do_not_fail_scan() {
  write_scan_fixtures
  assert_script_hygiene "$GATE_STUB_ROOT/scan-inline-comment.sh"
  echo "ok: forbidden tokens after an inline # comment do not fail the scan"
}

test_arbitrary_whitespace_forbidden_command_fails_scan() {
  write_scan_fixtures
  if ( assert_script_hygiene "$GATE_STUB_ROOT/scan-multi-space.sh" ) 2>/dev/null; then
    echo "FAIL: arbitrary whitespace between command words must fail the scan" >&2
    exit 1
  fi
  echo "ok: arbitrary whitespace between command words fails the scan"
}

test_split_continuation_forbidden_command_fails_scan() {
  write_scan_fixtures
  if ( assert_script_hygiene "$GATE_STUB_ROOT/scan-continuation.sh" ) 2>/dev/null; then
    echo "FAIL: a command split across a shell continuation must fail the scan" >&2
    exit 1
  fi
  echo "ok: a command split across a shell continuation fails the scan"
}

assert_prereq_out() {
  grep -qi "$1" "$GATE_STUB_ROOT/prereq.out" || { echo "FAIL: prereq failure output lacks: $1" >&2; exit 1; }
}

make_no_atlas_bin() {
  local no_atlas_bin="$GATE_STUB_ROOT/no-atlas"
  mkdir -p "$no_atlas_bin"
  local tool
  for tool in uv pnpm node pulumi docker actionlint; do
    ln -sf "$GATE_STUB_BIN/$tool" "$no_atlas_bin/$tool"
  done
  printf '%s\n' "$no_atlas_bin"
}

# /bin:/usr/bin only (no homebrew dirs): the fixture must genuinely lack
# atlas regardless of what the host has installed.
run_no_atlas_gate() {
  local bin="$1"
  local rc=0
  (
    cd "$REPO_ROOT"
    PATH="$bin:/bin:/usr/bin" GATE_OUTDIR="$GATE_STUB_ROOT/out" "$PRE_PUSH"
  ) >"$GATE_STUB_ROOT/prereq.out" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

test_missing_prerequisite_fails() {
  local rc
  rc="$(run_no_atlas_gate "$(make_no_atlas_bin)")"
  [ "$rc" != "0" ] || { echo "FAIL: missing prerequisite must fail" >&2; exit 1; }
  assert_prereq_out "atlas"
  assert_prereq_out "install"
  echo "ok: missing prerequisite fails with an install hint"
}
