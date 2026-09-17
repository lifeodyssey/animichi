# frozen_string_literal: true

module Orca
  module CardReconcile
    # The row a fresh verdict produces: a fix when the verdict refuses, and otherwise the publication
    # the approved head still needs — none, a force-push over a rewritten pull request, or the pull
    # request's own state ladder.
    class VerdictRows
      def initialize(facts, decision)
        @facts = facts
        @decision = decision
      end

      def row(card, verdict)
        verdict.kind == :changes_required ? changes_row(card, verdict) : approved_row(card, verdict)
      end

      private

      def changes_row(card, verdict)
        Row.new(card, "verdict #{verdict_text(card, verdict)} in #{verdict.path}",
                States::NEEDS_FIX, "dispatch fix", verdict.written_at)
      end

      # An open pull request is the publication fact. GitHub's headRefOid is the pushed branch head,
      # so a stale or missing `git ls-remote` read cannot turn a pushed card into "push".
      def approved_row(card, verdict)
        pull = @facts.pulls.of(card)
        return publish_row(card, verdict) unless pull
        return @decision.row(card, verdict, pull) if pull.head_sha == @facts.head(card)

        push_row(card, verdict, pull)
      end

      def publish_row(card, verdict)
        action = @facts.pulls.remote_head(card) == @facts.head(card) ? "open the pull request" : "push"
        Row.new(card, "#{publication_facts(card, verdict)}, #{published_note}",
                States::READY_TO_PUSH, action, verdict.written_at)
      end

      # The local head is the candidate while the open pull request still holds another commit: the
      # verdict names a rewrite, and only a force-push publishes it.
      def push_row(card, verdict, pull)
        Row.new(card, "#{publication_facts(card, verdict)} (PR ##{pull.number})",
                States::READY_TO_PUSH, "force-push", verdict.written_at)
      end

      def publication_facts(card, verdict)
        "#{Short.head_facts(card, @facts)}, remote #{Short.sha(@facts.pulls.remote_head(card))}, " \
          "#{verdict_text(card, verdict)}"
      end

      # A failed GitHub read leaves the open pull requests unknown: say that, never "no open PR".
      def published_note
        @facts.pulls.known? ? "no open PR at this head" : "open pull requests unknown"
      end

      def verdict_text(card, verdict)
        Short.verdict(verdict, @facts.head(card))
      end
    end
  end
end
