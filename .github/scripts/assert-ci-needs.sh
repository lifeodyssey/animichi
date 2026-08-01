#!/usr/bin/env bash
set -euo pipefail

lane="${1:?usage: assert-ci-needs.sh <lane> <statuses>}"
statuses="${2:?usage: assert-ci-needs.sh <lane> <statuses>}"

read -r -a status_list <<< "$statuses"
if [[ "${#status_list[@]}" -eq 0 ]]; then
  echo "::error title=${lane}::no upstream statuses were supplied" >&2
  exit 1
fi

changes_status="${status_list[0]}"
if [[ "$changes_status" != "success" ]]; then
  echo "::error title=${lane}::path detection finished with status '${changes_status}'" >&2
  exit 1
fi

for status in "${status_list[@]:1}"; do
  case "$status" in
    success|skipped) ;;
    *)
      echo "::error title=${lane}::upstream CI job finished with status '${status}'" >&2
      exit 1
      ;;
  esac
done

echo "${lane}: all upstream jobs are successful or intentionally skipped"
