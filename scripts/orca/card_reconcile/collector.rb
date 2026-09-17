# frozen_string_literal: true

module Orca
  module CardReconcile
    Config = Struct.new(:repo_root, :lanes_root, :repository, :terminal, :run, :holds_path, :clock)

    class RunBinding
      def initialize(config, lanes)
        @config = config
        @lanes = lanes
      end

      def terminal
        @config.terminal || newest && newest.coordinator
      end

      def run_id
        @config.run || newest && newest.run_id
      end

      private

      def newest
        @newest ||= @lanes.flat_map(&:phases).max_by { |phase| phase.launched_at.to_s }
      end
    end

    # The open and merged pull requests, with the review-thread count of each open one. A failed
    # `gh` read leaves the open list unknown rather than empty.
    class PullRequestSource
      def initialize(repository, command, notes)
        @github = GitHubFacts.new(command, repository, notes)
      end

      def open
        pulls = @github.open_pull_requests
        Array(pulls).each { |pull| count_threads(pull) }
        pulls
      end

      # The head an open pull request published for each branch: the ancestry read is only
      # interesting where a push moved the branch away from the worktree.
      def heads(pulls)
        Array(pulls).each_with_object({}) { |pull, result| result[pull.head_ref] = pull.head_sha }
      end

      def merged
        @github.merged_heads
      end

      def state(number)
        @github.state(number)
      end

      private

      def count_threads(pull)
        pull.unresolved_threads = @github.unresolved_threads(pull.number) if card_of(pull)
      end

      def card_of(pull)
        BranchNames.card_of(pull.head_ref)
      end
    end

    class Collector
      def initialize(config, command)
        @config = config
        @command = command
        @notes = []
      end

      def snapshot
        store = HoldStore.new(@config.holds_path).load
        lanes = read_lanes
        open = pull_requests.open
        trees = git.worktrees(pull_requests.heads(open))
        settled, failed = settlement(lanes)
        snapshot = Snapshot.new(lanes, trees, remotes, settled, failed, open, store, @notes,
                                verdicts, pull_requests.merged)
        evaluate(snapshot)
        snapshot
      end

      private

      # A lane directory carries the number of the card it served and is never re-keyed; only the
      # worktree name drifts. A worktree belongs to the card its branch names (WorktreeFacts#worktree).
      def read_lanes
        @lanes ||= LaneReader.new(@config.lanes_root, ProcessProbe.new(@command, @notes)).lanes
      end

      def git
        @git ||= GitFacts.new(@command, @config.repo_root, @notes)
      end

      def remotes
        git.remote_heads
      end

      def verdicts
        @verdicts ||= VerdictReader.new(@config.lanes_root, PatchIdentity.new(git))
      end

      def pull_requests
        @pull_requests ||= PullRequestSource.new(@config.repository, @command, @notes)
      end

      def settlement(lanes)
        binding = RunBinding.new(@config, lanes)
        reader = Settlement.new(@command, binding.run_id, @notes)
        [reader.settled(mailbox(binding)), reader.failed]
      end

      # The mailbox is corroboration only: a Run-scoped check is fenced and the recipient inbox is
      # capped, so its messages cannot settle a task. Settlement.new reads the Run's tasks.
      def mailbox(binding)
        reader = Mailbox.new(@command, binding.terminal, binding.run_id)
        result = reader.settled
        reader.failures.each { |failure| @notes << "mailbox: #{failure}" }
        result
      rescue Failure => error
        @notes << "mailbox: #{error.message}"
        {}
      end

      def evaluate(snapshot)
        evaluator = HoldEvaluator.new(snapshot.open_pull_requests, pull_requests.method(:state))
        snapshot.holds.each_value { |hold| evaluator.evaluate(hold) }
      end
    end
  end
end
