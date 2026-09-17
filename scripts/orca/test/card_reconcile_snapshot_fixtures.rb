# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# A snapshot assembled from fixture records: the lanes, worktrees, pull requests and verdicts a
# derivation is run against, and the row it produces for one card.
module SnapshotFixtures
  module_function

  def snapshot(lanes: [], worktrees: [], remote_heads: {}, settled: {}, failed: {}, pull_requests: [],
               holds: {}, verdicts: [], merged_heads: {}, notes: [], patch_identity: nil)
    freshness = Orca::CardReconcile::VerdictFreshness.new(patch_identity)
    Orca::CardReconcile::Snapshot.new(lanes, worktrees, remote_heads, settled, failed, pull_requests,
                                      holds, notes, FakeVerdicts.new(verdicts, freshness: freshness),
                                      merged_heads)
  end

  # A settled card whose approved head is pushed, with the pull request state a decision is read from.
  def pushed_snapshot(card, pull, verdict: nil, local_head: ReconcileFixtures::SHA, remote: nil,
                      pushed_covers: nil)
    snapshot(lanes: [ReconcileFixtures.lane(card, [ReconcileFixtures.phase(card)])],
             settled: { "task_#{card}" => ReconcileFixtures::NOW - 600 },
             worktrees: [ReconcileFixtures.worktree(card, head: local_head,
                                                          pushed_covers: pushed_covers)],
             remote_heads: remote || { "lifeodyssey/orca-#{card}-lane" => local_head },
             pull_requests: [pull],
             verdicts: [verdict || ReconcileFixtures.verdict(card, sha: local_head)])
  end

  # A settled card with a verdict at its local head and no open pull request.
  def local_snapshot(card, kind: :approved, head: ReconcileFixtures::SHA,
                     sha: ReconcileFixtures::SHA, patch_identity: nil)
    snapshot(lanes: [ReconcileFixtures.lane(card, [ReconcileFixtures.phase(card)])],
             settled: { "task_#{card}" => ReconcileFixtures::NOW - 600 },
             worktrees: [ReconcileFixtures.worktree(card, head: head)],
             verdicts: [ReconcileFixtures.verdict(card, sha: sha, kind: kind)],
             patch_identity: patch_identity)
  end

  def row(snapshot, card, now: ReconcileFixtures::NOW)
    Orca::CardReconcile::Derivation.new(snapshot, now).rows.find { |item| item.card == card }
  end
end
