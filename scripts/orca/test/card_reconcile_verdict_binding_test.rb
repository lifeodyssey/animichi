# frozen_string_literal: true

require_relative "card_reconcile_lane_fixture"
require_relative "card_reconcile_verdict_corpus"

# Which commit a real verdict file reviewed. The excerpts are verbatim, and every case pins a SHA the
# reviewer had to read past a line that names another commit.
class VerdictBindingTest < Minitest::Test
  include LaneFixture

  def test_a_prose_line_that_mentions_head_does_not_outrank_the_candidate
    verdict = only(VerdictCorpus::ROUND_1_1591)
    assert_equal "5ea60618f8c01133eaf57f441f1a9fee3b146ecb", verdict.sha
    assert_equal :approved, verdict.kind
    assert_equal false, verdict.names?("2a8ca7ac")
  end

  def test_a_previous_round_head_does_not_outrank_the_candidate
    verdict = only(VerdictCorpus::ROUND_2_1726)
    assert_equal "15d2478f337000afebd795fbf7a6d9d79a3e5148", verdict.sha
    assert_equal :approved, verdict.kind
    assert_equal false, verdict.names?("b85ca3e202fa6587f51ab4f0ecf0bf6dd405aafc")
  end

  def test_the_parent_row_next_to_the_candidate_does_not_outrank_it
    verdict = only(VerdictCorpus::ROUND_2_1605)
    assert_equal "a6039815f", verdict.sha
    assert_equal true, verdict.names?("a6039815f51ec24725b21175ae9063d01c6fd9ca")
    assert_equal false, verdict.names?("5abed3b6a32272b6b1e931962be23d07a0b3beca")
    assert_equal :changes_required, verdict.kind
  end

  def test_a_chinese_verdict_heading_is_read_and_the_previous_head_is_not_the_candidate
    verdict = only(VerdictCorpus::ROUND_2_1720)
    assert_equal "c8c9557b70099a5e56a1ec7e1d4bda51e8f77ad0", verdict.sha
    assert_equal :approved, verdict.kind
    assert_equal false, verdict.names?("22c085f3ba2b579427c9664b8801ba9a94c619e6")
  end

  def test_a_candidate_named_on_a_branch_line_is_read
    verdict = only(VerdictCorpus::ROUND_4_1702)
    assert_equal "3c9d1f330961d73d3270c623be1f5fa77d51b86b", verdict.sha
    assert_equal :approved, verdict.kind
    assert_equal false, verdict.names?("854a8e5192f6357f7ab211a0b9198da98f09bde6")
  end

  def test_a_prose_mention_of_another_round_does_not_outrank_the_verdict_heading
    verdict = only(VerdictCorpus::ROUND_1_1725)
    assert_equal :changes_required, verdict.kind
    assert_equal "d86e6f2653f110c098a57f14d470bfd3693f5185", verdict.sha
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
