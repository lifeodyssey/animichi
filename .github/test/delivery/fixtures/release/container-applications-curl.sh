#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$REQUESTS"
cursor="$(printf '%s\n' "$@" | sed -n 's/^page_token=//p')"
cursor="${cursor:-root}"
exit_file="$FIXTURE_PAGES/$cursor.exit"
[ ! -f "$exit_file" ] || exit "$(tr -d '\n' < "$exit_file")"
page_file="$FIXTURE_PAGES/$cursor.json"
[ ! -f "$FIXTURE_PAGES/$cursor.seen" ] || page_file="$FIXTURE_PAGES/$cursor-repeat.json"
: > "$FIXTURE_PAGES/$cursor.seen"
cat "$page_file"
