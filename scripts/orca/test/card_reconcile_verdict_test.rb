# frozen_string_literal: true

require_relative "card_reconcile_lane_fixture"
require_relative "card_reconcile_verdict_documents"
require_relative "fake_patch_identity"

# The verdict files a lane directory holds: which of them are verdicts at all, and what a verdict
# document says. `grok-review-round-2.md` and `review-cr.md` are real shapes on this machine, so the
# file set cannot come from one filename pattern.
class VerdictReaderTest < Minitest::Test
  include LaneFixture

  HEAD = VerdictDocuments::HEAD
  LATER = "b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4".freeze

  def test_reads_the_head_sha_and_an_approved_verdict
    with_verdicts(1672, { "review-round-2.md" => VerdictDocuments::APPROVED }) do |reader, lane|
      verdict = reader.verdicts(lane).first
      assert_equal :approved, verdict.kind
      assert_equal HEAD, verdict.sha
      assert_equal "animichi-lane-1672/review-round-2.md", verdict.path
    end
  end

  def test_reads_changes_required_and_prefers_the_line_that_names_the_head
    with_verdicts(1601, { "review-round-1.md" => VerdictDocuments::CHANGES }) do |reader, lane|
      verdict = reader.verdicts(lane).first
      assert_equal :changes_required, verdict.kind
      assert_equal "4ec8a4f6e60ad71605d96b46b1e1679789298a15", verdict.sha
    end
  end

  def test_a_grok_review_and_a_cr_review_are_verdicts
    files = { "grok-review-round-2.md" => VerdictDocuments::APPROVED,
              "review-cr.md" => VerdictDocuments::CHANGES }
    with_verdicts(1695, files) do |reader, lane|
      names = reader.verdicts(lane).map { |verdict| File.basename(verdict.path) }.sort
      assert_equal %w[grok-review-round-2.md review-cr.md], names
    end
  end

  def test_a_brief_a_report_and_a_spec_are_not_verdicts
    files = { "review-brief.md" => VerdictDocuments::APPROVED,
              "review-fix-report.md" => VerdictDocuments::APPROVED,
              "review-cr-spec.md" => VerdictDocuments::APPROVED }
    with_verdicts(1039, files) { |reader, lane| assert_empty reader.verdicts(lane) }
  end

  def test_a_document_without_a_verdict_statement_is_not_a_verdict
    files = { "review-round-3.md" => "- HEAD (under review): `#{HEAD}`\n\nNo decision recorded.\n" }
    with_verdicts(1672, files) { |reader, lane| assert_empty reader.verdicts(lane) }
  end

  # The file rule and the freshness rule meet here: the reader reads the document, and the patch rule
  # is what makes it hold for a head it does not name. The verdict commit is the first question and
  # the candidate head the second: swapped, a merge commit on top of the reviewed one reads as fresh.
  def test_a_document_the_head_no_longer_names_is_fresh_when_the_patches_match
    identity = FakePatchIdentity.new(identical: true)
    files = { "review-round-2.md" => VerdictDocuments::APPROVED }
    with_verdicts(1672, files, identity: identity) do |reader, lane|
      verdict = reader.fresh(lane, LATER, "origin/main")
      assert_equal HEAD, verdict.sha
      assert_equal false, verdict.names?(LATER)
      assert_equal [[HEAD, LATER, "origin/main"]], identity.calls
    end
  end
end

# A line that marks its verdict as another round's history decides nothing: the file's current
# declaration wins, whichever of the two comes first in the document.
class VerdictKindTest < Minitest::Test
  def test_the_current_declaration_wins_over_a_previous_one_before_it
    text = "Previous verdict: CHANGES REQUIRED\nVerdict: APPROVED\n"
    assert_equal :approved, Orca::CardReconcile::VerdictKind.kind(text)
  end

  def test_the_current_declaration_wins_over_a_prior_one_after_it
    text = "## Verdict: **CHANGES REQUIRED**\nPrior verdict: APPROVED\n"
    assert_equal :changes_required, Orca::CardReconcile::VerdictKind.kind(text)
  end
end
