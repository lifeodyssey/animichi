# frozen_string_literal: true

module Orca
  module CardReconcile
    # The rows a lane's own runner state produces, in the order they outrank each other: a live
    # runner, a worker that reported a failure, a dead runner that never reported, and uncommitted
    # work a settled worker left behind.
    class LaneRows
      def initialize(facts)
        @facts = facts
      end

      def row(card)
        running_row(card) || failed_row(card) || undelivered_row(card) || harvest_row(card)
      end

      private

      def running_row(card)
        phase = @facts.phases(card).find(&:running?)
        return nil unless phase

        Row.new(card, "lane #{phase.name} running since #{Short.stamp(phase.launched_at)}",
                States::RUNNING, "\u2014", phase.since)
      end

      # A worker that reported `failed` delivered its outcome: the lane is not undelivered and there
      # is no missing worker_done to flag. The newest phase decides, so a lane that moved on after an
      # older failure is judged by its newest work.
      def failed_row(card)
        phase = @facts.phases(card).last
        return nil unless phase && @facts.settlement.failed_task?(phase.task_id)

        Row.new(card, "lane #{phase.name} reported failed", States::DELIVERED_FAILED,
                "dispatch fix", phase.since)
      end

      def undelivered_row(card)
        phase = @facts.phases(card).reverse.find { |item| item.dead? && unsettled?(item) }
        return nil unless phase

        Row.new(card, "lane #{phase.name} exited #{Short.stamp(phase.exited_at)}, no worker_done",
                States::UNDELIVERED, "re-dispatch or settle the lane", phase.since)
      end

      def harvest_row(card)
        count = @facts.worktrees.dirty_count(card)
        return nil unless count.positive? && @facts.settlement.settled_card?(card)

        Row.new(card, "worker_done, #{count} uncommitted files, #{Short.head_facts(card, @facts)}",
                States::READY_TO_HARVEST, "commit and push",
                @facts.worktrees.newest_change_at(card))
      end

      def unsettled?(phase)
        !@facts.settlement.settled_task?(phase.task_id)
      end
    end
  end
end
