#!/usr/bin/env bash
set -euo pipefail

script="$(dirname "$0")/assert-ci-needs.sh"

"$script" smoke "success skipped"
if "$script" smoke "skipped success"; then
  echo "changes=skipped must fail" >&2
  exit 1
fi
if "$script" smoke "failure skipped"; then
  echo "changes=failure must fail" >&2
  exit 1
fi
