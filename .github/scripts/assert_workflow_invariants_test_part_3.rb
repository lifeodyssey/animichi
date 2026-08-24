# frozen_string_literal: true

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
# frozen_string_literal: true
