# Summary

<!-- What does this PR do? Link the issue/card it implements (e.g. Closes #123). -->

## Acceptance Criteria

<!--
Quality Ratchet: every AC must have a test type annotation AND a test present in this PR's diff.
Reviewer verifies ac_total == ac_with_test.
Test type: unit | integration | eval | browser | api
-->

| # | Acceptance criterion | Test type | Test file (in this diff) |
|---|---------------------|-----------|--------------------------|
| 1 |                     |           |                          |

## Quality Gates

- [ ] `make check` passes (lint + typecheck + test)
- [ ] Every AC row above has a test type and a test file present in this PR's diff
- [ ] Coverage thresholds were NOT lowered (`apps/web/vitest.config.ts`, backend `pytest.ini`) — thresholds may only be ratcheted UP; if this PR raises coverage, floors are updated to the new value
- [ ] No suppressions added (`@ts-ignore`, `type: ignore`, `noqa`, `pragma: no cover`, `continue-on-error`, `skip`, oxlint inline config) — if a rule fired, the code was fixed instead
- [ ] No hardcoded secrets; design tokens used (no raw Tailwind palette colors)

## Notes for Reviewer

<!-- Anything non-obvious: trade-offs, follow-ups, out-of-scope items. -->
