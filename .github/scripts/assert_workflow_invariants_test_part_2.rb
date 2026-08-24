# frozen_string_literal: true

# ── Red 3a (concurrency): PR-triggered workflow without concurrency ─────────
red_fixture("pr-triggered without concurrency", ["ci.yml:top-level:missing concurrency (pull_request-triggered)"]) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      pull_request:
    permissions:
      contents: read
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
  YAML
end

# ── Red 3b (concurrency): PR-triggered with cancel-in-progress: false ───────
red_fixture(
  "pr-triggered with cancel false",
  ["ci.yml:top-level:concurrency must cancel pull_request runs (cancel-in-progress: false)"]
) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      pull_request:
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref }}
      cancel-in-progress: false
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
  YAML
end

# ── Red 3c (concurrency): push-triggered workflow cancelling unconditionally ─
red_fixture(
  "push-triggered with cancel true",
  ["ci.yml:top-level:concurrency must not cancel push runs (would kill a deploy mid-flight)"]
) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ci-main
      cancel-in-progress: true
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
  YAML
end

# ── Red 4 (merge_group): required-context producer without merge_group ──────
red_fixture(
  "pipeline workflow without merge_group",
  ["pipeline-edge.yml:top-level:missing merge_group trigger (pipeline fixed point)"]
) do |dir|
  File.write(File.join(dir, "pipeline-edge.yml"), <<~YAML)
    name: pipeline-edge
    on:
      pull_request:
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.head_ref || github.ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    jobs:
      lint:
        name: Edge / lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      test:
        name: Edge / test
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
      build:
        name: Edge / build
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red 4b (merge_group): ruleset map drift — context no longer produced ────
red_fixture(
  "required context without producing job",
  ["pr-verification.yml:top-level:required context not produced by any job (CI / verify)"]
) do |dir|
  File.write(File.join(dir, "pr-verification.yml"), <<~YAML)
    name: pr-verification
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
      verify:
        name: PR Verifications
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# Review Gate is queue-safe only through the trusted completed-CI bridge; a
# candidate-side merge_group trigger is not an acceptable substitute.
red_fixture(
  "review status producer without trusted workflow_run bridge",
  ["review-gate.yml:top-level:missing queue-safe producer (required contexts: Review Gate)"]
) do |dir|
  path = File.join(dir, "review-gate.yml")
  source = File.read(path).sub(/  workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n/, "  merge_group:\n    branches: [main]\n")
  File.write(path, source)
end
# frozen_string_literal: true
