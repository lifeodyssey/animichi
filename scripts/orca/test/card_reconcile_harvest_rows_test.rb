# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"

# The ready-to-harvest row: a settled lane whose worktree still holds uncommitted files, and the
# clean tree that falls through to a review instead.
class HarvestRowsTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_undelivered_flips_to_ready_to_harvest_when_worker_done_and_changes_exist
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        worktrees: [worktree(1700, dirty: 3, newest_change_at: NOW - 300)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "ready-to-harvest", row.state
    assert_equal "worker_done, 3 uncommitted files, head a1b2c3d", row.facts
    assert_equal "commit and push", row.next_action
    assert_equal NOW - 300, row.stuck_since
  end

  def test_ready_to_harvest_flips_to_needs_review_when_the_tree_is_clean
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        worktrees: [worktree(1700, dirty: 0)])
    assert_equal "needs-review", row(snapshot, 1700, now: NOW).state
  end
end
