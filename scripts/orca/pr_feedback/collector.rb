# frozen_string_literal: true

require "time"

module Orca
  module PrFeedback
    class FeedbackReader
      def initialize(client, repository, number)
        @client = client
        @variables = { "owner" => repository.owner, "name" => repository.name,
                       "number" => number }
      end

      def comments
        nodes = pager(Queries::COMMENTS, "comments", "top-level comments").fetch
        nodes.each_with_index.map { |node, index| Records.comment(node, "top-level comment #{index + 1}") }
      end

      def reviews
        nodes = pager(Queries::REVIEWS, "reviews", "submitted reviews").fetch
        nodes.each_with_index.map { |node, index| Records.review(node, "submitted review #{index + 1}") }
      end

      def threads
        nodes = pager(Queries::THREADS, "reviewThreads", "review threads").fetch
        ThreadCollector.new(@client).collect(nodes)
      end

      private

      def pager(query, field, label)
        PullRequestPager.new(@client, query, @variables, field, label)
      end
    end

    class Collector
      def initialize(repository, number, transport, clock)
        @repository = repository
        @number = number
        @client = GitHubClient.new(transport)
        @metadata = Metadata.new(repository, number)
        @feedback = FeedbackReader.new(@client, repository, number)
        @clock = clock
      end

      def collect
        initial = read_metadata
        feedback = read_feedback
        final = read_metadata
        verify_head!(initial, final)
        result(final, feedback)
      end

      private

      def read_metadata
        endpoint = "repos/#{@repository.full_name}/pulls/#{@number}"
        @metadata.normalize(@client.rest(endpoint, "pull request metadata"))
      end

      def read_feedback
        { "top_level_comments" => @feedback.comments,
          "submitted_reviews" => @feedback.reviews,
          "review_threads" => @feedback.threads }
      end

      def verify_head!(initial, final)
        return if initial.dig("head", "sha") == final.dig("head", "sha")

        raise Failure, "pull request head changed during capture"
      end

      def result(metadata, feedback)
        { "schema_version" => 1, "kind" => "pull_request_feedback_inventory",
          "captured_at" => @clock.call.utc.iso8601(3), "complete" => true,
          "pull_request" => metadata }.merge(feedback)
      end
    end
  end
end
