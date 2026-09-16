# frozen_string_literal: true

require_relative "card_reconcile_lane_fixture"
require_relative "card_reconcile_verdict_corpus"

# The file set: which real documents in a lane directory are verdicts at all. A brief is an
# assignment, even when it quotes a verdict or names the head it is for.
class VerdictCorpusTest < Minitest::Test
  include LaneFixture

  def test_the_round_file_is_read_and_the_brief_next_to_it_is_not
    files = { "review-brief-3.md" => VerdictCorpus::BRIEF_1672,
              "review-round-3.md" => VerdictCorpus::ROUND_3_1672 }
    with_verdicts(1672, files) do |reader, lane|
      verdict = only(reader.verdicts(lane))
      assert_equal "animichi-lane-1672/review-round-3.md", verdict.path
      assert_equal :approved, verdict.kind
      assert_equal "72f9672dcc0202c675261e3712b741f8c9c26747", verdict.sha
    end
  end

  def test_a_brief_alone_is_not_a_verdict
    files = { "review-brief-3.md" => VerdictCorpus::BRIEF_1672 }
    with_verdicts(1672, files) { |reader, lane| assert_empty reader.verdicts(lane) }
  end

  def test_a_fix_brief_that_names_its_head_and_quotes_a_verdict_is_not_a_verdict
    files = { "review-fix-round-1-brief.md" => VerdictCorpus::FIX_BRIEF_1558 }
    with_verdicts(1558, files) { |reader, lane| assert_empty reader.verdicts(lane) }
  end

  private

  def only(found)
    assert_equal 1, found.length, "expected one verdict, got #{found.map(&:path).inspect}"
    found.first
  end
end
