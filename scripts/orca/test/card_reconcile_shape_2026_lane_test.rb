# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"
require_relative "card_reconcile_shape_2026_snapshot"

# Lane directories carry the card they served: a lane row follows its own directory, and a lane row
# never borrows the worktree a phase recorded for another card.
class Shape2026LaneTest < Minitest::Test
  include Shape2026Snapshot

  def test_a_lane_row_follows_its_lane_directory
    rows = Shape2026Snapshot.rows
    assert_equal "undelivered", row_for(rows, Shape2026::READY).state
    assert_match(/lane pi-attempt exited unknown/, row_for(rows, Shape2026::READY).facts)
    cards = rows.map(&:card)
    refute_includes cards, Shape2026::ORPHAN
    refute_includes cards, 1691
    refute_includes cards, 1694
  end

  def test_a_lane_row_does_not_borrow_a_worktree_that_belongs_to_another_card
    lanes = [ReconcileFixtures.lane(1700, [ReconcileFixtures.phase(1700,
                                                                   workspace: "/w/orca-1699-lane")])]
    trees = [ReconcileFixtures.worktree(1699, head: ReconcileFixtures::LATER,
                                              path: "/w/orca-1699-lane")]
    snapshot = SnapshotFixtures.snapshot(lanes: lanes, worktrees: trees)
    undelivered = SnapshotFixtures.row(snapshot, 1700)
    assert_equal "undelivered", undelivered.state
    refute_match(/b1b2c3d/, undelivered.facts)
    assert_match(/head b1b2c3d/, SnapshotFixtures.row(snapshot, 1699).facts)
  end
end
