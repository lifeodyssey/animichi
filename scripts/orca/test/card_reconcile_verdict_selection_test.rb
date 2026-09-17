# frozen_string_literal: true

require_relative "card_reconcile_lane_fixture"
require_relative "card_reconcile_verdict_corpus"
require_relative "fake_patch_identity"

# Which of a lane's several verdicts decides the card: the newest one that still holds for the head,
# asked newest first. The 1702 lane is the real shape where that order decides between a refusal and
# a `ready-to-push` row, because its round 5 refused the commit its round 4 approved.
class VerdictSelectionTest < Minitest::Test
  include ReconcileFixtures
  include LaneFixture

  NAMED = "3c9d1f330961d73d3270c623be1f5fa77d51b86b".freeze
  HEAD = "b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4".freeze

  # Verbatim excerpt of `animichi-lane-1702/review-round-5.md`, the half-hour-later refusal of the
  # commit `review-round-4.md` approved.
  ROUND_5_1702 = <<~'MARKDOWN'
    # Round-5 review — #1702 (PR #1739): design or trimming?

    Reviewer: Claude Opus 5. All commands ran in the foreground. HEAD `3c9d1f330`, parent `57bf0df09`.

    ## 2. Decision: CHANGES REQUIRED — one must-fix

    **CHANGES REQUIRED.** M-4: extract the registry into `e2e_lane_exclusions.rb`. Everything round 4
    approved still stands.
  MARKDOWN

  def test_the_newest_fresh_verdict_wins
    older = verdict(1702, sha: NAMED, name: "review-round-4.md", written_at: NOW - 1800)
    newer = verdict(1702, sha: HEAD, name: "review-round-5.md", written_at: NOW - 600)
    freshness = Orca::CardReconcile::VerdictFreshness.new
    assert_equal HEAD, freshness.pick([older, newer], HEAD, "origin/main").sha
  end

  # Both verdicts name the same commit, so only the order decides: newest first, or the round-4
  # approval wins and the row turns a refusal into `ready-to-push`.
  def test_the_newest_of_two_verdicts_that_name_the_same_head_wins
    older = verdict(1702, sha: NAMED, name: "review-round-4.md", written_at: NOW - 1800)
    newer = verdict(1702, sha: NAMED, kind: :changes_required, name: "review-round-5.md",
                    written_at: NOW - 600)
    freshness = Orca::CardReconcile::VerdictFreshness.new
    assert_equal :changes_required, freshness.pick([older, newer], NAMED, "origin/main").kind
  end

  # A restack that leaves the approved patch in place keeps the older verdict fresh by patch
  # identity, and the newer verdict names the head. Newest still wins.
  def test_the_newest_verdict_wins_over_an_older_one_that_holds_by_patch_identity
    older = verdict(1702, sha: NAMED, name: "review-round-4.md", written_at: NOW - 1800)
    newer = verdict(1702, sha: HEAD, kind: :changes_required, name: "review-round-5.md",
                    written_at: NOW - 600)
    freshness = Orca::CardReconcile::VerdictFreshness.new(FakePatchIdentity.new(identical: true))
    assert_equal :changes_required, freshness.pick([older, newer], HEAD, "origin/main").kind
  end

  # The same shape through the reader: the two files a real lane directory holds, handed to the
  # policy in the order their write times give. This pins the store's ordering as well as the loop.
  def test_the_real_lane_directory_hands_the_newer_verdict_to_the_policy
    files = { "review-round-4.md" => VerdictCorpus::ROUND_4_1702,
              "review-round-5.md" => ROUND_5_1702 }
    with_verdicts(1702, files) do |reader, lane|
      written_at(lane, "review-round-4.md", NOW - 1800)
      written_at(lane, "review-round-5.md", NOW - 600)
      verdict = reader.fresh(lane, NAMED, "origin/main")
      assert_equal "animichi-lane-1702/review-round-5.md", verdict.path
      assert_equal :changes_required, verdict.kind
    end
  end

  private

  def written_at(lane, name, at)
    File.utime(at, at, File.join(lane.dirs.first, name))
  end
end
