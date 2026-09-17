# SUT: test/repo-config/e2e-spec-coverage.test.rb — the #1702 coverage contract
# has to fail in the states it exists to catch.
#
# The contract refuses a spec no runnable script names, which is the shape of
# guard that survives a rewrite by passing: the tree it reads always satisfies
# it. Every probe copies the contract, its registry and the data it reads into a
# throwaway tree (test/repo-config/e2e_spec_coverage_tree.rb), checks that tree
# is green, mutates the copy and requires the copy to refuse it; the committed
# tree is never written to. The probes carry the three findings on PR #1739: a
# spec the lane names and then loses (PRRT_kwDOQfXFOM6jKgAz), a declared case
# exclusion whose tags are gone (PRRT_kwDOQfXFOM6jKgA4), and a spec token or a
# case filter printed by a command that is not `playwright test`
# (PRRT_kwDOQfXFOM6jKgA8).
require "minitest/autorun"
require "open3"
require_relative "e2e_spec_coverage_tree"

class E2eSpecCoverageMutationTest < Minitest::Test
  include E2eSpecCoverageTree

  ORPHAN = "probe-orphan.spec.ts"
  EXEMPTION_PATTERN = "web-*.spec.ts"
  OWNED_SPEC = "web-chat-selection.spec.ts"
  OWNER_CLAUSE = "#1722 owns the repair"
  PERF_TAG = "@perf-mobile-cold"
  PERF_SPECS = %w[web-map-spike.spec.ts web-splash.spec.ts].freeze
  NO_SUCH_SPEC = "EXEMPT/KNOWN_FAILING entries with no such spec on disk"
  NO_REPAIR_OWNER = "naming no repair owner"
  ORPHAN_REFUSAL = "no runnable script names"
  STALE_EXCLUSION = "patterns no committed spec declares"
  EXCLUSION_DRIFT = "must be exactly the ones declared in LANE_EXCLUDED_CASES"

  def test_an_orphan_spec_is_refused_until_the_lane_names_it
    with_mutated_root do |root|
      write_orphan(root, ORPHAN)
      assert_refused(root, "an on-disk spec in no runnable script", ORPHAN, ORPHAN_REFUSAL)
      add_to_lane(root, ORPHAN)
      assert_accepted(root, "the lane naming that spec")
      restore_manifest(root)
      assert_refused(root, "that spec dropped from every runnable script", ORPHAN, ORPHAN_REFUSAL)
    end
  end

  # The registry's own rule is "named, never patterned": a pattern is not a spec
  # and cannot stand in for the one it would swallow.
  def test_an_exemption_pattern_is_refused_as_a_stand_in_for_a_spec
    with_mutated_root do |root|
      exempt_by_pattern(root, EXEMPTION_PATTERN)
      assert_refused(root, "a broad exemption pattern", EXEMPTION_PATTERN, NO_SUCH_SPEC)
    end
  end

  # Parking a spec demands a repair owner; without one the entry is a place
  # failures go to be forgotten.
  def test_a_known_failing_entry_without_a_repair_owner_is_refused
    with_mutated_root do |root|
      drop_repair_owner(root, OWNER_CLAUSE)
      assert_refused(root, "a known-failing entry with no repair owner", OWNED_SPEC, NO_REPAIR_OWNER)
    end
  end

  # `--grep-invert` matches nothing once the tags it names are gone, so the cases
  # run in the always-run lane while the declaration still reads as enforced.
  def test_a_declared_case_exclusion_whose_tags_are_gone_is_refused
    with_mutated_root do |root|
      PERF_SPECS.each { |spec| strip_case_tag(root, spec, PERF_TAG) }
      assert_refused(root, "a declared case exclusion whose tags are gone", PERF_TAG, STALE_EXCLUSION)
    end
  end

  # An `echo` can print a spec path; only an argument of `playwright test` runs it.
  def test_a_spec_token_printed_by_a_non_playwright_command_earns_no_lane_credit
    with_mutated_root do |root|
      write_orphan(root, ORPHAN)
      append_echo(root, "typecheck", ORPHAN)
      assert_refused(root, "a decoy spec token in the typecheck command", ORPHAN, ORPHAN_REFUSAL)
    end
  end

  # The same defect one function over: a printed case filter is not a filter.
  def test_a_case_filter_printed_by_a_non_playwright_command_earns_no_lane_credit
    with_mutated_root do |root|
      move_filter_to_prose(root, PERF_TAG)
      assert_refused(root, "a printed case filter", PERF_TAG, EXCLUSION_DRIFT)
    end
  end

  private

  # A probe is only evidence when the same tree is green before the mutation:
  # otherwise the refusal could come from the fixture, not from the mutation.
  def with_mutated_root
    with_spec_coverage_tree do |root|
      assert_accepted(root, "the unmutated tree")
      yield root
    end
  end

  def assert_refused(root, label, named, consequence)
    status, output = run_contract(root)
    refute(status.success?, "mutation survived: #{label}")
    assert_includes(output, named, "#{label}: the failure must name the offender")
    assert_includes(output, consequence, "#{label}: the failure must name its consequence")
  end

  def assert_accepted(root, label)
    status, output = run_contract(root)
    assert(status.success?, "valid tree refused: #{label}\n#{output}")
  end

  def run_contract(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, contract_path(root))
    [status, out + err]
  end
end
