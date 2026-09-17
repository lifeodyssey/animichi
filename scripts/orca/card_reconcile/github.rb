# frozen_string_literal: true

require "json"

module Orca
  module CardReconcile
    Checks = Struct.new(:passed, :failed, :pending) do
      def total
        passed + failed + pending
      end

      def green?
        failed.zero? && pending.zero?
      end

      def red?
        failed.positive?
      end

      def text
        "#{passed}/#{total} green"
      end
    end

    PullRequest = Struct.new(:number, :state, :merge_state, :head_sha, :head_ref, :base_ref,
                             :checks, :unresolved_threads, :files, :files_truncated, :updated_at) do
      # A row of `gh pr list`, with the file list a hold is proved against. A full page is truncated
      # evidence, which can never prove a hold released.
      def self.from_gh(item)
        files = Array(item["files"]).map { |file| file["path"].to_s }
        new(item["number"], item["state"], item["mergeStateStatus"], item["headRefOid"],
            item["headRefName"], item["baseRefName"],
            CheckStates.summarize(item["statusCheckRollup"]), 0, files, files.length >= 100,
            Shape.time(item["updatedAt"]))
      end

      def open?
        state == "OPEN"
      end
    end

    module CheckStates
      PASSED = %w[SUCCESS NEUTRAL SKIPPED].freeze
      FAILED = %w[FAILURE TIMED_OUT CANCELLED ACTION_REQUIRED STARTUP_FAILURE ERROR STALE].freeze

      module_function

      def classification(entry)
        value = (entry["conclusion"] || entry["state"]).to_s.upcase
        return :passed if PASSED.include?(value)
        return :failed if FAILED.include?(value)

        :pending
      end

      def summarize(rollup)
        counts = Array(rollup).each_with_object(Hash.new(0)) do |entry, result|
          result[classification(entry)] += 1
        end
        Checks.new(counts[:passed], counts[:failed], counts[:pending])
      end
    end

    class GitHubFacts
      LIST_FIELDS = %w[number state mergeStateStatus headRefName headRefOid baseRefName
                       statusCheckRollup files updatedAt].join(",").freeze

      attr_reader :repository, :notes

      def initialize(command, repository, notes)
        @command = command
        @repository = repository
        @notes = notes
      end

      # The `gh` JSON read, shared with the specialized queries below.
      def json(argv)
        JSON.parse(@command.capture(argv, "gh"))
      rescue JSON::ParserError => error
        raise Failure, "gh returned malformed JSON: #{error.message}"
      end

      # `nil` means the open pull request list is unknown (the `gh` read failed), which is not the
      # same as empty: a failed source may add rows but it must never satisfy a hold predicate.
      def open_pull_requests(limit = 100)
        Array(json(list_argv(limit))).map { |item| PullRequest.from_gh(item) }
      rescue Failure => error
        @notes << error.message
        nil
      end

      def merged_heads(limit = 100)
        Array(json(merged_argv(limit))).each_with_object({}) do |item, result|
          result[item["headRefOid"]] = item["headRefName"]
        end
      rescue Failure => error
        @notes << error.message
        {}
      end

      def unresolved_threads(number)
        threads.unresolved(number)
      end

      def threads
        @threads ||= ReviewThreads.new(self)
      end

      def state(number)
        document = Shape.hash!(json(["gh", "pr", "view", number.to_s, "--repo", @repository,
                                     "--json", "state"]), "gh pr view")
        document.fetch("state")
      rescue Failure, KeyError => error
        @notes << "pull request ##{number} state unavailable: #{error.message}"
        nil
      end

      private

      def list_argv(limit)
        ["gh", "pr", "list", "--repo", @repository, "--state", "open", "--limit", limit.to_s,
         "--json", LIST_FIELDS]
      end

      def merged_argv(limit)
        ["gh", "pr", "list", "--repo", @repository, "--state", "merged", "--limit", limit.to_s,
         "--json", "headRefName,headRefOid"]
      end

    end

    # The unresolved review threads of one pull request, read from the review-threads GraphQL query.
    # A read that fails is unknown (`nil`), never zero: the merge ladder reads a thread count as a
    # clear review, and a failed source must add work, not satisfy the gate.
    class ReviewThreads
      QUERY = <<~GRAPHQL.freeze
        query CardThreads($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved } } }
          }
        }
      GRAPHQL

      def initialize(github)
        @github = github
      end

      def unresolved(number)
        nodes(number).count { |thread| thread["isResolved"] == false }
      rescue Failure, KeyError, NoMethodError => error
        @github.notes << "review threads for ##{number} unavailable: #{error.message}"
        nil
      end

      private

      def nodes(number)
        data = Shape.hash!(@github.json(graphql_argv(number)), "gh api graphql")
        data.dig("data", "repository", "pullRequest", "reviewThreads").fetch("nodes")
      end

      def graphql_argv(number)
        ["gh", "api", "graphql", "-f", "query=#{QUERY}", "-f", "owner=#{owner}",
         "-f", "name=#{name}", "-F", "number=#{number}"]
      end

      def owner
        @github.repository.split("/", 2).first
      end

      def name
        @github.repository.split("/", 2).last
      end
    end
  end
end
