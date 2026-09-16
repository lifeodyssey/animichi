# SUT: the e2e suite's no-skip rule (#1690) — a spec that cannot run must fail
# its lane or be reported as not-run, never counted as a pass.
#
# This is the static half of the rule: the runtime half is
# `e2e/reporters/no-skipped-tests.ts`, which fails a run that reports a skip.
# Both halves exist because the two failure modes differ — the reporter catches
# a skip on the day it runs, this catches one the moment it is committed, in the
# contracts lane, without a browser.
require "minitest/autorun"
require "json"

class E2eNoSkipTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # Exempt, by directory, for a stated reason each:
  #   visual/           the opt-in pixel suite (`make visual-check`), which
  #                     reports per-frame pass/fail/skipped in its own JSON
  #                     summary (docs/testing-strategy.md) — its skips are
  #                     reported as not-run by its runner, not hidden in a green
  #                     case. `e2e/reporters/no-skipped-tests.ts` exempts the
  #                     same project name.
  #   generated/        agent working dirs, excluded from collection entirely
  #   agent-discovered/ (both are dead code if committed — see
  #                     .github/scripts/check-e2e-promotion.sh)
  EXEMPT_SPEC_DIRS = ["e2e/visual/", "e2e/generated/", "e2e/agent-discovered/"].freeze
  # `test.skip(…)`, `test.fixme(…)`, `test.describe.skip/fixme(…)` and the bare
  # `describe.skip/fixme(…)`. The lookbehind keeps `await test.skipNext()`-style
  # identifiers out; the alternatives are spelled out because a `.` before
  # `describe` is a name, not a call.
  SKIP_CONSTRUCT = /(?<![\w$])(?:test\.(?:skip|fixme)\s*\(|test\.describe\.(?:skip|fixme)\s*\(|describe\.(?:skip|fixme)\s*\()/
  PLAYWRIGHT_CONFIG = "e2e/playwright.config.ts"
  NO_SKIP_REPORTER = "e2e/reporters/no-skipped-tests.ts"
  PACKAGE_JSON = "e2e/package.json"
  LIVE_LOGIN_SPEC = "web-neon-login.spec.ts"
  LIVE_LOGIN_SCRIPT = "E2E_SERVE_EMITTED_WORKER=1 playwright test #{LIVE_LOGIN_SPEC}"

  def test_no_always_run_spec_self_skips
    offenders = always_run_specs.select { |path| code_lines_of(path).any? { |line| line.match?(SKIP_CONSTRUCT) } }
    assert_empty(offenders,
                 "these specs can skip themselves, so an unrun proof can be summarised as a pass. " \
                 "Make the case run, or make it fail and name what it needs (#1690):\n  " \
                 "#{offenders.join("\n  ")}")
  end

  # The runtime guard is a registered reporter, not a convention: without this
  # line a skipped test exits 0 and the lane calls it green.
  def test_the_run_fails_when_a_test_skips
    config = read(PLAYWRIGHT_CONFIG)
    assert_includes(config, "reporters/no-skipped-tests.ts",
                    "#{PLAYWRIGHT_CONFIG}: the no-skipped-tests reporter must stay registered — " \
                    "Playwright's own exit code counts a skip as success (#1690)")
    watcher = read(NO_SKIP_REPORTER)
    assert_includes(watcher, 'new Set(["visual", "seed"])',
                    "#{NO_SKIP_REPORTER}: the exemption list must stay the opt-in visual project and " \
                    "the MCP seed scaffold; widening it is how a real skip goes green again")
  end

  # The live login proof keeps its own lane, and that lane is the one the CI job
  # runs (`.github/test/pr-verification-login.test.rb` pins the job side). It
  # serves the emitted Worker so the app under test points at a real branch.
  def test_the_live_login_proof_has_its_own_lane
    scripts = JSON.parse(read(PACKAGE_JSON)).fetch("scripts")
    assert_equal(LIVE_LOGIN_SCRIPT, scripts["test:login"],
                 "#{PACKAGE_JSON}: test:login must select #{LIVE_LOGIN_SPEC} against the emitted Worker")
    refute_includes(scripts.fetch("test"), LIVE_LOGIN_SPEC,
                    "#{PACKAGE_JSON}: the hermetic CI lane must not carry the live proof — it is its " \
                    "own job because its inputs (and its failure modes) are different")
  end

  private

  def always_run_specs
    Dir.glob(File.join(ROOT, "e2e", "**", "*.spec.ts"))
       .map { |path| path.delete_prefix("#{ROOT}/") }
       .reject { |path| EXEMPT_SPEC_DIRS.any? { |dir| path.start_with?(dir) } }
  end

  # Comment lines are dropped rather than stripped inline: a `//` inside a
  # string literal ("http://…") would truncate a real call if this scanner
  # rewrote lines, and a *whole* comment line can never be the call.
  def code_lines_of(relative_path)
    read(relative_path).lines.reject { |line| line.lstrip.start_with?("//", "*", "/*") }
  end

  def read(relative_path)
    File.read(File.join(ROOT, relative_path))
  end
end
