# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"

# The rows a lane's runner state produces: running, a reported failure, and an exited runner without
# a worker_done. A lane row that only borrows another card's worktree is `Shape2026LaneTest`.
class LaneRowsTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_a_dead_runner_without_an_exit_receipt_is_undelivered
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, exited_at: nil)])],
                        worktrees: [worktree(1700)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "undelivered", row.state
    assert_equal "lane write exited unknown, no worker_done", row.facts
    assert_equal NOW - 7200, row.stuck_since
  end

  def test_running_with_a_live_runner
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, alive: true, exited_at: nil)])],
                        worktrees: [])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "running", row.state
    assert_equal NOW - 7200, row.stuck_since
  end

  def test_running_flips_to_undelivered_when_the_runner_is_dead_and_unsettled
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, alive: false, exited_at: NOW - 3600)])],
                        worktrees: [worktree(1700)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "undelivered", row.state
    assert_equal NOW - 3600, row.stuck_since
  end

  def test_running_flips_to_undelivered_when_the_agent_exited_under_a_live_runner
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, alive: true, exited_at: NOW - 3600)])],
                        worktrees: [worktree(1700)])
    assert_equal "undelivered", row(snapshot, 1700, now: NOW).state
  end

  # A failed `ps` read leaves liveness unknown: the ladder must not read that as a dead runner
  # whose worker_done is missing, and the card stays on the board by its own facts.
  def test_an_unknown_runner_is_not_reported_as_undelivered
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, alive: nil, exited_at: nil)])],
                        worktrees: [worktree(1700)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "needs-review", row.state
  end

  # `failed` is a delivered outcome: the worker reported, so the row must not say "no worker_done".
  def test_a_lane_whose_worker_reported_failed_is_delivered_failed
    snapshot = snapshot(lanes: [lane(1700, [phase(1700, exited_at: NOW - 3600)])],
                        settled: { "task_1700" => NOW - 600 },
                        failed: { "task_1700" => NOW - 600 }, worktrees: [worktree(1700)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "delivered-failed", row.state
    assert_equal "lane write reported failed", row.facts
    assert_equal "dispatch fix", row.next_action
    assert_equal NOW - 3600, row.stuck_since
  end

  def test_a_lane_that_moved_past_a_failed_phase_is_judged_by_its_newest_phase
    phases = [phase(1700, exited_at: NOW - 3600), phase(1700, name: "fix", task_id: "task_1700_fix")]
    snapshot = snapshot(lanes: [lane(1700, phases)], worktrees: [worktree(1700)],
                        settled: { "task_1700" => NOW - 600, "task_1700_fix" => NOW - 300 },
                        failed: { "task_1700" => NOW - 600 })
    assert_equal "needs-review", row(snapshot, 1700, now: NOW).state
  end
end
