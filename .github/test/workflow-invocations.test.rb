# SUT: PR verification runs every repository check; workflows resolve their local scripts and actions.
require "minitest/autorun"
require "open3"
require "psych"

class WorkflowInvocationsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOWS = Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort
  PR_WORKFLOW = File.join(ROOT, ".github/workflows/pr-verification.yml")
  CHECKS = Dir.glob(File.join(ROOT, "{.github/test,test/repo-config}/**/*.test.rb")) +
           Dir.glob(File.join(ROOT, "{scripts,.github/scripts,infra}/**/*.test.sh"))
  # The delivery toolchain's suite (#1776) is enumerated by its own runner rather
  # than listed in a workflow: the lane invokes the runner, and the runner prints
  # the tests it will run. Reading that list here keeps this contract's subject
  # whole — a test the runner cannot see is a test nothing runs — while letting a
  # new one join by landing in a home instead of by someone remembering a line.
  TOOLCHAIN_RUNNER = ".github/scripts/delivery-toolchain-tests.sh"
  # `bundle exec ruby <file>` is the contracts job's form: the interpreter and gems the Gemfile pins.
  INVOCATION = /\A(?:bundle\s+exec\s+)?(?:bash|ruby|node|sh|python3?)\s+(?<path>\S+)/

  def workflow_steps(paths = WORKFLOWS)
    paths.flat_map do |path|
      Psych.safe_load(File.read(path), aliases: true).fetch("jobs").values.flat_map { |job| job.fetch("steps", []) }
    end.flat_map { |step| [step, *local_action_steps(step)] }
  end

  def local_action_steps(step, ancestors = [])
    ref = step["uses"].to_s
    return [] unless ref.start_with?("./", "$/")
    raise "recursive local action: #{ref}" if ancestors.include?(ref)
    manifest = %w[action.yml action.yaml].map { |name| File.join(ROOT, ref.delete_prefix("$/"), name) }.find { |path| File.file?(path) }
    steps = Psych.safe_load(File.read(manifest), aliases: true).dig("runs", "steps").to_a
    steps.flat_map { |child| [child, *local_action_steps(child, ancestors + [ref])] }
  end

  def invoked_scripts(paths = WORKFLOWS)
    workflow_steps(paths).flat_map { |step| step["run"].to_s.lines }.map(&:strip)
                  .map { |line| line[INVOCATION, :path] }.compact
                  .select { |path| path.start_with?(".github/", "scripts/", "test/", "infra/") }
  end

  # What the delivery-toolchain runner will run, and only once pr-verification.yml
  # invokes the runner: a runner nothing calls lists tests nothing runs, and
  # counting its list here would hide exactly that.
  def toolchain_suite
    @toolchain_suite ||= if invoked_scripts([PR_WORKFLOW]).include?(TOOLCHAIN_RUNNER)
                           listed, error, status = Open3.capture3("bash", File.join(ROOT, TOOLCHAIN_RUNNER),
                                                                  "--list", chdir: ROOT)
                           raise "#{TOOLCHAIN_RUNNER} failed to list its suite: #{error}" unless status.success?
                           listed.scan(/\S+/)
                         else
                           []
                         end
  end

  def test_every_committed_check_runs_in_pr_verification
    relative = CHECKS.map { |path| path.delete_prefix("#{ROOT}/") }
    assert_empty relative - invoked_scripts([PR_WORKFLOW]) - toolchain_suite, "committed checks PR verification does not invoke"
  end

  def test_every_invoked_script_exists
    missing = invoked_scripts.reject { |path| File.file?(File.join(ROOT, path)) }
    assert_empty missing, "invoked scripts do not exist"
  end

  def test_every_delivery_script_is_reachable
    scripts = Dir.glob(File.join(ROOT, ".github/scripts/**/*")).select { |path| File.file?(path) }
    relative = scripts.map { |path| path.delete_prefix("#{ROOT}/") }
    assert_empty relative - invoked_scripts - toolchain_suite, "orphaned .github/scripts files"
  end

  def test_every_local_action_exists
    actions = Dir.glob(File.join(ROOT, ".github/actions/**/action.{yml,yaml}"))
    nested = actions.flat_map { |path| Psych.safe_load(File.read(path), aliases: true).dig("runs", "steps").to_a }
    references = (workflow_steps + nested).map { |step| step["uses"].to_s }.grep(/\A[.$]\//)
    missing = references.reject { |ref| %w[action.yml action.yaml].any? { |name| File.file?(File.join(ROOT, ref.delete_prefix("$/"), name)) } }
    assert_empty missing, "local action references have no manifest"
  end
end
