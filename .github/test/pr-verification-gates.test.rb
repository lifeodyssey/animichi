# SUT: pr-verification.yml aggregates and commits job preserve required checks and squash/branch linting.
require "minitest/autorun"
require "psych"

class PrVerificationAggregatesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  SECURITY_JOBS = %w[gitleaks trufflehog osv semgrep zizmor].freeze
  LANE_JOBS = %w[plan affected contracts delivery-toolchain docs e2e db foundation-install commits security].freeze
  AGGREGATE_GUARD = "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')"

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def test_security_aggregate
    assert_aggregate("security", SECURITY_JOBS)
  end

  def test_verification_aggregate
    assert_aggregate("aggregate", LANE_JOBS)
  end

  def assert_aggregate(job, expected_needs)
    assert(@ci.dig("jobs", job, "if").to_s.include?("always()"),
                     "pr-verification.yml:#{job}: must run always()")
    assert(Array(@ci.dig("jobs", job, "needs")).sort == expected_needs.sort,
                     "pr-verification.yml:#{job}: needs must be #{expected_needs.sort.join(', ')}")
    assert(@ci.dig("jobs", job, "steps").to_a.map { |step| step["if"].to_s }.join(" ").include?(AGGREGATE_GUARD),
                     "pr-verification.yml:#{job}: must fail on a failed or cancelled dependency")
  end
end

class PrVerificationCommitsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RANGE_LINT = ".github/scripts/commits/lint-commit-range.sh"
  TITLE_LINT = ".github/scripts/commits/lint-pr-title.sh"
  RANGE_COMMAND = 'pnpm exec commitlint --from "$(git merge-base origin/main HEAD)" --to HEAD'
  PAYLOAD_TITLE = "github.event.pull_request.title"

  def setup
    @ci = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/pr-verification.yml")), aliases: true)
  end

  def lint_steps
    @ci.dig("jobs", "commits", "steps").to_a.select { |step| step["run"].to_s.include?("commits/") }
  end

  def step_running(script)
    lint_steps.find { |step| step["run"].to_s.include?(script) }
  end

  def commits_job_text
    Psych.dump(@ci.dig("jobs", "commits"))
  end

  def test_the_branch_range_lint_is_its_own_program_over_the_merge_base
    step = step_running(RANGE_LINT)
    assert step, "pr-verification.yml:commits: the branch's own commits must be linted by #{RANGE_LINT}"
    assert_includes File.read(File.join(ROOT, RANGE_LINT)), RANGE_COMMAND,
                    "#{RANGE_LINT}: the merge-base range command is the check the repository agreed on; " \
                    "changing it is a decision, not a refactor"
  end

  def test_the_title_lint_is_its_own_program_reading_the_live_title
    step = step_running(TITLE_LINT)
    assert step, "pr-verification.yml:commits: the squash subject must be linted by #{TITLE_LINT}"
    assert_equal "${{ github.event.pull_request.number }}", step.dig("env", "PR_NUMBER"),
                 "pr-verification.yml:commits: the title step must hand the script the pull_request number, " \
                 "so the script reads the title as it is when the job runs"
    refute commits_job_text.include?(PAYLOAD_TITLE),
           "pr-verification.yml:commits: #{PAYLOAD_TITLE} is the event's copy of the title — a rerun replays " \
           "it, so a fixed title was reported at its old length in identical text (#1857); the live read is the fix"
  end

  def test_the_title_step_skips_only_events_without_a_pull_request
    step = step_running(TITLE_LINT)
    assert step, "pr-verification.yml:commits: the squash subject must be linted by #{TITLE_LINT}"
    assert_includes step["if"].to_s, "env.PR_NUMBER",
                    "pr-verification.yml:commits: on merge_group there is no pull request to read a title of; " \
                    "the skip must key on the missing number"
  end

  def test_the_title_lint_may_read_the_pull_request_and_nothing_wider
    assert step_running(TITLE_LINT),
           "pr-verification.yml:commits: the squash subject must be linted by #{TITLE_LINT}"
    permissions = @ci.dig("jobs", "commits", "permissions") || {}
    assert_equal "read", permissions["pull-requests"],
                 "pr-verification.yml:commits: #{TITLE_LINT} reads the live title through the API, which " \
                 "needs pull-requests: read — the workflow-level contents-only cap would refuse it"
    assert_equal "read", permissions["contents"],
                 "pr-verification.yml:commits: the checkout needs contents: read; nothing wider is justified"
  end

  def test_the_two_lints_remain_two_steps
    assert lint_steps.one? { |step| step["run"].to_s.include?(RANGE_LINT) } &&
           lint_steps.one? { |step| step["run"].to_s.include?(TITLE_LINT) } &&
           lint_steps.size == 2,
           "pr-verification.yml:commits: the range guards the branch's history and the title guards what a " \
           "squash merge writes onto main — two inputs for two reasons; each stays its own step and program"
  end

  def test_commits_gate_replaces_codeql
    assert(@ci.dig("jobs", "codeql").nil?,
                     "pr-verification.yml: the transitional codeql job must be gone (default setup owns CodeQL)")
    assert(Array(@ci.dig("jobs", "aggregate", "needs")).include?("commits"),
                     "pr-verification.yml:aggregate: the commits gate must be one of its needs")
  end

end
