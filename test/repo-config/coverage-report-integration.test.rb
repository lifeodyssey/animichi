# SUT: node's coverage run followed by test/repo-config/check-coverage-report.rb — the pair
# the pre-push gate and CI's `affected` job run for a coverage-gated package (#1766).
#
# The one case here that runs a real suite: a throwaway package whose script is shaped like
# the repository's own (cd to the root, root-relative include glob and lcov destination),
# run by `sh` from the package directory as `pnpm run` would. A wrong include glob must make
# node pass its 95 % threshold on an empty report — the hazard, reproduced rather than
# assumed — and the check must turn that run red. The right glob is the control: the same
# run, measured, passes both.
require "minitest/autorun"
require "open3"
require "tmpdir"
require_relative "coverage_workspace"

class CoverageReportIntegrationTest < Minitest::Test
  PROBE = "packages/probe"
  CLI = File.join(__dir__, "check-coverage-report.rb")
  SUITE = "import test from \"node:test\";\nimport { a } from \"../src/a.mjs\";\n" \
          "test(\"a\", () => { if (a() !== 1) throw new Error(\"a\"); });\n".freeze

  def gate(include)
    Dir.mktmpdir("coverage-report-integration-") do |root|
      workspace = CoverageWorkspace.new(root)
      workspace.package(PROBE, script: CoverageWorkspace.gated_script(PROBE, include: include))
      workspace.write("#{PROBE}/test/a.test.mjs", SUITE)
      yield(suite_run(root), check_run(root))
    end
  end

  def suite_run(root)
    script = JSON.parse(File.read(File.join(root, PROBE, "package.json"))).dig("scripts", "test")
    Open3.capture2e("sh", "-c", script, chdir: File.join(root, PROBE))
  end

  def check_run(root)
    Open3.capture2e({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, CLI, chdir: File.join(root, PROBE))
  end

  def test_a_wrong_include_glob_turns_the_gate_red_instead_of_passing_at_100
    gate("probe/src/**/*.mjs") do |(suite, suite_status), (check, check_status)|
      assert suite_status.success?, "node itself must pass the empty report, or the hazard is gone\n#{suite}"
      assert_match(/all files\s*\|\s*100\.00/, suite)
      refute check_status.success?, "the check must refuse what node passed\n#{check}"
      assert_includes check, "#{PROBE}: coverage report #{PROBE}/coverage/lcov.info measured no files"
    end
  end

  def test_the_right_include_glob_passes_both
    gate("#{PROBE}/src/**/*.mjs") do |(suite, suite_status), (check, check_status)|
      assert suite_status.success?, suite
      assert check_status.success?, check
    end
  end
end
