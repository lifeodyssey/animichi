# package-ci (composite action)

Shared lint/test/build steps for the per-package `pipeline-*.yml` lanes.

## Usage

The caller must `actions/checkout` first — checkout lives in the caller, not
here. The action then runs `./.github/actions/setup` and executes each
non-empty command input from `working-directory`.

```yaml
jobs:
  lint:
    name: Contract / lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@... # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/package-ci
        with:
          working-directory: packages/contract
          lint-command: pnpm exec tsc --noEmit
          test-command: pnpm run test
          build-command: |
            pnpm emit:openapi
            git add -A packages/contract/openapi.json packages/contract/users-openapi.json
            git diff --cached --exit-code -- packages/contract/openapi.json packages/contract/users-openapi.json
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `working-directory` | `.` | Directory commands run in (repo-root relative) |
| `lint-command` | `""` | Lint step; skipped when empty |
| `test-command` | `""` | Test step; skipped when empty |
| `build-command` | `""` | Build step; skipped when empty |
| `python` | `"false"` | Pass-through to `.github/actions/setup` (uv) |

## TODO: remaining lanes to migrate

Migrated: `pipeline-contract`.

Still to migrate (keep job names identical — they are required-check contexts):
`pipeline-agent`, `pipeline-catalog`, `pipeline-db`, `pipeline-edge`,
`pipeline-infra`, `pipeline-maintenance`, `pipeline-quality`, `pipeline-users`,
`pipeline-web`.

Note for migrating lanes with extra per-job steps (coverage upload in
`pipeline-users`/`pipeline-maintenance` test jobs, python-heavy lanes): either
fold them into the command inputs (multiline) or keep them as follow-up steps
in the caller job after the composite call.
