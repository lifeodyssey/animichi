# SUT: test/repo-config/coverage_gate.rb — a coverage-gated package's lcov report must have
# measured that package (#1766).
#
# node's test runner prints `100.00` for a report that measured nothing: its percentage of
# zero lines out of zero is 100, so an include glob that matches nothing from the runner's
# cwd passes a 95 % threshold. These cases build the report such a run leaves behind, and
# the ones around it, from fixtures — no suite runs here.
require "minitest/autorun"
require "tmpdir"
require_relative "coverage_gate"
require_relative "coverage_workspace"

class CoverageReportTest < Minitest::Test
  PROBE = "packages/probe"
  REPORT = "#{PROBE}/coverage/lcov.info"

  # The probe package, then whatever the block leaves behind as its run.
  def refusals_after_run
    Dir.mktmpdir("coverage-report-") do |root|
      CoverageWorkspace.new(root).package(PROBE)
      yield root
      CoverageGate.declared_in(root, PROBE).flat_map(&:refusals)
    end
  end

  def refusals_for(sources)
    refusals_after_run { |root| CoverageWorkspace.new(root).report(PROBE, sources) }
  end

  def test_a_report_of_the_package_own_sources_is_accepted
    assert_empty refusals_for(["#{PROBE}/src/a.mjs"])
  end

  def test_a_report_with_no_source_entries_is_refused_by_package_and_path
    refusal = refusals_for([]).join("\n")
    assert_includes refusal, "#{PROBE}: coverage report #{REPORT} measured no files"
    assert_includes refusal, "'#{PROBE}/src/**/*.mjs'"
  end

  # Non-empty, and still not this package: paths anchored at the package instead of the
  # repository root (what re-anchoring the script would produce, and what Codecov cannot
  # map), and a sibling package's file.
  def test_a_report_missing_the_package_sources_is_refused
    %w[src/a.mjs packages/other/src/a.mjs].each do |foreign|
      refusal = refusals_for([foreign]).join("\n")
      assert_includes refusal, "#{PROBE}: coverage report #{REPORT} names files that are not #{PROBE}'s own"
      assert_includes refusal, foreign
    end
  end

  def test_a_source_the_package_no_longer_has_is_refused
    assert_includes refusals_for(["#{PROBE}/src/gone.mjs"]).join("\n"), "#{PROBE}/src/gone.mjs"
  end

  def test_a_missing_report_is_refused
    assert_includes refusals_after_run { |_nothing_written| }.join("\n"), "#{PROBE}: no coverage report at #{REPORT}"
  end

  def test_a_coverage_run_writing_no_lcov_report_is_refused
    Dir.mktmpdir("coverage-report-") do |root|
      script = CoverageWorkspace.gated_script(PROBE).sub(/--test-reporter=lcov \S+ /, "")
      CoverageWorkspace.new(root).package(PROBE, script: script)
      refusal = CoverageGate.declared_in(root, PROBE).flat_map(&:refusals).join("\n")
      assert_includes refusal, "#{PROBE}: `test` runs node's coverage but writes no lcov report"
    end
  end

  # The repository's own gates, derived from its workspace: each must name an lcov report, or
  # the check that runs after it has nothing to read. The set being non-empty keeps this from
  # passing on a derivation that found nothing.
  def test_every_gated_package_in_the_repository_writes_a_checkable_report
    gates = CoverageGate.in_workspace(ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__)))
    refute_empty gates, "no workspace script runs node's coverage; the derivation has gone blind"
    gates.each { |gate| refute_nil gate.report, "#{gate.directory}: its coverage run writes no lcov report" }
  end

  def test_a_package_without_node_coverage_is_not_gated
    Dir.mktmpdir("coverage-report-") do |root|
      CoverageWorkspace.new(root).package(PROBE, script: "node --test test/*.test.mjs")
      assert_empty CoverageGate.declared_in(root, PROBE)
    end
  end
end
