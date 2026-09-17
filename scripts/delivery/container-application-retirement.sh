#!/usr/bin/env bash
# Shared CD retirement of the container application a retired Durable Object class owned
# (migrator #1589, edge #1605). Sourced, never executed: the entry points
# (`retire-migrator-container.sh`, `retire-edge-container.sh`) bind the class name, the
# wrangler-derived application name and their default sealed config, then call
# `retire_container_application`.
#
# Why CD owns this: pinned Wrangler 4.114.0's `deployContainers` only creates or updates
# applications that remain in configuration, so dropping `[[containers]]` does not delete
# the application — and the same deploy's `deleted_classes` migration removes the class,
# after which an application belonging to it can no longer be addressed. CD therefore
# deletes the application by ID while the class still exists, before the deploy that
# removes it (docs/ops/deployment.md, "Retiring a container application").
#
# The command authority, the paged listing and its fail-closed rules are one
# implementation for every retired class; `migrator-container-retirement.test.rb` pins
# those cases through one entry point and `edge-container-retirement.test.rb` the naming
# and deletion contract through the other.

readonly RETIREMENT_APPLICATION_PAGE_LIMIT=40

retirement_require_cd_authority() {
  [ "${GITHUB_ACTIONS:-}" = "true" ] || { echo "retirement requires GitHub Actions" >&2; return 1; }
  [ "${GITHUB_REPOSITORY:-}" = "lifeodyssey/animichi" ] || { echo "repository mismatch" >&2; return 1; }
  [ "${GITHUB_REF:-}" = "refs/heads/main" ] || { echo "retirement requires main" >&2; return 1; }
  [ "${GITHUB_WORKFLOW_REF:-}" = "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main" ] || { echo "workflow mismatch" >&2; return 1; }
}

retirement_require_cloudflare_api() {
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "missing CLOUDFLARE_ACCOUNT_ID" >&2; return 1; }
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "missing CLOUDFLARE_API_TOKEN" >&2; return 1; }
}

retirement_selected_snapshot_retires_class() {
  jq -r --arg environment "$1" --arg retired_class "$2" '
    def ring: (.env[$environment] // {});
    def containers: (ring.containers // .containers // []);
    def migrations: (if (ring | has("migrations")) then ring.migrations else (.migrations // []) end);
    ((containers | length) == 0) and
    (migrations | any((.deleted_classes // []) | index($retired_class)))
  ' "$3"
}

retirement_application_page() {
  local args=(--silent --show-error --fail-with-body --max-time 30 --get "$1" --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
  [ -z "$2" ] || args+=(--data-urlencode "page_token=$2")
  curl "${args[@]}"
}

retirement_valid_application_page() {
  jq -e '(.success == true) and (.result | type == "array") and
    (.result_info | type == "object") and
    (.result | all(type == "object" and (.id | type == "string") and (.name | type == "string"))) and
    (.result_info.next_page_token? as $cursor |
      $cursor == null or (($cursor | type) == "string" and ($cursor | length) > 0))' >/dev/null
}

# One validated page of the listing: prints the applications named `$4` on it and the
# cursor that continues the walk, as `{"matches": [...], "cursor": "..."}`. An API error
# or a malformed page fails closed.
retirement_application_page_matches() {
  local url="$1" cursor="$2" application_name="$3" page
  page="$(retirement_application_page "$url" "$cursor")" || return 1
  printf '%s' "$page" | retirement_valid_application_page || { echo "malformed container application page" >&2; return 1; }
  printf '%s' "$page" | jq -c --arg name "$application_name" '{matches: [.result[] | select(.name == $name)], cursor: (.result_info.next_page_token // "")}'
}

# Adds `$2` to the followed-cursor set `$1`, printing the new set. A cursor already on it
# fails closed: a listing that loops can never be mistaken for an exhausted scan.
retirement_cursors_followed() {
  local seen_cursors="$1" cursor="$2" repeated
  repeated="$(printf '%s' "$seen_cursors" | jq -r --arg cursor "$cursor" 'index($cursor) != null')" || return 1
  [ "$repeated" = "false" ] || { echo "repeated container application cursor" >&2; return 1; }
  jq -cn --argjson seen "$seen_cursors" --arg cursor "$cursor" '$seen + [$cursor]'
}

# Lists every container application named `$2` across the pages of `$1`, printing the
# matches as a JSON array. Absence is an idempotent success only after the cursor is
# exhausted; page-limit, API, malformed-page and repeated-cursor failures all fail closed.
retirement_applications_named() {
  local url="$1" application_name="$2" cursor='' seen_cursors='[]' matches='[]' page scan=''
  for ((page = 1; page <= RETIREMENT_APPLICATION_PAGE_LIMIT; page++)); do
    scan="$(retirement_application_page_matches "$url" "$cursor" "$application_name")" || return 1
    matches="$(printf '%s' "$scan" | jq -c --argjson matches "$matches" '$matches + .matches')" || return 1
    cursor="$(printf '%s' "$scan" | jq -r '.cursor')" || return 1
    [ -n "$cursor" ] || { printf '%s' "$matches"; return 0; }
    seen_cursors="$(retirement_cursors_followed "$seen_cursors" "$cursor")" || return 1
  done
  echo "container application page limit exceeded" >&2; return 1
}

# Deletes the one application named `$1` among the listing `$2`. No match is an
# idempotent success — the retirement already happened — while two matches fail closed
# rather than guess which application the retired class owned.
retirement_delete_named_application() {
  local application_name="$1" matches="$2" count='' application_id=''
  count="$(printf '%s' "$matches" | jq 'length')" || return 1
  [ "$count" -le 1 ] || { echo "multiple container applications named $application_name" >&2; return 1; }
  if [ "$count" -eq 0 ]; then
    echo "Container application $application_name is already absent."
    return 0
  fi
  application_id="$(printf '%s' "$matches" | jq -er '.[0].id')" || return 1
  pnpm exec wrangler containers delete "$application_id"
}

# Deletes the container application `$2` the class `$1` owned in `$3`, but only when the
# sealed config `$4` still carries the tag that deletes the class: dropping a class whose
# application survives strands an application nothing can address. A config that does not
# retire the class skips the step; an already-absent application is an idempotent success.
retire_container_application() {
  local retired_class="$1" application_name="$2" environment="$3" config="$4" retirement='' matches=''
  retirement_require_cd_authority
  retirement="$(retirement_selected_snapshot_retires_class "$environment" "$retired_class" "$config")"
  [ "$retirement" = "true" ] || { echo "Selected $environment snapshot still owns the $retired_class container; retirement skipped."; return 0; }
  retirement_require_cloudflare_api
  local url="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/containers/dash/applications"
  matches="$(retirement_applications_named "$url" "$application_name")" || return 1
  retirement_delete_named_application "$application_name" "$matches"
}
