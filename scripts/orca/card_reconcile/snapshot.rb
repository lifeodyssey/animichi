# frozen_string_literal: true

module Orca
  module CardReconcile
    Snapshot = Struct.new(:lanes, :worktrees, :remote_heads, :settled, :failed, :open_pull_requests,
                          :holds, :notes, :verdicts, :merged_heads)

    # The two heads a card can be judged at — the local worktree head and the head an open pull
    # request published — and which of them is the candidate. The pushed head outranks the local one
    # only while it contains it (an update-branch merge commit moves the pull request head and the
    # worktree stays put); otherwise the local head is the commit a verdict after a rewrite names. An
    # unknown ancestry read keeps the pushed head, so the report over-reports a review rather than
    # hiding a card.
    class CandidateHead
      attr_reader :local, :pushed

      def initialize(local, pushed, pushed_covers)
        @local = local
        @pushed = pushed
        @pushed_covers = pushed_covers
      end

      def sha
        return pushed if pushed?

        local || pushed
      end

      def diverged?
        !local.nil? && !pushed.nil? && pushed != local
      end

      def pushed?
        diverged? && @pushed_covers != false
      end
    end

    # The worktree facts of a card. The worktree belongs to the card its branch names: a lane's
    # recorded workspace does not decide this, because one worktree can serve another card's branch.
    class WorktreeFacts
      def initialize(snapshot)
        @worktrees = snapshot.worktrees
      end

      def worktree(card)
        @worktrees.find { |item| BranchNames.card_of(item.branch) == card }
      end

      def head(card)
        item = worktree(card)
        item && item.head
      end

      def head_at(card)
        item = worktree(card)
        item && item.head_at
      end

      def dirty_count(card)
        item = worktree(card)
        item ? item.dirty.to_i : 0
      end

      def newest_change_at(card)
        item = worktree(card)
        item && item.newest_change_at
      end

      def branch(card)
        item = worktree(card)
        item && item.branch
      end

      # True when the pushed head has this card's head in its history, false when the branch was
      # rewritten under the push, and nil when the read is unknown.
      def pushed_covers?(card)
        item = worktree(card)
        item && item.pushed_covers
      end
    end

    # Which of a card's tasks Orca settled, and which of them reported a failure. Settlement is the
    # Run's task status; the mailbox only corroborates it.
    class SettlementFacts
      def initialize(snapshot)
        @lanes = snapshot.lanes
        @settled = snapshot.settled
        @failed = snapshot.failed
      end

      def settled_at(card)
        phases(card).map { |phase| @settled[phase.task_id] }.compact.max
      end

      # True when any phase of the card settled: the lane delivered, whichever phase did it.
      def settled_card?(card)
        phases(card).any? { |phase| settled_task?(phase.task_id) }
      end

      def settled_task?(task_id)
        !task_id.nil? && @settled.key?(task_id)
      end

      def failed_task?(task_id)
        !task_id.nil? && @failed.key?(task_id)
      end

      private

      def phases(card)
        lane = @lanes.find { |item| item.card == card }
        lane ? lane.phases : []
      end
    end

    # The open pull request of a card: which branch the card publishes through, where that branch's
    # head is on the remote, and the branch the pull request is stacked on.
    class PullRequestFacts
      def initialize(snapshot)
        @pulls = snapshot.open_pull_requests
        @remote_heads = snapshot.remote_heads
        @worktrees = WorktreeFacts.new(snapshot)
      end

      # `nil` means the open pull request list is unknown, which is not the same as empty.
      def known?
        !@pulls.nil?
      end

      def of(card)
        @pulls.to_a.find { |pull| BranchNames.card_of(pull.head_ref) == card }
      end

      # The worktree's own branch, or the head branch of the pull request when no worktree serves the
      # card.
      def branch(card)
        @worktrees.branch(card) || of(card)&.head_ref
      end

      def remote_head(card)
        branch = branch(card)
        branch && @remote_heads[branch]
      end

      # The patch-identity base a verdict of this card is compared against: a stack's pull request is
      # reviewed against its own base branch, everything else against main.
      def base(card)
        branch = of(card)&.base_ref
        branch ? "origin/#{branch}" : GitFacts::BASE
      end
    end

    # The snapshot record that belongs to a card, and the facts that combine records.
    class Facts
      attr_reader :worktrees, :settlement, :pulls

      def initialize(snapshot)
        @snapshot = snapshot
        @worktrees = WorktreeFacts.new(snapshot)
        @settlement = SettlementFacts.new(snapshot)
        @pulls = PullRequestFacts.new(snapshot)
      end

      def cards
        (lane_cards + worktree_cards + pull_request_cards).uniq.sort
      end

      def lane(card)
        @snapshot.lanes.find { |item| item.card == card }
      end

      def phases(card)
        item = lane(card)
        item ? item.phases : []
      end

      def candidate(card)
        CandidateHead.new(@worktrees.head(card), @pulls.of(card)&.head_sha,
                          @worktrees.pushed_covers?(card))
      end

      def head(card)
        candidate(card).sha
      end

      def verdict(card)
        item = lane(card)
        return nil unless item

        @snapshot.verdicts.fresh(item, head(card), @pulls.base(card))
      end

      def hold(card)
        @snapshot.holds[card]
      end

      private

      def lane_cards
        @snapshot.lanes.map(&:card)
      end

      def worktree_cards
        @snapshot.worktrees.map { |item| BranchNames.card_of(item.branch) }.compact
      end

      def pull_request_cards
        @snapshot.open_pull_requests.to_a
                 .map { |pull| BranchNames.card_of(pull.head_ref) }.compact
      end
    end
  end
end
