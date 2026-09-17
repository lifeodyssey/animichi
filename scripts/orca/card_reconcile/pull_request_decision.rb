# frozen_string_literal: true

module Orca
  module CardReconcile
    # The row an open pull request's own state produces once the verdict is fresh at its head, and
    # the merge-state ladder that decides it.
    class PullRequestDecision
      def initialize(facts)
        @facts = facts
      end

      def row(card, verdict, pull)
        state, action = decision(pull)
        Row.new(card, facts_text(card, verdict, pull), state, action, verdict.written_at)
      end

      private

      def facts_text(card, verdict, pull)
        "PR ##{pull.number} #{pull.merge_state}, checks #{pull.checks.text}, " \
          "#{thread_text(pull)}, " \
          "#{Short.verdict(verdict, @facts.head(card))}, " \
          "remote #{Short.sha(@facts.pulls.remote_head(card))}"
      end

      def decision(pull)
        return [States::NEEDS_FIX, "fix the failing checks"] if pull.checks.red?
        return [States::NEEDS_FIX, "resolve the merge conflict"] if pull.merge_state == "DIRTY"
        return [States::NEEDS_FIX, thread_action(pull)] if threads?(pull)
        return [States::NEEDS_FIX, "re-read the review threads"] if pull.unresolved_threads.nil?
        return [States::READY_TO_PUSH, "update the branch"] if pull.merge_state == "BEHIND"
        return [States::CI_RUNNING, "wait for CI"] unless pull.checks.green?
        return [States::MERGE_BLOCKED, blocked_action(pull)] if pull.merge_state == "BLOCKED"
        return [States::MERGEABLE, "merge"] if pull.merge_state == "CLEAN"

        [States::CI_RUNNING, "wait for GitHub to evaluate mergeability"]
      end

      def threads?(pull)
        pull.unresolved_threads.to_i.positive?
      end

      # A thread count the read never produced is a fact the row cannot claim: say so instead of
      # printing an empty count as if the review were clear.
      def thread_text(pull)
        return "threads unknown" if pull.unresolved_threads.nil?

        "#{pull.unresolved_threads} threads open"
      end

      # GitHub blocks a merge for facts the ladder cannot read: a ruleset requirement, or a branch
      # that is not up to date. This repository requires no approving review, so the row names the
      # facts it did see and sends the coordinator to the ruleset instead of waiting for an approval.
      def blocked_action(pull)
        "inspect the ruleset (#{pull.merge_state}, checks #{pull.checks.text}, " \
          "#{thread_text(pull)})"
      end

      def thread_action(pull)
        "resolve #{pull.unresolved_threads} review threads"
      end
    end
  end
end
