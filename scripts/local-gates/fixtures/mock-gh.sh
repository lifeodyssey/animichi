#!/usr/bin/env bash
# Mock `gh` for the gate test suites: emulates `gh api graphql --paginate`
# (per-page thread tallies from MOCK_THREADS_FILE; per-page top-level comment
# arrays from MOCK_GRAPHQL_COMMENTS_FILE), `gh pr view --json
# headRefOid,baseRefOid` / `--json body` / `--json comments` (the legacy shape
# served from MOCK_COMMENTS_FILE for the inline fallback path), the GitHub
# workflow-run metadata + directly-associated PR APIs, the compare/merge-base
# API (`/compare/<base>...<head>` from MOCK_COMPARE_FILE,
# defaulting to a merge-base distinct from the base tip so tests can prove the
# recorded base is the merge-base, not the branch tip), and the commit status
# API (a `gh api .../statuses/<sha>` POST, logged to MOCK_STATUS_LOG as
# `<state> <sha>` lines so tests can assert the exact target and order, and
# fail-closed when MOCK_STATUS_FAIL=1). The comments query emulates GitHub's
# real behavior: `author.__typename` is only present in the response when the
# query requests it, so a collector that drops the field from the query fails
# closed offline. MOCK_ADVANCE_HEAD=1 makes the single-field `headRefOid`
# query advance bbb -> ccc across calls (counting via MOCK_HEAD_COUNTER_FILE)
# so tests can prove a PR head that advances between resolution and collection
# fails closed. Tests copy this into a PATH bin; nothing here talks to the
# network.
set -euo pipefail

json_field=""
jq_expr=""
is_threads_query=0
is_comments_query=0
query_has_typename=0
is_status_api=0
is_status_list_api=0
is_compare_api=0
is_check_runs_api=0
is_commit_pulls_api=0
is_workflow_run_api=0
is_workflow_run_pulls_api=0
status_state=""
status_target_url=""
compare_path=""

read_query_flags() { # read_query_flags <query=...>; mark threads/comments + typename
  case "$1" in
    *reviewThreads*) is_threads_query=1 ;;
    *"comments(first:"*) is_comments_query=1 ;;
  esac
  case "$1" in
    *__typename*) query_has_typename=1 ;;
  esac
}

# Classify the request: JSON field selectors, query/API kind, and status state.
parse_args() { # parse_args <argv...>
  local prev="" token
  for token in "$@"; do
    classify "$prev" "$token"
    prev="$token"
  done
}

classify() { # classify <prev> <token>
  case "$1:$2" in
    "--json:"*) json_field="$2" ;;
    "--jq:"*) jq_expr="$2" ;;
    "api:"*/statuses/*) is_status_api=1 ;;
    "api:"*/commits/*/statuses\?*) is_status_list_api=1 ;;
    "api:"*/commits/*/check-runs\?*) is_check_runs_api=1 ;;
    "api:"*/commits/*/pulls\?*) is_commit_pulls_api=1 ;;
    "api:"*/actions/runs/*/pull_requests\?*) is_workflow_run_pulls_api=1 ;;
    "api:"*/actions/runs/*) is_workflow_run_api=1 ;;
    "api:"*/compare/*) is_compare_api=1; compare_path="$2" ;;
    "-f:"query=*) read_query_flags "$2" ;;
    "-f:"state=*) status_state="${2#state=}" ;;
    "-f:"target_url=*) status_target_url="${2#target_url=}" ;;
  esac
  case "$2" in
    repos/*/commits/*/pulls\?*) is_commit_pulls_api=1 ;;
  esac
}

status_payload() { # status_payload <argv...>; log the status + echo its payload
  fail_if_status_unavailable
  local head_sha=""
  for token in "$@"; do case "$token" in
    */statuses/*) head_sha="${token##*/statuses/}" ;;
  esac; done
  printf '%s %s %s\n' "${status_state:-unknown}" "$head_sha" "${status_target_url:-none}" >> "${MOCK_STATUS_LOG:-/dev/null}"
  printf '{"state":"%s"}\n' "${status_state:-unknown}"
}

status_list_payload() { # status_list_payload; echo latest Review Gate ownership
  local owner="${MOCK_CURRENT_STATUS_URL:-}"
  if [ -z "$owner" ] && [ -s "${MOCK_STATUS_LOG:-/dev/null}" ]; then owner="$(tail -n 1 "$MOCK_STATUS_LOG" | awk '{print $3}')"; fi
  printf '[{"context":"Review Gate","target_url":"%s"}]\n' "$owner"
}

check_runs_payload() { # check_runs_payload; echo queue CI evidence
  local name first=1 conclusion
  printf '{"check_runs":['
  for name in 'PR Verification' Security; do
    [ "$name" = "${MOCK_MISSING_CHECK:-}" ] && continue
    [ "$first" = 1 ] || printf ','
    first=0; conclusion=success
    [ "$name" = "${MOCK_FAILED_CHECK:-}" ] && conclusion=failure
    printf '{"name":"%s","head_sha":"%s","conclusion":"%s","details_url":"https://github.com/lifeodyssey/animichi/actions/runs/%s/job/1"}' \
      "$name" "${MOCK_QUEUE_SHA:-cccccccccccccccccccccccccccccccccccccccc}" "$conclusion" "${MOCK_CI_RUN_ID:-99}"
  done
  printf ']}\n'
}

commit_pulls_payload() { # commit_pulls_payload; echo associated queue PRs
  if [ -n "${MOCK_QUEUE_PRS_FILE:-}" ]; then cat "$MOCK_QUEUE_PRS_FILE"; return; fi
  printf '%s\n' '[{"number":710,"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"base":{"ref":"main"},"state":"open"}]'
}

workflow_run_payload() { # workflow_run_payload; echo trusted run metadata
  printf '{"id":%s,"repository":{"full_name":"%s"},"event":"%s","head_sha":"%s","path":"%s","conclusion":"%s"}\n' \
    "${MOCK_RUN_ID:-99}" "${MOCK_RUN_REPO:-lifeodyssey/animichi}" "${MOCK_RUN_EVENT:-merge_group}" \
    "${MOCK_RUN_HEAD:-${MOCK_QUEUE_SHA:-cccccccccccccccccccccccccccccccccccccccc}}" \
    "${MOCK_RUN_PATH:-.github/workflows/pr-verification.yml}" "${MOCK_RUN_CONCLUSION:-success}"
}

workflow_run_pulls_payload() { # workflow_run_pulls_payload; echo direct associations
  if [ -n "${MOCK_QUEUE_PRS_FILE:-}" ]; then cat "$MOCK_QUEUE_PRS_FILE"; return; fi
  if [ -n "${MOCK_QUEUE_PRS_JSON:-}" ]; then printf '%s\n' "$MOCK_QUEUE_PRS_JSON"; return; fi
  printf '%s\n' '[{"number":710,"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"base":{"ref":"main"}}]'
}

fail_if_status_unavailable() {
  if [ "${MOCK_STATUS_FAIL:-0}" = "1" ]; then
    printf 'mock gh: status API unavailable\n' >&2
    exit 1
  fi
}

compare_payload() { # compare_payload; echo the merge-base payload
  if [ -n "${MOCK_COMPARE_FILE:-}" ]; then
    cat "$MOCK_COMPARE_FILE"
  elif [ -n "${MOCK_QUEUE_MEMBER_HEAD:-}" ] && [ "$compare_path" = "repos/lifeodyssey/animichi/compare/${MOCK_QUEUE_MEMBER_HEAD}...${MOCK_QUEUE_SHA}" ]; then
    printf '{"status":"ahead","merge_base_commit":{"sha":"%s"}}\n' "$MOCK_QUEUE_MEMBER_HEAD"
  else
    printf '%s\n' '{"merge_base_commit":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'
  fi
}

threads_payload() { # threads_payload; echo per-page thread tallies
  jq -cr '.[]' "${MOCK_THREADS_FILE:-/dev/null}"
}

comments_payload() { # comments_payload; echo per-page comments, stripping unrequested __typename
  local payload
  payload="$(jq -cr '.[]' "${MOCK_GRAPHQL_COMMENTS_FILE:-/dev/null}")"
  if [ "$query_has_typename" = "0" ] && [ -n "$payload" ]; then
    payload="$(printf '%s\n' "$payload" | jq -c 'del(.data.repository.pullRequest.comments.nodes[].author.__typename)')"
  fi
  printf '%s\n' "$payload"
}

advance_head() { # advance_head; echo headRefOid, advancing bbb -> ccc across calls
  local count
  count="$(bump_head_counter)"
  if [ "$count" -eq 1 ]; then
    printf '%s\n' '{"headRefOid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
  else
    printf '%s\n' '{"headRefOid":"cccccccccccccccccccccccccccccccccccccccc"}'
  fi
}

bump_head_counter() { # bump_head_counter; increment + persist, echo the new value
  local count=0
  [ -f "${MOCK_HEAD_COUNTER_FILE:-/dev/null}" ] && count="$(cat "$MOCK_HEAD_COUNTER_FILE")"
  count=$((count + 1))
  printf '%s\n' "$count" > "${MOCK_HEAD_COUNTER_FILE:-/dev/null}"
  printf '%s\n' "$count"
}

head_payload() { # head_payload; echo the single-field headRefOid variant
  if [ "${MOCK_ADVANCE_HEAD:-0}" = "1" ]; then advance_head; return 0; fi
  if [ "${MOCK_HEAD_EMPTY:-0}" = "1" ]; then
    printf '%s\n' '{"headRefOid":""}'
  elif [ "${MOCK_HEAD_MALFORMED:-0}" = "1" ]; then
    printf '%s\n' '{"headRefOid":"abc"}'
  else
    printf '%s\n' '{"headRefOid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
  fi
}

body_payload() { # body_payload; echo the PR body record
  if [ -n "${MOCK_PR_BODY_FILE:-}" ]; then
    cat "$MOCK_PR_BODY_FILE"
  else
    printf '%s\n' '{"body":"review-gate brief: 3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1"}'
  fi
}

pr_view_payload() { # pr_view_payload <argv...>; echo the pr-view JSON for the requested field
  case "$json_field" in
    headRefOid) head_payload ;;
    headRefOid,baseRefOid) printf '%s\n' '{"headRefOid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","baseRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' ;;
    baseRefOid) printf '%s\n' '{"baseRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' ;;
    body) body_payload ;;
    comments) cat "${MOCK_COMMENTS_FILE:?mock gh needs MOCK_COMMENTS_FILE}" ;;
    *) unsupported "$@" ;;
  esac
}

unsupported() { # unsupported <argv...>; fail on an unhandled request
  printf 'mock gh: unsupported request: %s\n' "$*" >&2
  exit 1
}

route_payload() { # route_payload <argv...>; echo the payload for the classified request
  if [ "$is_status_api" = "1" ]; then status_payload "$@"
  elif [ "$is_status_list_api" = "1" ]; then status_list_payload
  elif [ "$is_check_runs_api" = "1" ]; then check_runs_payload
  elif [ "$is_workflow_run_pulls_api" = "1" ]; then workflow_run_pulls_payload
  elif [ "$is_workflow_run_api" = "1" ]; then workflow_run_payload
  elif [ "$is_commit_pulls_api" = "1" ]; then commit_pulls_payload
  elif [ "$is_compare_api" = "1" ]; then compare_payload
  elif [ "$is_threads_query" = "1" ]; then threads_payload
  elif [ "$is_comments_query" = "1" ]; then comments_payload
  elif [ -n "$json_field" ]; then pr_view_payload "$@"
  else unsupported "$@"; fi
}

parse_args "$@"
payload="$(route_payload "$@")"
if [ -n "$jq_expr" ]; then
  printf '%s' "$payload" | jq -cr "$jq_expr"
else
  printf '%s' "$payload"
fi
