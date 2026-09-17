# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"

# A hold outranks everything else a card's own facts say, and a satisfied one is stale until someone
# releases it.
class HoldRowsTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_a_hold_outlives_a_headless_settled_card
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        holds: { 1700 => hold(1700) })
    row = row(snapshot, 1700, now: NOW)
    assert_equal "held", row.state
    assert_equal "\u2014", row.next_action
    assert_equal NOW - 900, row.stuck_since
  end

  def test_a_hold_outranks_a_running_lane
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, alive: true, exited_at: nil)])],
                        holds: { 1700 => hold(1700) })
    assert_equal "held", row(snapshot, 1700, now: NOW).state
  end

  # The hold is stored fact on its own: a card whose lane, worktree and pull request are all gone
  # still owes its row, or the unreleasable hold would sit hidden in the holds file.
  def test_a_hold_with_no_lane_worktree_or_pull_request_is_still_reported
    snapshot = snapshot(holds: { 1700 => hold(1700) })
    row = row(snapshot, 1700, now: NOW)
    assert_equal "held", row.state
    assert_match(/pr_merged 1607/, row.facts)
  end
end
