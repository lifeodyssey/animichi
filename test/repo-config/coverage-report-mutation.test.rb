# SUT: test/repo-config/check-coverage-report.rb — the empty-report refusal has to be what
# holds the line, and the set it guards has to be read from the tree (#1766).
#
# Each case runs the real CLI against a throwaway workspace. The first also runs a mutant: a
# copy of the gate with the empty-report assertion deleted, which must then pass the very
# report the original refuses — a guard whose removal changes nothing is not evidence. The
# second plants a coverage-gated package no file in this repository names and requires the
# unmodified CLI to refuse its empty report by name.
require "minitest/autorun"
require "open3"
require "tmpdir"
require "fileutils"
require_relative "coverage_gate"
require_relative "coverage_workspace"

class CoverageReportMutationTest < Minitest::Test
  HERE = __dir__
  CLI = "check-coverage-report.rb"
  ASSERTION = "    return [measured_nothing] if lcov.sources.empty?\n"

  def run_cli(cli_dir, root, package)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby,
                                      File.join(cli_dir, CLI), File.join(root, package))
    [status, out + err]
  end

  def with_empty_report(package)
    Dir.mktmpdir("coverage-report-mutation-") do |root|
      workspace = CoverageWorkspace.new(root)
      workspace.package(package)
      workspace.report(package, [])
      yield root
    end
  end

  # A copy of the CLI whose gate has the empty-report assertion deleted.
  def with_mutant_cli
    gate = File.read(File.join(HERE, "coverage_gate.rb"))
    assert_includes gate, ASSERTION, "the empty-report assertion moved; re-point this mutation at it"
    Dir.mktmpdir("coverage-gate-mutant-") do |dir|
      File.write(File.join(dir, "coverage_gate.rb"), gate.sub(ASSERTION, ""))
      FileUtils.cp(File.join(HERE, CLI), dir)
      yield dir
    end
  end

  def test_deleting_the_empty_report_assertion_lets_an_empty_report_pass
    with_empty_report("packages/probe") do |root|
      status, output = run_cli(HERE, root, "packages/probe")
      refute status.success?, "the gate must refuse an empty report\n#{output}"
    end
    with_empty_report("packages/probe") do |root|
      status, output = with_mutant_cli { |dir| run_cli(dir, root, "packages/probe") }
      assert status.success?, "the mutant still refused, so something else holds the line\n#{output}"
    end
  end

  def test_a_coverage_gated_package_nothing_names_is_still_checked
    with_empty_report("workers/newcomer") do |root|
      assert_equal ["workers/newcomer"], CoverageGate.in_workspace(root).map(&:directory)
      status, output = run_cli(HERE, root, "workers/newcomer")
      refute status.success?, "an unlisted gated package must be checked\n#{output}"
      assert_includes output, "workers/newcomer: coverage report workers/newcomer/coverage/lcov.info measured no files"
    end
  end

  def test_a_package_without_node_coverage_passes_untouched
    Dir.mktmpdir("coverage-report-mutation-") do |root|
      CoverageWorkspace.new(root).package("packages/plain", script: "node --test test/*.test.mjs")
      status, output = run_cli(HERE, root, "packages/plain")
      assert status.success?, "a package that measures nothing must not be refused\n#{output}"
    end
  end
end
