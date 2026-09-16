# frozen_string_literal: true

require_relative "card_reconcile_github_fixture"
require_relative "card_reconcile_snapshot_fixtures"

# The merge-state ladder an open pull request's own state drives, once the verdict is fresh at its
# head.
class PullRequestDecisionTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_ci_running_when_the_pushed_head_has_pending_checks
    pull_request = pull(1713, head_ref: "lifeodyssey/orca-1713-lane", checks: checks_of(4, 0, 2))
    row = row(pushed_snapshot(1713, pull_request), 1713, now: NOW)
    assert_equal "ci-running", row.state
    assert_equal "wait for CI", row.next_action
    assert_match(/checks 4\/6 green/, row.facts)
  end

  def test_mergeable_when_approved_green_and_unblocked
    pull_request = pull(1732, head_ref: "lifeodyssey/orca-1732-lane", merge_state: "CLEAN",
                               checks: checks_of(27, 0, 0))
    row = row(pushed_snapshot(1732, pull_request), 1732, now: NOW)
    assert_equal "mergeable", row.state
    assert_equal "merge", row.next_action
  end

  def test_red_checks_flip_mergeable_to_needs_fix
    bad = pull(1732, head_ref: "lifeodyssey/orca-1732-lane", merge_state: "CLEAN",
                     checks: checks_of(26, 1, 0))
    row = row(pushed_snapshot(1732, bad), 1732, now: NOW)
    assert_equal "needs-fix", row.state
    assert_equal "fix the failing checks", row.next_action
  end

  def test_open_review_threads_flip_mergeable_to_needs_fix
    threaded = pull(1732, head_ref: "lifeodyssey/orca-1732-lane", threads: 2)
    row = row(pushed_snapshot(1732, threaded), 1732, now: NOW)
    assert_equal "needs-fix", row.state
    assert_equal "resolve 2 review threads", row.next_action
  end

  # `gh` reports `BLOCKED` whenever a required check or the ruleset blocks the merge, and this
  # repository requires no approving review. A pending check decides first.
  def test_pending_checks_outrank_a_blocked_merge_state
    blocked = GitHubFixture.blocked_with_pending_checks
    row = row(pushed_snapshot(1702, blocked), 1702, now: NOW)
    assert_equal "ci-running", row.state
    assert_equal "wait for CI", row.next_action
    assert_match(%r{checks 28/29 green}, row.facts)
  end

  # Every check green, no thread open, and still `BLOCKED`: the row names the facts it saw and sends
  # the coordinator to the ruleset instead of claiming a review approval is missing.
  def test_a_blocked_merge_state_with_green_checks_names_the_facts_it_saw
    row = row(pushed_snapshot(1702, GitHubFixture.blocked_all_green), 1702, now: NOW)
    assert_equal "merge-blocked", row.state
    assert_equal "inspect the ruleset (BLOCKED, checks 29/29 green, 0 threads open)", row.next_action
  end
end
