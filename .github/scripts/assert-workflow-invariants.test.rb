#!/usr/bin/env ruby
# frozen_string_literal: true

# Behavioral tests for assert-workflow-invariants.rb, driven against throwaway
# fixture dirs (the script takes the workflows dir as its first argument, so
# fixtures need no git plumbing). Mirrors the pass-case plus one-failing-
# fixture-per-check structure of the retired assert-workflow-invariants.test.sh,
# extended for the S0-v2 B7 rules: permissions must be exactly contents: read,
# concurrency must cancel PR runs / never cancel push runs, and merge_group
# must cover every workflow producing a required context. Also regression-
# covers the F1/F2 review round (PR #815): all three `on:` shorthand forms are
# legal triggers, and cancel-in-progress is judged semantically (fail-closed
# on anything the evaluator cannot prove safe).

require "open3"
require "tmpdir"

SCRIPT = File.join(__dir__, "assert-workflow-invariants.rb")

def run_assert(dir)
  out, err, status = Open3.capture3(RbConfig.ruby, SCRIPT, dir)
  [status.exitstatus, out + err]
end

def green_fixture(name)
  Dir.mktmpdir("b7-green-#{name}") do |dir|
    yield dir
    rc, out = run_assert(dir)
    abort "FAIL: #{name} fixture must pass, got exit #{rc}:\n#{out}" unless rc.zero?
    abort "FAIL: #{name} missing one-line summary:\n#{out}" unless out.include?("all invariants hold")
  end
  puts "PASS: #{name}"
end

def red_fixture(name, expected_lines)
  Dir.mktmpdir("b7-red-#{name}") do |dir|
    yield dir
    rc, out = run_assert(dir)
    abort "FAIL: #{name} fixture must fail, got exit #{rc}:\n#{out}" if rc.zero?
    expected_lines.each do |line|
      abort "FAIL: #{name} expected #{line.inspect} in output:\n#{out}" unless out.include?(line)
    end
  end
  puts "PASS: #{name} fails with #{expected_lines.size} expected violation line(s)"
end

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
red_fixture("workflow without permissions", ["ci.yml:top-level:missing permissions"]) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
    on:
      pull_request:
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
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
  "required context without merge_group",
  [
    "ci.yml:top-level:missing merge_group trigger (required contexts: Backend CI, Agent CI, Infra & DB CI, Cross-stack E2E, Repository Quality, Codecov Patch)"
  ]
) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
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

# ── Red 4b (merge_group): ruleset map drift — context no longer produced ────
red_fixture(
  "required context without producing job",
  ["ci.yml:top-level:required context not produced by any job (Backend CI)"]
) do |dir|
  File.write(File.join(dir, "ci.yml"), <<~YAML)
    name: ci
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
      renamed-gate:
        name: Renamed CI
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Green (F1): `on: pull_request` scalar shorthand must parse as triggers ──
green_fixture("on scalar shorthand") do |dir|
  File.write(File.join(dir, "pr-only.yml"), <<~YAML)
    name: pr-only
    on: pull_request
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

# ── Green (F1): `on: [push, pull_request]` array shorthand — PR cancels but
# push-to-main never does, so the array form must exercise both rules ────────
green_fixture("on array shorthand") do |dir|
  File.write(File.join(dir, "pr-push.yml"), <<~YAML)
    name: pr-push
    on: [push, pull_request]
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.workflow }}-${{ github.head_ref || github.ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (F1): genuinely absent `on:` must still be caught after the
# scalar/array forms became legal ────────────────────────────────────────────
red_fixture("workflow without on", ["no-triggers.yml:top-level:missing on: triggers (unparseable or absent)"]) do |dir|
  File.write(File.join(dir, "no-triggers.yml"), <<~YAML)
    name: no-triggers
    permissions:
      contents: read
    jobs:
      lint:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (F2): expression that passes the old substring heuristic but really
# cancels push runs and does NOT cancel PR runs (`!= pull_request` inverts the
# template). Semantic judgment must flag both sides. ─────────────────────────
red_fixture(
  "concurrency cancels push not PR",
  [
    "pr-push.yml:top-level:concurrency must cancel pull_request runs",
    "pr-push.yml:top-level:concurrency must not cancel push runs"
  ]
) do |dir|
  File.write(File.join(dir, "pr-push.yml"), <<~YAML)
    name: pr-push
    on:
      pull_request:
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref || github.ref }}
      cancel-in-progress: ${{ github.event_name != 'pull_request' }}
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Green (F2): ref-scoped cancel (`ref != refs/heads/main`) cancels PR runs
# (a PR ref is never refs/heads/main) but never cancels push-to-main ─────────
green_fixture("ref-scoped cancel") do |dir|
  File.write(File.join(dir, "pr-push.yml"), <<~YAML)
    name: pr-push
    on:
      pull_request:
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref || github.ref }}
      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Green (F2): negated push check — `!(event_name == 'push')` cancels PR
# runs and leaves push-to-main alone ─────────────────────────────────────────
green_fixture("negated cancel expression") do |dir|
  File.write(File.join(dir, "pr-push.yml"), <<~YAML)
    name: pr-push
    on:
      pull_request:
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref || github.ref }}
      cancel-in-progress: ${{ !(github.event_name == 'push') }}
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

# ── Red (F2): unjudgeable expression fails closed on both sides instead of
# defaulting to pass (a wrong guess on a blocking gate locks the repo) ───────
red_fixture(
  "unjudgeable cancel expression",
  [
    "pr-push.yml:top-level:cannot judge cancel-in-progress for pull_request runs, confirm manually",
    "pr-push.yml:top-level:cannot judge cancel-in-progress for push runs, confirm manually"
  ]
) do |dir|
  File.write(File.join(dir, "pr-push.yml"), <<~YAML)
    name: pr-push
    on:
      pull_request:
      push:
        branches: [main]
    permissions:
      contents: read
    concurrency:
      group: ci-${{ github.head_ref || github.ref }}
      cancel-in-progress: ${{ github.head_ref != 'main' }}
    jobs:
      lint:
        name: lint
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: echo ok
  YAML
end

puts "All assert-workflow-invariants.rb behavioral tests passed."
