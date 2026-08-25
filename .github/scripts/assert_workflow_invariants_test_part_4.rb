# frozen_string_literal: true

# ── Green (F2/196J): pull_request_target-only workflow cancels in its own
# event world (event_name == 'pull_request_target') ───────────────────────────
green_fixture("pull_request_target compliant") do |dir|
  File.write(File.join(dir, "pr-target.yml"), <<~YAML)
    name: pr-target
    on:
      pull_request_target:
    permissions:
      contents: read
    concurrency:
      group: pr-target-${{ github.head_ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request_target' }}
    jobs:
      test:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (196J): pull_request_target workflow without concurrency must be
# caught exactly like a pull_request one ──────────────────────────────────────
red_fixture(
  "pull_request_target without concurrency",
  ["pr-target.yml:top-level:missing concurrency (pull_request_target-triggered)"]
) do |dir|
  File.write(File.join(dir, "pr-target.yml"), <<~YAML)
    name: pr-target
    on:
      pull_request_target:
    permissions:
      contents: read
    jobs:
      test:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (196J): a cancel expression scoped to pull_request does NOT satisfy a
# pull_request_target workflow — judged in the target's own world ─────────────
red_fixture(
  "pull_request_target with pr-only cancel",
  ["pr-target.yml:top-level:concurrency must cancel pull_request_target runs (cancel-in-progress: \"${{ github.event_name == 'pull_request' }}\")"]
) do |dir|
  File.write(File.join(dir, "pr-target.yml"), <<~YAML)
    name: pr-target
    on:
      pull_request_target:
    permissions:
      contents: read
    concurrency:
      group: pr-target-${{ github.head_ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    jobs:
      test:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (196J): a workflow firing on both PR-class events must cancel in both
# worlds — one event's expression does not cover the other ────────────────────
red_fixture(
  "dual PR-class events with single-event cancel",
  ["pr-push.yml:top-level:concurrency must cancel pull_request_target runs"]
) do |dir|
  File.write(File.join(dir, "pr-push.yml"), <<~YAML)
    name: pr-push
    on: [pull_request, pull_request_target]
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    jobs:
      test:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (196E): a REQUIRED_CONTEXTS owner workflow absent from the scanned
# dir must be reported (contexts silently ignored otherwise). No seed_owners
# here on purpose — this fixture IS the missing-owner case. ───────────────────
Dir.mktmpdir("b7-red-missing-owner") do |dir|
  File.write(File.join(dir, "pipeline-web.yml"), <<~YAML)
    name: pipeline-web
    on:
      pull_request:
      push:
        branches: [main]
      merge_group:
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
  rc, out = run_assert(dir)
  abort "FAIL: missing-owner fixture must fail, got exit #{rc}:\n#{out}" if rc.zero?
  expected = "pr-verification.yml:top-level:missing required-context owner workflow"
  abort "FAIL: missing-owner expected '#{expected}' in output:\n#{out}" unless out.include?(expected)
end
puts "PASS: missing required-context owner fails with expected violation line"
# frozen_string_literal: true
