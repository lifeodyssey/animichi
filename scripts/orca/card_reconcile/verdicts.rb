# frozen_string_literal: true

module Orca
  module CardReconcile
    Verdict = Struct.new(:path, :sha, :kind, :written_at) do
      # The verdict names this commit: the reviewer pinned it as the one under review.
      def names?(head)
        !head.nil? && !sha.nil? && head.start_with?(sha)
      end
    end

    # The commit a verdict file reviewed. A `Candidate` line wins over a line that merely names a
    # head; among candidate lines the last wins, because a file that lists several commits of one
    # round ends at its tip. A `fix` line is the last resort: the fix commit is what such a file is
    # about, and it is only read when no candidate or head line binds a commit.
    module CandidateCommit
      SHA = /\b[0-9a-f]{7,40}\b/.freeze
      CANDIDATE = /candidate|候选/i.freeze
      HEAD = /\bhead\b|tip/i.freeze
      FIX = /\bfix(?:\s+under\s+review|\s+commit)?\b/i.freeze
      # A word that gives the commit another role: it is a parent, a base, or an earlier round's
      # commit, never the one under review.
      SUPERSEDED = /\b(parent|base|previous|prior|earlier|compared)\b|round[-\s]?\d|第[一二三四五六七八九十\d]+轮/i.freeze
      # The same words between the keyword and the commit. `round N` is not one of them: a
      # parenthetical about the candidate itself ("Candidate `HEAD` (round 2, amended)") qualifies
      # the round under review instead of superseding it, and only a word before the keyword does.
      ROLE_BETWEEN = /\b(parent|base|previous|prior|earlier|compared)\b/i.freeze
      SUPERSEDED_WINDOW = 40
      RANGE = "..".freeze

      module_function

      def sha(text)
        lines = text.each_line.map(&:strip).reject(&:empty?)
        pick(lines, CANDIDATE, last: true) || pick(lines, HEAD, last: false) ||
          pick(lines, FIX, last: false)
      end

      def pick(lines, pattern, last:)
        commits = lines.map { |line| commit_in(line, pattern) }.compact
        last ? commits.last : commits.first
      end

      # The commit the line names for this keyword, or nil when that commit is marked as an earlier
      # round, the parent or the base of the one under review.
      def commit_in(line, pattern)
        keyword = pattern.match(line)
        return nil unless keyword

        commit = named_commit(line[keyword.end(0)..].to_s)
        return nil unless commit

        at = line.index(commit, keyword.end(0))
        return nil if superseded?(line, keyword, at)

        commit
      end

      # A range names its end — `origin/main...HEAD` is reviewed at HEAD — so a commit that opens one
      # is skipped and the commit it ranges to is read in its place.
      def named_commit(text)
        match = SHA.match(text)
        return nil unless match
        return match[0] unless range_start?(text, match)

        named_commit(text[match.end(0)..].to_s)
      end

      def range_start?(text, match)
        text[match.end(0), RANGE.length] == RANGE
      end

      def superseded?(line, keyword, at)
        start = keyword.begin(0)
        before = line[[start - SUPERSEDED_WINDOW, 0].max...start].to_s
        between = line[keyword.end(0)...at].to_s
        SUPERSEDED.match?(before) || ROLE_BETWEEN.match?(between)
      end
    end

    # The verdict a file states. A heading, or a line that states it outright, outranks a passing
    # mention in prose, which may quote another round's verdict.
    module VerdictKind
      APPROVED = /APPROVED/i.freeze
      CHANGES = /CHANGES\s+REQUIRED/i.freeze
      DECLARATION = /verdict|结论/i.freeze
      DECLARED = /\A[#>*\s]*(APPROVED|CHANGES\s+REQUIRED)\b/i.freeze
      # A declaration marked as another round's history: it is evidence of a past state, never the
      # verdict this file states now.
      HISTORY = /\b(previous|prior|earlier)\b/i.freeze

      module_function

      def kind(text)
        declared_kind(text) || stated_kind(text)
      end

      def lines(text)
        text.each_line.map(&:strip).reject(&:empty?)
      end

      def declared_kind(text)
        lines(text).each do |line|
          next unless DECLARATION.match?(line) || DECLARED.match?(line)
          next if HISTORY.match?(line)

          found = sole_kind(line)
          return found if found
        end
        nil
      end

      def stated_kind(text)
        lines(text).each do |line|
          found = sole_kind(line)
          return found if found
        end
        nil
      end

      def sole_kind(line)
        approved = APPROVED.match?(line)
        changes = CHANGES.match?(line)
        return :approved if approved && !changes
        return :changes_required if changes && !approved

        nil
      end
    end

    # Which verdict still holds for a head: one that names it, or one whose commits are the patches
    # the head still carries (a rebase of the same content). Reading newest first returns the same
    # verdict `select { fresh }.last` did, and stops before asking git when the newest verdict names
    # the head. `Verdict#names?` tells the row text which of the two rules held.
    class VerdictFreshness
      def initialize(identity = nil)
        @identity = identity
      end

      def pick(verdicts, head, base)
        verdicts.reverse_each do |verdict|
          return verdict if verdict.names?(head)
          return verdict if identical?(verdict, head, base)
        end
        nil
      end

      private

      def identical?(verdict, head, base)
        return false if @identity.nil? || verdict.sha.nil?

        @identity.fresh?(verdict.sha, head, base)
      end
    end

    class VerdictReader
      # A verdict document states a verdict. The name keeps assignments (`brief`), evidence
      # (`report`) and specs out even when they quote a verdict line; running a heading rule over
      # every `*.md` file in the lane directory instead of a filename pattern is what finds
      # `grok-review-round-2.md` and `review-cr.md`.
      NAME = /review/i.freeze
      NOT_A_VERDICT = /brief|report|spec/i.freeze

      def initialize(root, identity = nil)
        @root = root
        @freshness = VerdictFreshness.new(identity)
      end

      def verdicts(lane)
        verdict_paths(lane).map { |path| verdict(path) }.compact.sort_by(&:written_at)
      end

      def fresh(lane, head, base)
        @freshness.pick(verdicts(lane), head, base)
      end

      private

      def verdict_paths(lane)
        lane.dirs.flat_map { |dir| Dir.glob(File.join(dir, "*.md")) }
            .select { |path| document?(path) }
            .sort
      end

      def document?(path)
        name = File.basename(path)
        NAME.match?(name) && !NOT_A_VERDICT.match?(name)
      end

      def verdict(path)
        text = Receipt.read_text(path)
        return nil unless text

        sha = CandidateCommit.sha(text)
        kind = VerdictKind.kind(text)
        return nil unless sha && kind

        Verdict.new(relative(path), sha, kind, File.mtime(path))
      rescue SystemCallError
        nil
      end

      def relative(path)
        path.sub(/\A#{Regexp.escape(@root)}\/?/, "")
      end
    end
  end
end
