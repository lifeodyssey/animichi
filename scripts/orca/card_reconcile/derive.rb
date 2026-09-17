# frozen_string_literal: true

module Orca
  module CardReconcile
    # The row ladder: the first rule that fires decides a card's state and next action. A hold and a
    # review dispatch are derived here; a lane's own runner state, a verdict's own publication and an
    # open pull request's own state live with the class that owns them.
    class Derivation
      def initialize(snapshot, now)
        @facts = Facts.new(snapshot)
        @now = now
        @visibility = CardVisibility.new(@facts, snapshot.merged_heads)
        @lanes = LaneRows.new(@facts)
        @verdicts = VerdictRows.new(@facts, PullRequestDecision.new(@facts))
      end

      def rows
        @facts.cards.reject { |card| @visibility.hidden?(card) }.map { |card| row(card) }
      end

      def row(card)
        hold_row(card) || @lanes.row(card) || verdict_row(card) || review_row(card)
      end

      private

      def hold_row(card)
        hold = @facts.hold(card)
        return nil unless hold
        return Row.new(card, hold_facts(hold), States::HELD, "\u2014", hold.since) unless hold.satisfied

        Row.new(card, hold_facts(hold), States::STALE_HOLD, "release the hold", hold.since)
      end

      def hold_facts(hold)
        detail = hold.detail || "#{hold.predicate} #{hold.target.inspect}"
        "hold: #{detail} [#{hold.satisfied ? 'satisfied' : 'unsatisfied'}]"
      end

      def verdict_row(card)
        verdict = @facts.verdict(card)
        return nil unless verdict

        @verdicts.row(card, verdict)
      end

      def review_row(card)
        Row.new(card, review_facts(card), States::NEEDS_REVIEW, "dispatch review",
                review_since(card))
      end

      def review_since(card)
        @facts.worktrees.head_at(card) || @facts.pulls.of(card)&.updated_at ||
          @facts.settlement.settled_at(card)
      end

      def review_facts(card)
        head = @facts.head(card)
        pull = @facts.pulls.of(card)
        return "no local worktree, head #{Short.sha(pull.head_sha)} has no verdict" if head.nil? && pull

        "#{Short.head_facts(card, @facts)}, no verdict for this head"
      end
    end
  end
end
