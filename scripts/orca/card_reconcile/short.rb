# frozen_string_literal: true

module Orca
  module CardReconcile
    # The text a row prints: short SHAs, a verdict with the rule that made it hold, both heads of a
    # card whose pull request and worktree disagree, and a clock stamp.
    module Short
      module_function

      def sha(value)
        value ? value.to_s[0, 7] : "unknown"
      end

      # A verdict that names the head needs no note; one whose commits the head still carries says
      # which rule made it hold.
      def verdict(verdict, head)
        name = verdict.kind == :approved ? "APPROVED" : "CHANGES REQUIRED"
        text = "#{name}@#{sha(verdict.sha)}"
        return text if verdict.names?(head)

        "#{text} (patch-identical at #{sha(head)})"
      end

      # The row names both heads when the pull request and the worktree disagree, and says which one
      # is the candidate.
      def head_facts(card, facts)
        head = facts.candidate(card)
        return "head #{sha(head.sha)}" unless head.diverged?
        return "head #{sha(head.sha)} (open PR; local worktree #{sha(head.local)})" if head.pushed?

        "head #{sha(head.sha)} (open PR at #{sha(head.pushed)})"
      end

      def stamp(time)
        time ? time.utc.strftime("%H:%MZ") : "unknown"
      end
    end
  end
end
