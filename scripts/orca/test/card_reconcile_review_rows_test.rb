# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"

# The row for a card whose head carries no fresh verdict: which head the row names, and which clock
# it is stuck since.
class ReviewRowsTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_needs_review_for_a_head_without_a_verdict
    snapshot = snapshot(worktrees: [worktree(1700, head: LATER)])
    row = row(snapshot, 1700, now: NOW)
    assert_equal "needs-review", row.state
    assert_equal "head b1b2c3d, no verdict for this head", row.facts
    assert_equal NOW - 1800, row.stuck_since
  end

  def test_a_new_push_flips_ready_to_push_back_to_needs_review
    snapshot = snapshot(lanes: [lane(1700, [phase(1700)])], settled: { "task_1700" => NOW - 600 },
                        worktrees: [worktree(1700, head: LATER)],
                        verdicts: [verdict(1700, sha: SHA)])
    assert_equal "needs-review", row(snapshot, 1700, now: NOW).state
  end

  def test_a_pull_request_head_dates_a_card_with_no_worktree
    pull_request = pull(1711, head_ref: "lifeodyssey/orca-1601-ac5", head_sha: LATER,
                               updated_at: NOW - 300)
    snapshot = snapshot(lanes: [lane(1601, [phase(1601)])], settled: { "task_1601" => NOW - 600 },
                        pull_requests: [pull_request])
    row = row(snapshot, 1601, now: NOW)
    assert_equal "needs-review", row.state
    assert_match(/head b1b2c3d/, row.facts)
    assert_equal NOW - 300, row.stuck_since
  end

  # An unreadable ancestry keeps the pushed head: the report over-reports instead of hiding a card
  # that may still need a review.
  def test_an_unknown_ancestry_read_keeps_the_pull_request_head
    pull_request = pull(1739, head_ref: "lifeodyssey/orca-1702-lane", head_sha: LATER)
    row = row(pushed_snapshot(1702, pull_request), 1702, now: NOW)
    assert_equal "needs-review", row.state
    assert_match(/head b1b2c3d \(open PR; local worktree a1b2c3d\)/, row.facts)
  end
end
