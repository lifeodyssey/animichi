# SUT: pr-verification.yml's reporting of the live Neon Auth login proof (#1690).
#
# The proof cannot run in this workflow, and the point of #1690 is that this must
# be *said*: the spec used to skip itself and the summary called the run green.
# Two facts have to hold at once — PR CI never claims to have run the proof, and
# the browser lane reports the gap by name with the command that does run it.
# (The absence of any credential read here is already pinned, file-wide, by
# `.github/test/workflow-credentials.test.rb`.)
require "minitest/autorun"
require "psych"

class PrVerificationLoginTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  JOB = "e2e"
  LIVE_LANE_SCRIPT = "test:login"
  NOT_RUN_MARKER = "Live login proof: NOT RUN in PR CI"
  LOCAL_RECIPE = "pnpm --filter animichi-e2e run test:login"
  DEAD_END = "exit 1"

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
    @steps = @ci.dig("jobs", JOB, "steps").to_a
  end

  def test_pr_ci_never_runs_the_live_login_lane
    @steps.each do |step|
      next if step.equal?(report_step)

      refute(step["run"].to_s.include?(LIVE_LANE_SCRIPT),
             "pr-verification.yml:#{JOB}: a step runs the live login lane. It cannot pass here — " \
             "this workflow holds no credentials — and a lane that cannot run must not be " \
             "selected and called green (#1690). Select it from a lane that has the QA identity.")
    end
  end

  def test_the_browser_lane_reports_the_proof_as_not_run
    step = report_step
    refute_nil(step, "pr-verification.yml:#{JOB}: no step reports the live login proof as not-run — " \
                     "silence is the defect #1690 removed, and it reads exactly like coverage")
    assert_includes(step["run"], NOT_RUN_MARKER,
                    "pr-verification.yml:#{JOB}: the notice must say NOT RUN, not imply the proof passed")
    assert_includes(step["run"], LOCAL_RECIPE,
                    "pr-verification.yml:#{JOB}: the notice must name the command that does run the proof")
    assert_includes(step["run"], "GITHUB_STEP_SUMMARY",
                    "pr-verification.yml:#{JOB}: the notice must reach the run summary, where a reader " \
                    "deciding whether the login chain is covered will look")
    assert_includes(step["run"], "::warning",
                    "pr-verification.yml:#{JOB}: the notice must surface as an annotation on the run, " \
                    "not only in a log nobody opens")
  end

  # The report is a fact about the lane, not a verdict on it: turning it into a
  # failure would red every unrelated PR, and tolerating a failure would put a
  # green check on an unproven flow.
  def test_the_report_is_not_a_verdict
    step = report_step
    refute(step.key?("continue-on-error"),
           "pr-verification.yml:#{JOB}: repo policy forbids continue-on-error, and this step has " \
           "nothing that can fail")
    refute_includes(step["run"], DEAD_END,
                    "pr-verification.yml:#{JOB}: the notice must not fail the lane — the lane's " \
                    "verdict belongs to the hermetic specs it does run")
  end

  private

  def report_step
    @report_step ||= @steps.find { |step| step["run"].to_s.include?(NOT_RUN_MARKER) }
  end
end
