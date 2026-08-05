#!/usr/bin/env bash
# Supply-chain pinning gate (S0-v2 B3): every `uses:` in
# .github/workflows/*.yml and .github/actions/**/*.yml must reference a full
# 40-char commit SHA. Local `./` action/workflow paths are allowed; `docker://`
# images cannot be SHA-pinned and are allowed only with a trailing `#` comment.
# Commented-out YAML lines (e.g. CodeQL's `# uses: actions/setup-example@v1`
# example) are ignored.
#
# ── Operator toggles — merge-PR body MUST instruct, never do them from code ──
# 1. Require SHA pinning at repo level (Settings > Actions > General > "Require
#    SHA-pinned actions", or the API). Measured shape (design-CI-1-pipeline-
#    refactor.md): GET /actions/permissions returns sha_pinning_required:false
#    today. The operator must flip it:
#      gh api -X PUT repos/lifeodyssey/animichi/actions/permissions \
#        -f sha_pinning_required=true
#    then verify: gh api repos/lifeodyssey/animichi/actions/permissions
#    (expected: sha_pinning_required=true). The card's "workflow-sha-pinning
#    style endpoint" phrasing is the Settings checkbox; if the PUT above 404s,
#    use the Settings UI toggle instead — the endpoint name has drifted in the
#    past, the goal (sha_pinning_required=true) is what matters.
# 2. Repo-level CLOUDFLARE_* secret cleanup — verify, do not assume. Per
#    docs/ops/secrets.md:113-114, CLOUDFLARE_PULUMI_API_TOKEN has NO repo-level
#    copy (env-only), and CLOUDFLARE_API_TOKEN's repo copy is documented as
#    "required in caller secret maps" — possibly stale, unverified. Operator:
#    run `gh secret list` to verify actual tiers, reconcile with
#    docs/ops/secrets.md:113-114 (its caller-map caveat may itself be stale),
#    and only then delete confirmed-dead repo-level copies — record findings
#    in the PR:
#      gh secret delete <confirmed-dead-name> -R lifeodyssey/animichi
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ROOT="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ROOT}")"
cd "${ROOT}"

TOTAL_FILES=0
TOTAL_USES=0
TOTAL_BAD=0

list_workflow_files() {
  git ls-files ':(glob).github/workflows/*.yml' ':(glob).github/actions/**/*.yml'
}

# A `uses:` that sits on a YAML comment line (anything before it contains '#')
# is not live config and must be ignored.
line_uses_commented() {
  local line="$1"
  case "${line%%uses:*}" in
    *'#'*) return 0 ;;
  esac
  return 1
}

# Prints the `uses:` value (everything up to the first '#' or whitespace).
uses_ref() {
  local line="$1"
  printf '%s' "${line#*uses:}" | sed 's/^[[:space:]]*//; s/[[:space:]#].*//'
}

bad() {
  local file="$1" line_no="$2" msg="$3"
  TOTAL_BAD=$((TOTAL_BAD + 1))
  echo "${file}:${line_no}: ${msg}"
}

check_line() {
  local file="$1" line_no="$2" line="$3" ref="$4" has_comment=0
  case "${line}" in
    *'#'*) has_comment=1 ;;
  esac
  case "${ref}" in
    ./*) return 0 ;;
    docker://*)
      if [ "${has_comment}" -eq 1 ]; then return 0; fi
      bad "${file}" "${line_no}" "uses: ${ref} — docker:// cannot be SHA-pinned; add a trailing '# pinned by <image>@<digest>' comment"
      return 0
      ;;
  esac
  local sha="${ref##*@}"
  if [ "${sha}" = "${ref}" ]; then
    bad "${file}" "${line_no}" "uses: ${ref} — no @ref at all; must be pinned to a full 40-char SHA"
    return 0
  fi
  if [ "${#sha}" -eq 40 ] && printf '%s' "${sha}" | grep -Eq '^[0-9a-f]{40}$'; then
    return 0
  fi
  bad "${file}" "${line_no}" "uses: ${ref} — not pinned to a full 40-char SHA (got '${sha}')"
}

check_file() {
  local file="$1" line_no line
  while IFS=: read -r line_no line; do
    line_uses_commented "${line}" && continue
    TOTAL_USES=$((TOTAL_USES + 1))
    check_line "${file}" "${line_no}" "${line}" "$(uses_ref "${line}")"
  done < <(grep -n 'uses:' "${file}")
}

main() {
  local file
  while read -r file; do
    TOTAL_FILES=$((TOTAL_FILES + 1))
    check_file "${file}"
  done < <(list_workflow_files)
  summarize
}

summarize() {
  if [ "${TOTAL_BAD}" -gt 0 ]; then
    exit 1
  fi
  echo "checked ${TOTAL_FILES} files, ${TOTAL_USES} uses, all pinned to full 40-char SHAs"
}

main
