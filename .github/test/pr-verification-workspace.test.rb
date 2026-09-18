# SUT: pr-verification.yml installs its workspace through setup-workspace after each caller's checkout.
require "minitest/autorun"
require "psych"

class PrVerificationWorkspaceTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  FILE = File.join(ROOT, ".github/workflows/pr-verification.yml")
  SETUP = "$/.github/actions/setup-workspace"

  # The jobs that install the workspace. `contracts` left the pair when the
  # delivery toolchain's tests moved to their own lane (#1776) and it stopped
  # running anything that drives the install; `delivery-toolchain` took its
  # place, and `workflow-workspace.test.rb` holds the derived half of the rule —
  # a step that needs the workspace must be preceded by the install — so a job
  # that starts using it without installing still fails there.
  %w[affected delivery-toolchain e2e db commits].each do |job|
    define_method("test_#{job}_installs_before_its_lane_runs") do
      steps = Psych.safe_load(File.read(FILE), aliases: true).dig("jobs", job, "steps")
      assert_match %r{\Aactions/checkout@}, steps.fetch(0).fetch("uses")
      assert_equal SETUP, steps.fetch(1).fetch("uses")
      assert_equal 1, steps.count { |step| step["uses"] == SETUP }
      refute steps.any? { |step| step["run"].to_s.include?("pnpm install") }
    end
  end

  def test_plan_does_not_cache_a_store_it_never_installs
    steps = Psych.safe_load(File.read(FILE), aliases: true).dig("jobs", "plan", "steps")
    node = steps.find { |step| step["uses"].to_s.start_with?("actions/setup-node@") }
    refute_equal "pnpm", node.dig("with", "cache")
    refute steps.any? { |step| step["uses"] == SETUP }
  end
end
