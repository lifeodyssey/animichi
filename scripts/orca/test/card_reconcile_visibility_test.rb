# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"

# Which cards are worth a row: a merged, settled card with nothing left to reconcile is history, and
# the same card comes back the moment its head is not the merged one.
class CardVisibilityTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_a_settled_card_with_a_merged_head_is_not_reported
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        worktrees: [worktree(1700)],
                        merged_heads: { SHA => "lifeodyssey/orca-1700-lane" })
    assert_nil row(snapshot, 1700, now: NOW)
  end

  def test_the_same_card_is_reported_when_its_head_is_not_merged
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        worktrees: [worktree(1700)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "needs-review", row.state
    assert_match(/head a1b2c3d/, row.facts)
    assert_equal NOW - 1800, row.stuck_since
  end

  def test_a_merged_head_does_not_hide_uncommitted_work
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        worktrees: [worktree(1700, dirty: 2)],
                        merged_heads: { SHA => "lifeodyssey/orca-1700-lane" })
    assert_equal "ready-to-harvest", row(snapshot, 1700, now: NOW).state
  end
end
