#!/usr/bin/env bash
set -euo pipefail

lane="${1:?usage: assert-ci-needs.sh <lane> <statuses>}"
statuses="${2:?usage: assert-ci-needs.sh <lane> <statuses>}"

if [[ -z "$statuses" ]]; then
  echo "::error title=${lane}::no upstream statuses were supplied"
  exit 1
fi

for status in $statuses; do
  case "$status" in
    success|skipped) ;;
    *)
      echo "::error title=${lane}::upstream CI job finished with status '${status}'"
      exit 1
      ;;
  esac
done

echo "${lane}: all upstream jobs are successful or intentionally skipped"
