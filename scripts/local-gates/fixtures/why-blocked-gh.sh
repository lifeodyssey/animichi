#!/usr/bin/env bash
set -euo pipefail

BASE_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
HEAD_SHA="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
SCENARIO="${WHY_BLOCKED_SCENARIO:-blocked}"
CODEQL="neutral"
REVIEW="PENDING"
REVIEW_REQUIRED=true
BEHIND=3
THREADS=2
MERGE_STATE="BEHIND"
PR_STATUS="completed"
PR_CONCLUSION="success"
SECURITY_CHECKS='{"id":2,"name":"Security","status":"completed","conclusion":"success","started_at":"2026-08-25T01:02:00Z","app":{"id":15368}}'
RULES='[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"PR Verification"},{"context":"Security","integration_id":15368},{"context":"Review Gate","integration_id":15368}]}},{"type":"code_scanning","parameters":{"code_scanning_tools":[{"tool":"CodeQL"}]}}]'

clean_state() {
  CODEQL="success"; REVIEW="SUCCESS"; BEHIND=0; THREADS=0; MERGE_STATE="CLEAN"
}

case "$SCENARIO" in
  blocked) ;;
  clean) clean_state ;;
  wrong-source)
    clean_state
    SECURITY_CHECKS='{"id":2,"name":"Security","status":"completed","conclusion":"failure","started_at":"2026-08-25T01:02:00Z","app":{"id":15368}},{"id":22,"name":"Security","status":"completed","conclusion":"success","started_at":"2026-08-25T01:05:00Z","app":{"id":999}}'
    ;;
  same-time-rerun)
    clean_state
    SECURITY_CHECKS='{"id":9,"name":"Security","status":"completed","conclusion":"success","started_at":"2026-08-25T01:02:00Z","app":{"id":15368}},{"id":10,"name":"Security","status":"completed","conclusion":"failure","started_at":"2026-08-25T01:02:00Z","app":{"id":15368}}'
    ;;
  wrong-status-source) clean_state; REVIEW_REQUIRED=false ;;
  queued-success) clean_state; PR_STATUS="queued" ;;
  merge-blocked) clean_state; MERGE_STATE="BLOCKED" ;;
  unreadable) RULES='{}' ;;
  *) printf 'unknown fixture scenario: %s\n' "$SCENARIO" >&2; exit 64 ;;
esac

case "$*" in
  "repo view --json nameWithOwner --jq .nameWithOwner")
    printf '%s\n' "lifeodyssey/animichi"
    ;;
  "pr view 42 -R lifeodyssey/animichi --json number,baseRefName,baseRefOid,headRefOid,mergeStateStatus")
    printf '{"number":42,"baseRefName":"main","baseRefOid":"%s","headRefOid":"%s","mergeStateStatus":"%s"}\n' "$BASE_SHA" "$HEAD_SHA" "$MERGE_STATE"
    ;;
  "api repos/lifeodyssey/animichi/rules/branches/main")
    printf '%s\n' "$RULES"
    ;;
  "api repos/lifeodyssey/animichi/commits/$HEAD_SHA/check-runs --paginate --jq .check_runs")
    printf '[{"id":3,"name":"CodeQL","status":"completed","conclusion":"%s","started_at":"2026-08-25T01:03:00Z","app":{"id":15368}},%s,{"id":1,"name":"PR Verification","status":"%s","conclusion":"%s","started_at":"2026-08-25T01:01:00Z","app":{"id":15368}}]\n' "$CODEQL" "$SECURITY_CHECKS" "$PR_STATUS" "$PR_CONCLUSION"
    ;;
  api\ graphql*-F\ sha=$HEAD_SHA*)
    printf '[{"id":"status-4","context":"Review Gate","state":"%s","updatedAt":"2026-08-25T01:04:00Z","isRequired":%s}]\n' "$REVIEW" "$REVIEW_REQUIRED"
    ;;
  "api repos/lifeodyssey/animichi/compare/$BASE_SHA...$HEAD_SHA")
    printf '{"ahead_by":2,"behind_by":%s,"status":"diverged"}\n' "$BEHIND"
    ;;
  api\ graphql\ --paginate*)
    printf '{"count":%s,"malformed":0}\n' "$THREADS"
    ;;
  *)
    printf 'unexpected gh invocation: %s\n' "$*" >&2
    exit 64
    ;;
esac
