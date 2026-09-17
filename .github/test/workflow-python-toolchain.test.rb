# SUT: every workflow's use of the Python toolchain after the Python agent's retirement (#1607).
# No workflow syncs a Python project, runs one through `uv run`, or names the deleted
# `apps/agent` tree; `uv` survives only as the installer of two pinned, named lint tools.
require "minitest/autorun"
require "open3"
require "psych"

class WorkflowPythonToolchainTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOWS = Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort
  RETIRED = [/\buv\s+sync\b/, /\buv\s+run\b/, /\buv\s+pip\b/, /\buv\s+python\b/, %r{apps/agent}].freeze
  # The two lint tools uv still installs. Each is named, and each is pinned to one version.
  PERMITTED_TOOLS = %w[semgrep sqlfluff].freeze
  TOOL_INSTALL = /\b(?:uv\s+tool\s+(?:install|run)|uvx)\b(?<args>[^\n]*)/
  PINNED_TOOL = /"(?<name>[\w-]+)==[^"\s]+"/
  DRY_RUN_ENV = { "PATH" => "/usr/bin:/bin:/usr/sbin:/sbin" }.freeze

  # What a `make <target>` step runs, expanded by make itself, so a tool the Makefile
  # installs is judged like one the workflow installs directly.
  def expand_make(run)
    run.scan(/^\s*make\s+([\w-]+)\s*$/).flatten.map do |target|
      out, err, status = Open3.capture3(DRY_RUN_ENV, "make", "-n", target, chdir: ROOT, unsetenv_others: true)
      assert_predicate(status, :success?, "`make -n #{target}` failed: #{err}")
      out
    end.join("\n")
  end

  def run_texts(path)
    workflow = Psych.safe_load(File.read(path), aliases: true)
    workflow.fetch("jobs").flat_map do |id, job|
      job.fetch("steps", []).map { |step| ["#{File.basename(path)}:#{id}", step["run"].to_s] }
    end
  end

  def test_no_workflow_names_the_retired_python_project
    WORKFLOWS.each do |path|
      source = File.read(path)
      RETIRED.each do |pattern|
        assert(!source.match?(pattern), "#{File.basename(path)}: #{pattern.source} belongs to the retired Python agent")
      end
    end
  end

  def test_uv_installs_only_the_named_and_pinned_lint_tools
    installs = WORKFLOWS.flat_map { |path| run_texts(path) }.flat_map do |where, run|
      "#{run}\n#{expand_make(run)}".scan(TOOL_INSTALL).flatten.map { |args| [where, args] }
    end
    refute_empty installs, "no workflow installs a tool through uv; this guard would pass with its subject deleted"
    installs.each do |where, args|
      name = args[PINNED_TOOL, :name]
      assert_includes PERMITTED_TOOLS, name, "#{where}: uv may install only #{PERMITTED_TOOLS.join(' and ')}, " \
                                              "each as \"<name>==<version>\" (got `#{args.strip}`)"
    end
  end

  def test_both_permitted_tools_are_still_installed
    installed = WORKFLOWS.flat_map { |path| run_texts(path) }.flat_map do |_where, run|
      "#{run}\n#{expand_make(run)}".scan(TOOL_INSTALL).flatten.map { |args| args[PINNED_TOOL, :name] }
    end
    assert_equal PERMITTED_TOOLS, installed.compact.uniq.sort,
                 "the permitted list must name exactly the tools the workflows install"
  end
end
