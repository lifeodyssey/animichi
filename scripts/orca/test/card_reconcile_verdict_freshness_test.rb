# frozen_string_literal: true

require_relative "card_reconcile_snapshot_fixtures"
require_relative "fake_patch_identity"

# Whether one read verdict holds for a head: the one that names it, or the one whose commits the
# head still carries, and which base a stacked card is compared against.
class VerdictFreshnessTest < Minitest::Test
  include ReconcileFixtures
  include SnapshotFixtures

  NAMED = "3c9d1f330961d73d3270c623be1f5fa77d51b86b".freeze
  HEAD = "b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4".freeze

  def test_a_verdict_that_names_the_head_is_fresh
    freshness = Orca::CardReconcile::VerdictFreshness.new(FakePatchIdentity.new)
    assert_equal NAMED, freshness.pick([named_verdict], NAMED, "origin/main").sha
  end

  # The patch question is asked with the verdict's commit first and the candidate head second: a
  # merge commit on top of the reviewed one drops the verdict only in that order.
  def test_a_verdict_whose_patches_the_head_carries_is_fresh
    identity = FakePatchIdentity.new(identical: true)
    freshness = Orca::CardReconcile::VerdictFreshness.new(identity)
    verdict = freshness.pick([named_verdict], HEAD, "origin/main")
    assert_equal NAMED, verdict.sha
    assert_equal [[NAMED, HEAD, "origin/main"]], identity.calls
  end

  def test_a_verdict_whose_patches_the_head_lost_is_not_fresh
    freshness = Orca::CardReconcile::VerdictFreshness.new(FakePatchIdentity.new(identical: false))
    assert_nil freshness.pick([named_verdict], HEAD, "origin/main")
  end

  def test_without_a_patch_read_only_the_head_a_verdict_names_is_fresh
    freshness = Orca::CardReconcile::VerdictFreshness.new
    assert_equal NAMED, freshness.pick([named_verdict], NAMED, "origin/main").sha
    assert_nil freshness.pick([named_verdict], HEAD, "origin/main")
  end

  # A stack's pull request is reviewed against its own base branch, not against main.
  def test_a_stacked_card_compares_against_the_pull_request_base_branch
    identity = FakePatchIdentity.new
    pull_request = pull(1713, head_ref: "lifeodyssey/orca-1695-lane", head_sha: HEAD,
                               base_ref: "lifeodyssey/orca-1718-lane")
    snapshot = snapshot(lanes: [lane(1695, [phase(1695)])], settled: { "task_1695" => NOW - 600 },
                        pull_requests: [pull_request], worktrees: [worktree(1695, head: HEAD)],
                        patch_identity: identity, verdicts: [named_verdict])
    Orca::CardReconcile::Derivation.new(snapshot, NOW).rows
    assert_equal ["origin/lifeodyssey/orca-1718-lane"], identity.bases
  end

  private

  def named_verdict
    Orca::CardReconcile::Verdict.new("animichi-lane-1702/review-round-6.md", NAMED, :approved,
                                     NOW - 600)
  end
end
