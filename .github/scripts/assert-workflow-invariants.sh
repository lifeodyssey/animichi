#!/usr/bin/env bash
# Machine-checked invariants over .github/workflows/*.yml (S0-v2 B2; step 1d of
# docs/iterations/iter6/design-CI-1-pipeline-refactor.md):
#   a. every job that declares `runs-on:` also declares `timeout-minutes:`
#   b. every workflow declares a top-level `permissions:` block
#   c. every pipeline-*.yml declares a top-level `concurrency:` block
#   d. every pipeline-*.yml triggers on `merge_group` (inside its `on:` map)
# One line per violation (`file:job:check`), exit 1 if any.
#
# Parsing choice: shape-only awk parsing, NOT yq. yq is not guaranteed on
# runner images and would drag a toolchain install into every CI run; the
# checks only need top-level shape (job keys, `runs-on` / `timeout-minutes`
# inside a job block, top-level keys, `merge_group` under `on:`), and YAML
# validity itself is owned by the actionlint step in pipeline-quality.yml.
# The parse is deliberately conservative and fail-closed: anything it cannot
# attribute (e.g. an `on:` written inline instead of as a map) reads as a
# missing trigger and fails the gate loudly, never silently passes.
set -euo pipefail

WORKFLOW_DIR="${1:-$(git rev-parse --show-toplevel)/.github/workflows}"

[ -d "${WORKFLOW_DIR}" ] || {
  echo "assert-workflow-invariants: no such directory: ${WORKFLOW_DIR}" >&2
  exit 1
}

compgen -G "${WORKFLOW_DIR}/*.yml" >/dev/null || {
  echo "assert-workflow-invariants: no workflow files under ${WORKFLOW_DIR}" >&2
  exit 1
}

main() {
  local -a files=("${WORKFLOW_DIR}"/*.yml)
  local total="${#files[@]}" violations
  violations="$(awk '
    function job_name(j) {
      sub(/^  /, "", j)
      sub(/:$/, "", j)
      return j
    }
    function finalize_job() {
      if (in_job && job_runs_on && !job_timeout) {
        print cur_file ":" job_name(job) ":missing timeout-minutes"
      }
      in_job = 0
    }
    function finalize_file() {
      if (!has_permissions) {
        print cur_file ":top-level:missing permissions"
      }
      if (index(cur_file, "pipeline-") == 1) {
        if (!has_concurrency) {
          print cur_file ":top-level:missing concurrency"
        }
        if (!has_merge_group) {
          print cur_file ":top-level:missing merge_group trigger"
        }
      }
    }
    FNR == 1 {
      if (NR > 1) {
        finalize_job()
        finalize_file()
      }
      cur_file = FILENAME
      sub(/^.*\//, "", cur_file)
      has_permissions = 0
      has_concurrency = 0
      has_merge_group = 0
      in_jobs = 0
      next
    }
    {
      if ($0 ~ /^[[:space:]]*$/) next
      if ($0 ~ /^[[:space:]]*#/) next
      sub(/[[:space:]]*$/, "", $0)
      if ($0 ~ /^[a-zA-Z0-9_.-]+:$/) {
        finalize_job()
        in_jobs = 0
        if ($0 == "jobs:") in_jobs = 1
        else if ($0 == "permissions:") has_permissions = 1
        else if ($0 == "concurrency:") has_concurrency = 1
        next
      }
      if (in_jobs && $0 ~ /^  [a-zA-Z0-9_.-]+:$/) {
        finalize_job()
        job = $0
        job_runs_on = 0
        job_timeout = 0
        in_job = 1
        next
      }
      if (in_job) {
        if ($0 ~ /^    runs-on:/) job_runs_on = 1
        else if ($0 ~ /^    timeout-minutes:/) job_timeout = 1
        next
      }
      if ($0 == "  merge_group:") has_merge_group = 1
    }
    END {
      finalize_job()
      finalize_file()
    }
  ' "${files[@]}")"
  if [ -n "${violations}" ]; then
    printf '%s\n' "${violations}"
    exit 1
  fi
  echo "checked ${total} workflow files, all invariants hold"
}

main
