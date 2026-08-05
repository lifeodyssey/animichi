#!/usr/bin/env bash
# E2E promotion guard: the committed tree must never contain *.spec.ts under
# e2e/generated/ or e2e/agent-discovered/. Those directories are working dirs
# in the three-stage E2E promotion gate (planner -> agent-discovered -> generator
# -> generated -> git mv into e2e/ root); a spec committed there means someone
# bypassed promotion review and it would silently run against nothing (the
# playwright.config.ts testIgnore excludes them, so a committed spec there is
# dead code hiding from review).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ROOT="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ROOT}")"
cd "${ROOT}"

VIOLATIONS="$(git ls-files 'e2e/generated/**' 'e2e/agent-discovered/**' 'e2e/generated/*' 'e2e/agent-discovered/*' | grep '\.spec\.ts$' || true)"

if [ -n "${VIOLATIONS}" ]; then
  echo "E2E promotion violation: *.spec.ts committed in a staging directory"
  echo "${VIOLATIONS}" | sed 's/^/  /'
  echo "Promotion = git mv <file> into e2e/ root after the four promotion"
  echo "checks (2 consecutive green runs, mutation check, human locator read,"
  echo "no timing-based asserts). See e2e/generated/README.md."
  exit 1
fi

echo "e2e promotion guard: no *.spec.ts in generated/ or agent-discovered/ (committed tree)"
