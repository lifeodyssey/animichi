# frozen_string_literal: true

# ── Green: fully compliant PR+push+merge_group workflow (the quality-lane
# shape: contents: read, template concurrency, every job timed) ─────────────
green_fixture("compliant pipeline") do |dir|
  File.write(File.join(dir, "pipeline-web.yml"), <<~YAML)
    name: pipeline-web
    on:
      pull_request:
      merge_group:
        branches: [main]
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.head_ref || github.ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    jobs:
      lint:
        name: Web / lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      test:
        name: Web / test
        runs-on: ubuntu-latest
        timeout-minutes: 12
        steps:
          - run: echo ok
      build:
        name: Web / build
        runs-on: ubuntu-latest
        timeout-minutes: 15
        steps:
          - run: echo ok
  YAML
  # A workflow_call-only reusable with contents: read needs no concurrency.
  File.write(File.join(dir, "reusable-gate.yml"), <<~YAML)
    name: reusable-gate
    on:
      workflow_call: {}
    permissions:
      contents: read
    jobs:
      run:
        runs-on: ubuntu-latest
        timeout-minutes: 10
        steps:
          - run: echo ok
  YAML
  # A PR-triggered workflow may cancel with a literal true when it never pushes.
  File.write(File.join(dir, "pr-only.yml"), <<~YAML)
    name: pr-only
    on:
      pull_request:
    permissions:
      contents: read
    concurrency:
      group: pr-only-${{ github.head_ref }}
      cancel-in-progress: true
    jobs:
      test:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red 1 (timeout): job with runs-on but no timeout-minutes ────────────────
red_fixture("job without timeout", ["ci.yml:lint:missing timeout-minutes"]) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      pull_request:
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref }}
      cancel-in-progress: true
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        steps:
          - run: echo ok
  YAML
end

# ── Red 2a (permissions): no top-level permissions block ────────────────────
# The fixture is otherwise fully compliant (concurrency, merge_group, required
# contexts produced) so the permissions check is proven to fail in isolation.
red_fixture("workflow without permissions", ["ci.yml:top-level:missing permissions"]) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      pull_request:
      merge_group:
        branches: [main]
    concurrency:
      group: ci-${{ github.head_ref }}
      cancel-in-progress: true
    jobs:
      backend-ci-gate:
        name: Backend CI
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      agent-ci-gate:
        name: Agent CI
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      infra-db-ci-gate:
        name: Infra & DB CI
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      cross-stack-e2e-gate:
        name: Cross-stack E2E
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      repository-quality-gate:
        name: Repository Quality
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      codecov-patch-gate:
        name: Codecov Patch
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red 2b (permissions): top-level block wider than contents: read ─────────
red_fixture(
  "wider top-level permissions",
  ["ci.yml:top-level:permissions must be contents: read (got: contents: read, id-token: write)"]
) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      pull_request:
    permissions:
      contents: read
      id-token: write
    concurrency:
      group: ci-${{ github.head_ref }}
      cancel-in-progress: true
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
  YAML
end
# frozen_string_literal: true
