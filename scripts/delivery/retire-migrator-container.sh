#!/usr/bin/env bash
# Delete the legacy migrator container application before its DO class deletion deploy.
set -euo pipefail

environment="${1:-}"
config="${2:-release/migrator/wrangler.json}"
readonly MAX_APPLICATION_PAGES=40

require_cd_authority() {
  [ "${GITHUB_ACTIONS:-}" = "true" ] || { echo "retirement requires GitHub Actions" >&2; return 1; }
  [ "${GITHUB_REPOSITORY:-}" = "lifeodyssey/animichi" ] || { echo "repository mismatch" >&2; return 1; }
  [ "${GITHUB_REF:-}" = "refs/heads/main" ] || { echo "retirement requires main" >&2; return 1; }
  [ "${GITHUB_WORKFLOW_REF:-}" = "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main" ] || { echo "workflow mismatch" >&2; return 1; }
}

retired_application_name() {
  case "$environment" in
    staging) printf '%s\n' 'migrator-staging-migrationcontainer-staging' ;;
    production) printf '%s\n' 'migrator-production-migrationcontainer-production' ;;
    *) echo "unknown environment: $environment" >&2; return 1 ;;
  esac
}

selected_snapshot_retires_class() {
  jq -r --arg environment "$environment" '
    def ring: (.env[$environment] // {});
    def containers: (ring.containers // .containers // []);
    def migrations: (if (ring | has("migrations")) then ring.migrations else (.migrations // []) end);
    ((containers | length) == 0) and
    (migrations | any((.deleted_classes // []) | index("MigrationContainer")))
  ' "$config"
}

require_cloudflare_api() {
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "missing CLOUDFLARE_ACCOUNT_ID" >&2; return 1; }
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "missing CLOUDFLARE_API_TOKEN" >&2; return 1; }
}

fetch_application_page() {
  local args=(--silent --show-error --fail-with-body --max-time 30 --get "$applications_url" --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
  [ -z "$1" ] || args+=(--data-urlencode "page_token=$1")
  curl "${args[@]}"
}

valid_application_page() {
  jq -e '(.success == true) and (.result | type == "array") and
    (.result_info | type == "object") and
    (.result | all(type == "object" and (.id | type == "string") and (.name | type == "string"))) and
    (.result_info.next_page_token? as $cursor |
      $cursor == null or (($cursor | type) == "string" and ($cursor | length) > 0))' >/dev/null
}

require_cd_authority
application_name="$(retired_application_name)"
retirement="$(selected_snapshot_retires_class)"
if [ "$retirement" != "true" ]; then
  echo "Selected $environment migrator still owns the container; retirement skipped."
  exit 0
fi

require_cloudflare_api
applications_url="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/containers/dash/applications"
matches='[]'
cursor=''
seen_cursors='[]'
page_count=0
while :; do
  page_count=$((page_count + 1))
  [ "$page_count" -le "$MAX_APPLICATION_PAGES" ] || { echo "container application page limit exceeded" >&2; exit 1; }
  page="$(fetch_application_page "$cursor")"
  printf '%s' "$page" | valid_application_page || { echo "malformed container application page" >&2; exit 1; }
  current="$(printf '%s' "$page" | jq -c --arg name "$application_name" '[.result[] | select(.name == $name)]')"
  matches="$(jq -cn --argjson matches "$matches" --argjson current "$current" '$matches + $current')"
  next_cursor="$(printf '%s' "$page" | jq -r '.result_info.next_page_token // empty')"
  [ -n "$next_cursor" ] || break
  if printf '%s' "$seen_cursors" | jq -e --arg cursor "$next_cursor" 'index($cursor) != null' >/dev/null; then
    echo "repeated container application cursor" >&2
    exit 1
  fi
  seen_cursors="$(jq -cn --argjson seen "$seen_cursors" --arg cursor "$next_cursor" '$seen + [$cursor]')"
  cursor="$next_cursor"
done
count="$(printf '%s' "$matches" | jq 'length')"
[ "$count" -le 1 ] || { echo "multiple container applications named $application_name" >&2; exit 1; }
if [ "$count" -eq 0 ]; then
  echo "Container application $application_name is already absent."
  exit 0
fi

application_id="$(printf '%s' "$matches" | jq -er '.[0].id')"
pnpm exec wrangler containers delete "$application_id"
