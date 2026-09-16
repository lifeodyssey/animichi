# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"
require_relative "fake_patch_identity"

# The row a fresh verdict produces for a settled card with a clean worktree: a fix when the verdict
# refuses, a push when it approves something still unpublished, and otherwise the pull request's own
# state. Which head a verdict is fresh for is `VerdictFreshnessTest`, not this.
class VerdictRowsTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  def test_ready_to_push_flips_to_needs_fix_on_changes_required
    snapshot = local_snapshot(1700, kind: :changes_required)
    row = row(snapshot, 1700, now: NOW)
    assert_equal "needs-fix", row.state
    assert_equal "dispatch fix", row.next_action
    assert_match(/verdict CHANGES REQUIRED@a1b2c3d in .*review-round-1.md/, row.facts)
  end

  def test_ready_to_push_when_approved_without_a_remote
    row = row(local_snapshot(1700), 1700, now: NOW)
    assert_equal "ready-to-push", row.state
    assert_equal "push", row.next_action
    assert_match(/APPROVED@a1b2c3d, no open PR at this head/, row.facts)
  end

  def test_an_open_pull_request_is_publication_even_when_ls_remote_is_unknown
    pull_request = pull(1739, head_ref: "lifeodyssey/orca-1702-lane", head_sha: SHA)
    row = row(pushed_snapshot(1702, pull_request, remote: {}), 1702, now: NOW)
    assert_equal "mergeable", row.state
    assert_equal "merge", row.next_action
  end

  # Round 1's case: an update-branch merge commit moved the pull request head while the worktree
  # stayed on the approved commit, so the pushed head still contains the local one.
  def test_the_open_pull_request_head_outranks_the_local_worktree_head
    pull_request = pull(1739, head_ref: "lifeodyssey/orca-1702-lane", head_sha: LATER)
    row = row(pushed_snapshot(1702, pull_request, pushed_covers: true), 1702, now: NOW)
    assert_equal "needs-review", row.state
    assert_equal "dispatch review", row.next_action
    assert_match(/head b1b2c3d \(open PR; local worktree a1b2c3d\)/, row.facts)
  end

  # The 1702 shape: the local branch was rewritten after review, so the pull request holds a commit
  # the local head is not built on. The local head is the candidate the verdict names, and only a
  # force-push publishes it.
  def test_a_rewritten_local_head_outranks_the_stale_pull_request_head
    pull_request = pull(1739, head_ref: "lifeodyssey/orca-1702-lane", head_sha: LATER)
    remote = { "lifeodyssey/orca-1702-lane" => LATER }
    row = row(pushed_snapshot(1702, pull_request, remote: remote, pushed_covers: false),
              1702, now: NOW)
    assert_equal "ready-to-push", row.state
    assert_equal "force-push", row.next_action
    assert_match(/head a1b2c3d \(open PR at b1b2c3d\)/, row.facts)
    assert_match(/APPROVED@a1b2c3d/, row.facts)
  end

  # A verdict the candidate head does not name but still carries by patch identity: the row has to
  # say which rule made it hold, or an approval of a rebase reads as an approval of this commit.
  def test_a_patch_identical_verdict_says_which_rule_made_it_hold
    identity = FakePatchIdentity.new(identical: true)
    row = row(local_snapshot(1700, head: LATER, patch_identity: identity), 1700, now: NOW)
    assert_equal "ready-to-push", row.state
    assert_match(/APPROVED@a1b2c3d \(patch-identical at b1b2c3d\)/, row.facts)
  end
end
