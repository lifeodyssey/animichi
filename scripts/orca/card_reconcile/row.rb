# frozen_string_literal: true

module Orca
  module CardReconcile
    Row = Struct.new(:card, :facts, :state, :next_action, :stuck_since) do
      def stuck_seconds(now)
        return nil if stuck_since.nil?

        [now - stuck_since, 0.0].max
      end
    end

    module States
      RUNNING = "running".freeze
      UNDELIVERED = "undelivered".freeze
      DELIVERED_FAILED = "delivered-failed".freeze
      READY_TO_HARVEST = "ready-to-harvest".freeze
      NEEDS_REVIEW = "needs-review".freeze
      READY_TO_PUSH = "ready-to-push".freeze
      CI_RUNNING = "ci-running".freeze
      NEEDS_FIX = "needs-fix".freeze
      MERGEABLE = "mergeable".freeze
      MERGE_BLOCKED = "merge-blocked".freeze
      HELD = "held".freeze
      STALE_HOLD = "stale-hold".freeze
      ALL = [RUNNING, UNDELIVERED, DELIVERED_FAILED, READY_TO_HARVEST, NEEDS_REVIEW, READY_TO_PUSH,
             CI_RUNNING, NEEDS_FIX, MERGEABLE, MERGE_BLOCKED, HELD, STALE_HOLD].freeze
    end
  end
end
