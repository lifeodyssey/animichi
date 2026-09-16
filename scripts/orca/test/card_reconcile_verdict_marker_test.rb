# frozen_string_literal: true

require_relative "card_reconcile_lane_fixture"
require_relative "card_reconcile_verdict_corpus"

# The markers a real verdict file uses when no `Candidate` or `HEAD` line binds a commit: a `fix` line,
# a range named in prose, and a candidate row that qualifies its own round.
class VerdictMarkerTest < Minitest::Test
  include LaneFixture

  # A stack line whose `HEAD` marker follows the SHA: the commit under review is the `fix` one.
  def test_a_fix_commit_before_its_head_marker_is_the_candidate
    verdict = only(VerdictCorpus::CR_2_1695)
    assert_equal "df8fd6545", verdict.sha
    assert_equal :approved, verdict.kind
  end

  def test_a_fix_under_review_line_names_the_candidate
    verdict = only(VerdictCorpus::CR_1695)
    assert_equal "54979ff8a", verdict.sha
    assert_equal :changes_required, verdict.kind
  end

  # The prose line names the range `origin/main...HEAD`, so it must not be read as its start.
  def test_a_candidate_range_in_prose_names_its_end
    verdict = only(VerdictCorpus::GROK_ROUND_2_1695)
    assert_equal "cee36288", verdict.sha
    assert_equal :approved, verdict.kind
  end

  def test_a_candidate_row_that_qualifies_its_own_round_is_not_superseded
    verdict = only(VerdictCorpus::GROK_ROUND_2_1690)
    assert_equal "241d6239aba14e923537c1cc25f8b10186ee45f2", verdict.sha
    assert_equal :changes_required, verdict.kind
  end

  private

  def only(text)
    with_verdicts(1695, { "review-round-2.md" => text }) do |reader, lane|
      found = reader.verdicts(lane)
      assert_equal 1, found.length
      return found.first
    end
  end
end
