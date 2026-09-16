# frozen_string_literal: true

module Orca
  module CardReconcile
    # Whether a card is worth a row at all. A card whose lane left work running, whose worktree has
    # uncommitted files, or whose head is merged is done; a settled lane with no worktree, branch,
    # pull request, verdict or hold left is history rather than a stuck card.
    class CardVisibility
      def initialize(facts, merged_heads)
        @facts = facts
        @merged_heads = merged_heads
      end

      def hidden?(card)
        complete?(card) || invisible?(card)
      end

      private

      def complete?(card)
        return false if @facts.phases(card).any?(&:running?)
        return false if @facts.worktrees.dirty_count(card).positive?

        merged?(card)
      end

      # The head this card is judged at is one GitHub already merged.
      def merged?(card)
        head = @facts.head(card)
        !head.nil? && @merged_heads.key?(head)
      end

      def invisible?(card)
        !has_evidence?(card) && fully_settled?(card)
      end

      def has_evidence?(card)
        @facts.phases(card).any?(&:running?) || @facts.head(card) || @facts.pulls.of(card) ||
          @facts.verdict(card) || @facts.hold(card)
      end

      # Every phase of the lane settled, so no phase is still owed a receipt.
      def fully_settled?(card)
        phases = @facts.phases(card)
        !phases.empty? && phases.all? { |phase| @facts.settlement.settled_task?(phase.task_id) }
      end
    end
  end
end
