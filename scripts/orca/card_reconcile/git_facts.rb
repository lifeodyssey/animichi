# frozen_string_literal: true

module Orca
  module CardReconcile
    Worktree = Struct.new(:path, :branch, :head, :head_at, :ahead, :dirty, :newest_change_at,
                          :pushed_covers) do
      def dirty?
        dirty.to_i.positive?
      end

      def detached?
        branch.nil? || branch.empty?
      end
    end

    module BranchNames
      CARD = %r{\Alifeodyssey/orca-(\d+)(?=[-/]|\z)}.freeze

      module_function

      def card_of(branch)
        match = CARD.match(branch.to_s)
        match && Integer(match[1], 10)
      end
    end

    class GitFacts
      BASE = "origin/main".freeze

      attr_reader :root

      def initialize(command, root, notes)
        @command = command
        @root = root
        @notes = notes
      end

      # A git read of this repository whose failure the caller answers itself: `PatchIdentity` treats
      # any git failure as "not fresh". The failure is still noted, so the report says why a verdict
      # stopped holding.
      def read(argv, label, stdin = nil)
        @command.capture(["git", "-C", @root, *argv], label, stdin)
      rescue Failure => error
        @notes << error.message
        raise
      end

      # A read whose exit status *is* its answer (`merge-base --is-ancestor`: 0 yes, 1 no). A
      # definitive "no" is an answer rather than a degraded source, so only the reads that are
      # neither are noted; nil means the answer is unreadable and must not be read as false.
      def answer(argv, label)
        @command.capture(["git", "-C", @root, *argv], label)
        true
      rescue Failure => error
        return false if error.status == 1

        @notes << error.message
        nil
      end

      # `pushed_heads` maps a branch to the head an open pull request published, so a worktree can
      # say whether that push still contains its head.
      def worktrees(pushed_heads = {})
        WorktreeReader.new(self).worktrees(pushed_heads)
      end

      def remote_heads(remote = "origin")
        capture(["git", "-C", @root, "ls-remote", "--heads", remote], "git ls-remote")
          .each_line
          .each_with_object({}) { |line, heads| remember_head(heads, line) }
      end

      # The tolerant read: a failed command is noted and read as empty output. `read` is the strict
      # one, for a caller that answers the failure itself.
      def capture(argv, label)
        @command.capture(argv, label)
      rescue Failure => error
        @notes << error.message
        ""
      end

      private

      def remember_head(heads, line)
        sha, ref = line.strip.split("\t", 2)
        return unless sha && ref

        heads[ref.sub(%r{\Arefs/heads/}, "")] = sha
      end
    end

    # The worktrees of the repository, read from `git worktree list --porcelain`: each one's branch
    # and head, how far it is ahead of main, its uncommitted changes, and — for a branch an open pull
    # request published — whether that push still contains the worktree's head.
    class WorktreeReader
      def initialize(git)
        @git = git
      end

      def worktrees(pushed_heads = {})
        blocks.map { |block| worktree(block, pushed_heads) }
      end

      private

      def blocks
        @git.capture(["git", "-C", @git.root, "worktree", "list", "--porcelain"], "git worktree list")
            .split("\n\n")
            .map { |block| attributes(block) }
            .reject { |item| item.empty? }
      end

      def attributes(block)
        block.each_line.each_with_object({}) do |line, result|
          key, value = line.strip.split(" ", 2)
          result[key] = value if key && value
        end
      end

      def worktree(attributes, pushed_heads)
        path = attributes["worktree"]
        branch = attributes["branch"].to_s.sub(%r{\Arefs/heads/}, "")
        head = attributes["HEAD"]
        ahead, head_at = ahead_facts(path)
        changes = WorktreeChanges.new(path, status(path))
        Worktree.new(path, branch, head, head_at, ahead, changes.count, changes.newest_change_at,
                     covers(head, pushed_heads[branch]))
      end

      def status(path)
        @git.capture(["git", "-C", path, "status", "--porcelain"], "git status")
      end

      # True when the pushed head has this head in its history (an update-branch merge commit sits on
      # top of it), false when the branch was rewritten under the push, and nil when the read is
      # unknown. A caller must never read nil as false: the pushed head keeps outranking the local
      # one, so an unreadable fact over-reports rather than hiding a card.
      def covers(head, pushed)
        return nil if pushed.nil? || pushed == head

        ancestor?(head, pushed)
      end

      def ancestor?(ancestor, descendant)
        @git.answer(["merge-base", "--is-ancestor", ancestor, descendant],
                    "git merge-base --is-ancestor")
      end

      def ahead_facts(path)
        count = @git.capture(["git", "-C", path, "rev-list", "--count", "#{GitFacts::BASE}..HEAD"],
                             "git rev-list")
        [count.strip.to_i, head_time(path)]
      end

      def head_time(path)
        Shape.time(@git.capture(["git", "-C", path, "log", "-1", "--format=%cI"], "git log").strip)
      end
    end

    # The uncommitted changes of one worktree: how many paths differ from the index, and when the
    # newest of them was written. A projection of `git status --porcelain`, so it can be read without
    # git, and a path that has since disappeared is simply not dated.
    class WorktreeChanges
      def initialize(root, porcelain)
        @root = root
        @porcelain = porcelain
      end

      def count
        paths.length
      end

      def newest_change_at
        paths.map { |path| mtime(path) }.compact.max
      end

      private

      def paths
        @paths ||= @porcelain.each_line.map { |line| changed_path(line) }.compact
      end

      # `XY path`, with renames reported as `old -> new`: the path that is on disk is the new one.
      def changed_path(line)
        text = line.strip
        return nil if text.length < 4

        path = text[3..-1].to_s.split(" -> ").last.to_s.strip
        path.empty? ? nil : path
      end

      def mtime(path)
        File.mtime(File.join(@root, path))
      rescue SystemCallError
        nil
      end
    end

    # Verdict freshness by patch identity: a verdict survives a rebase that leaves the same patches
    # in the same order — the machine-checked equivalent of the pipeline's `range-diff` rule — and
    # nothing else does. New content, a merge commit, a missing object or a failed git read all mean
    # "not fresh", so the report over-reports instead of going quiet.
    class PatchIdentity
      def initialize(git)
        @git = git
      end

      def fresh?(sha, head, base)
        return false if sha.nil? || head.nil? || !commit?(sha)
        return false unless merges(base, head).empty?

        patches = patch_ids(base, sha)
        !patches.empty? && patches == patch_ids(base, head)
      rescue Failure
        false
      end

      private

      def commit?(sha)
        @git.read(["cat-file", "-e", "#{sha}^{commit}"], "git cat-file -e")
        true
      end

      def merges(base, head)
        @git.read(["rev-list", "--merges", "#{base}..#{head}"], "git rev-list --merges")
            .lines
      end

      # `git cherry` marks with `+` the commits whose patch the base does not already carry; those are
      # the commits the ref adds, and their patch ids in order are what a rebase leaves unchanged.
      def patch_ids(base, ref)
        added_commits(base, ref).map { |commit| patch_id(commit) }.compact
      end

      def added_commits(base, ref)
        @git.read(["cherry", base, ref], "git cherry").lines.map(&:strip)
            .select { |line| line.start_with?("+ ") }
            .map { |line| line[2, line.length].to_s }
      end

      # One id per commit: `git patch-id` reads a stream of patches as a single patch, so each
      # commit's own diff goes in on its own. A commit with no diff adds no patch and no id.
      def patch_id(commit)
        patch = @git.read(["show", "--format=", "--no-color", commit], "git show")
        @git.read(["patch-id", "--stable"], "git patch-id", patch).split(" ").first
      end
    end
  end
end
