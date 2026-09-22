#!/usr/bin/env bash
# The PR-title half of the `commits` job (#1858): the subject a squash merge will
# write onto `main`, read as it is when the job runs — not as it was when the
# run's event fired. A rerun replays the payload that started the run, so a title
# read from `github.event.pull_request.title` reports the length the title had
# before the author's fix, in text byte-identical to the first failure (observed
# on #1857: `current length is 73` after the title was already 67) and only a
# close+reopen manufactured a fresh verdict. The API holds the only current copy;
# `gh` reads it with the job's own token, which carries `pull-requests: read` and
# nothing wider.
#
# Fails closed: the workflow's `if:` skips this script on events without a pull
# request (merge_group), so reaching it without a number means the wiring has
# drifted, and an unread title must stop the lane rather than pass by absence.
# The workspace's own commitlint and commitlint.config.js resolve from the step's
# working directory, the repository root.
set -euo pipefail

: "${PR_NUMBER:?pr-verification handed the title lint no pull_request number: the title cannot be read}"
: "${PR_REPO:?pr-verification handed the title lint no repository slug: the title cannot be read}"

title="$(gh api "repos/$PR_REPO/pulls/$PR_NUMBER" --jq .title)"
printf '%s\n' "$title" | pnpm exec commitlint
