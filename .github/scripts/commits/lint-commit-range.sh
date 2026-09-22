#!/usr/bin/env bash
# The commit-range half of the `commits` job: the branch's own commits, from the
# merge base with `origin/main` to the tip. Deliberately a second program beside
# lint-pr-title.sh, not a folded-in case: the range guards the branch's history,
# the title guards what a squash merge writes onto `main` — two inputs read for
# two reasons, and collapsing them loses one (#1858).
#
# The workspace's own commitlint and commitlint.config.js resolve from the step's
# working directory, the repository root; the range is read from the checkout the
# job fetched with full history.
set -euo pipefail

pnpm exec commitlint --from "$(git merge-base origin/main HEAD)" --to HEAD
