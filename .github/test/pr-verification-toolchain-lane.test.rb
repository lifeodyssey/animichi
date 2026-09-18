# SUT: the delivery-toolchain lane (#1776) — `pr-verification.yml`'s `delivery`
# routing table, the lane job that consumes it, and every other job's freedom
# from the toolchain's tests.
#
# The toolchain's tests are ordinary unit and integration tests of `.github/lib`,
# `.github/scripts`, `scripts/delivery` and `scripts/local-gates`: real scripts
# against fixture trees, asserting real exit codes. They are selected by their
# sources' paths like every other package's, so a change outside those roots
# never pays for them. Which tests they are is the runner's business, not this
# file's: the lane invokes `.github/scripts/delivery-toolchain-tests.sh`, the
# runner enumerates the four homes, and this file holds the runner to them — so a
# test joins the lane by landing in a home rather than by someone editing a list.
#
# The last case is the one that keeps the move from unravelling. A toolchain test
# drifting back into `contracts` or `docs` — the two jobs that still run on every
# diff — puts the whole cost back on every pull request while the rest of CI stays
# green, and nothing else in the suite would say so.
require "minitest/autorun"
require "open3"
require "psych"

class PrVerificationToolchainLaneTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOW = File.join(ROOT, ".github/workflows/pr-verification.yml")
  LANE = "delivery-toolchain"
  RUNNER = ".github/scripts/delivery-toolchain-tests.sh"
  # The tests' four homes, each beside the sources it exercises: the moved Ruby
  # suites with their fixtures and support, the local gates, the delivery scripts
  # and the release tooling's shell tests.
  DELIVERY_TEST_GLOBS = [
    ".github/test/delivery/*.test.rb",
    "scripts/local-gates/*.test.sh",
    "scripts/delivery/*.test.sh",
    ".github/scripts/**/*.test.sh"
  ].freeze
  # The lane's routing table: the toolchain's four roots plus the tests' own
  # directory. `.github/**` also feeds the `workflows` filter's force-add of the
  # edge-worker lane, which this table leaves untouched.
  DELIVERY_FILTER = [
    ".github/lib/**",
    ".github/scripts/**",
    ".github/test/delivery/**",
    "scripts/delivery/**",
    "scripts/local-gates/**"
  ].freeze
  INVOCATION = /\A(?:bundle\s+exec\s+)?(?:bash|ruby|node|sh|python3?)\s+(?<path>\S+)/

  def ci
    @ci ||= Psych.safe_load(File.read(WORKFLOW), aliases: true)
  end

  def paths_filters
    step = ci.dig("jobs", "plan", "steps").find { |candidate| candidate["id"] == "paths" }
    Psych.safe_load(step.dig("with", "filters"), aliases: true)
  end

  def invoked(job)
    ci.dig("jobs", job, "steps").to_a.flat_map { |step| step["run"].to_s.lines }.map(&:strip)
      .map { |line| line[INVOCATION, :path] }.compact
  end

  def in_delivery_homes?(path)
    delivery_homes.include?(path)
  end

  # The committed tests in the four homes, globbed rather than matched: what the
  # lane may run is exactly what is there, so a stray is judged against the tree
  # and not against a pattern's edge cases.
  def delivery_homes
    @delivery_homes ||= DELIVERY_TEST_GLOBS.flat_map { |glob| Dir.glob(File.join(ROOT, glob)) }
                                          .select { |path| File.file?(path) }
                                          .map { |path| path.delete_prefix("#{ROOT}/") }
  end

  # What the runner will run, read from the runner itself, and read only once the
  # lane is the thing that invokes it: an uninvoked runner lists tests nothing
  # runs, which is the failure this whole case exists to prevent.
  def runner_selected
    return [] unless invoked(LANE).include?(RUNNER)
    listed, error, status = Open3.capture3("bash", File.join(ROOT, RUNNER), "--list", chdir: ROOT)
    assert status.success?, "the toolchain runner failed to list its suite: #{error}"
    listed.scan(/\S+/)
  end

  def test_plan_routes_the_delivery_toolchain_by_path
    assert_equal DELIVERY_FILTER.sort, Array(paths_filters["delivery"]).sort,
                 "pr-verification.yml: the delivery filter is the toolchain lane's selection; a root " \
                 "leaving it stops the toolchain's tests running while the rest of CI stays green"
  end

  def test_the_delivery_toolchain_lane_consumes_that_route
    job = ci.dig("jobs", LANE)
    assert job, "pr-verification.yml: no #{LANE} job"
    assert Array(job["needs"]).include?("plan"), "#{LANE} must be routed by plan"
    assert job["if"].to_s.include?("needs.plan.outputs.delivery == 'true'"),
           "#{LANE} must run when the delivery paths changed"
    assert job["if"].to_s.include?("needs.plan.outputs.deps == 'true'"),
           "#{LANE} must also run on a root dependency change: its tests install and drive the workspace"
    assert invoked(LANE).include?(RUNNER),
           "#{LANE} must run the toolchain suite through #{RUNNER}"
  end

  def test_the_runner_enumerates_only_the_delivery_homes
    refute_empty runner_selected, "the toolchain runner lists no tests"
    runner_selected.each do |path|
      assert in_delivery_homes?(path),
             "#{RUNNER}: #{path} is outside the delivery homes, so the lane would run a test " \
             "whose subject the delivery filter does not select"
    end
  end

  # `contracts` and `docs` run on every diff — neither has an `if:`. What is left
  # in them asserts the repository's own text (groups A and C) or proves a guard
  # fires (group D); a test of the toolchain in either is the cost #1776 moved
  # out. And no job but the lane may invoke the runner, or the suite would run
  # twice, one of them unconditionally.
  def test_only_the_lane_invokes_the_delivery_toolchain_suite
    strays = ci.fetch("jobs").keys.reject { |id| id == LANE }.sort.flat_map do |id|
      invoked(id).select { |path| in_delivery_homes?(path) || path == RUNNER }.map { |path| "#{id}: #{path}" }
    end
    assert_empty strays,
                 "pr-verification.yml: the delivery toolchain's tests are lane-selected (#1776); a job " \
                 "other than #{LANE} invokes them, so they would run on diffs that did not touch the " \
                 "toolchain: #{strays.join(', ')}"
  end
end
