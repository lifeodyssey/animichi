# frozen_string_literal: true

require "json"
require "minitest/autorun"
require_relative "../pr_feedback"

class JsonResponse
  def initialize(payload)
    @payload = payload
  end

  def deliver
    JSON.generate(@payload)
  end
end

class RaisedResponse
  def initialize(error)
    @error = error
  end

  def deliver
    raise @error
  end
end

class FakeGhTransport
  attr_reader :calls

  def initialize(responses)
    @responses = responses
    @calls = []
  end

  def run(argv)
    @calls << argv
    @responses.fetch(@calls.length - 1).deliver
  end

  def remaining
    @responses.length - @calls.length
  end
end

module FeedbackFixtures
  SHA = "a" * 40
  LATER_SHA = "b" * 40
  METADATA = {
    "number" => 17,
    "node_id" => "PR_NODE",
    "html_url" => "https://github.com/lifeodyssey/animichi/pull/17",
    "title" => "fix(edge): keep review evidence",
    "state" => "open",
    "draft" => false,
    "merged" => false,
    "merged_at" => nil,
    "merge_commit_sha" => nil,
    "mergeable" => true,
    "mergeable_state" => "clean",
    "base" => { "repo" => { "full_name" => "lifeodyssey/animichi" } }
  }.freeze

  module_function

  def metadata(sha = SHA)
    METADATA.merge("head" => { "sha" => sha, "ref" => "card-17", "label" => "owner:card-17" })
  end

  def feedback_record(prefix, index)
    { "id" => "#{prefix}_#{index}", "fullDatabaseId" => index.to_s,
      "author" => { "login" => "author#{index}" }, "authorAssociation" => "MEMBER",
      "body" => "#{prefix} body #{index}", "url" => "https://example.test/#{prefix}/#{index}",
      "createdAt" => "2026-09-11T01:00:00Z", "updatedAt" => "2026-09-11T02:00:00Z" }
  end

  def review(index)
    feedback_record("review", index).merge("state" => "COMMENTED",
                                           "submittedAt" => "2026-09-11T03:00:00Z",
                                           "commit" => { "oid" => SHA })
  end

  def inline_comment(index)
    feedback_record("inline", index).merge("path" => "lib/example.rb", "line" => index,
                                           "originalLine" => index, "outdated" => false,
                                           "replyTo" => nil)
  end

  def inline_reply(index, reply_to)
    inline_comment(index).merge("replyTo" => { "id" => reply_to })
  end

  def connection(nodes, has_next = false, cursor = nil, total_count = nodes.length)
    { "nodes" => nodes,
      "pageInfo" => { "hasNextPage" => has_next, "endCursor" => cursor },
      "totalCount" => total_count }
  end

  def pull_request_page(field, nodes, has_next = false, cursor = nil, total_count = nodes.length)
    pull_request = { field => connection(nodes, has_next, cursor, total_count) }
    { "data" => { "repository" => { "pullRequest" => pull_request } } }
  end

  def thread(id, nodes, has_next = false, cursor = nil, resolved = false, total_count = nodes.length)
    { "id" => id, "isResolved" => resolved, "isOutdated" => false,
      "comments" => connection(nodes, has_next, cursor, total_count) }
  end

  def thread_page(id, nodes, has_next = false, cursor = nil, total_count = nodes.length)
    node = { "__typename" => "PullRequestReviewThread", "id" => id,
             "comments" => connection(nodes, has_next, cursor, total_count) }
    { "data" => { "node" => node } }
  end

  def happy_responses
    [metadata, comments_one, comments_two, reviews_one, reviews_two,
     threads_one, threads_two, thread_replies, metadata].map { |item| JsonResponse.new(item) }
  end

  def comments_one
    nodes = [feedback_record("comment", 1), feedback_record("comment", 2)]
    pull_request_page("comments", nodes, true, "comments-next", 3)
  end

  def comments_two
    pull_request_page("comments", [feedback_record("comment", 3)], false, nil, 3)
  end

  def reviews_one
    pull_request_page("reviews", [review(1), review(2)], true, "reviews-next", 3)
  end

  def reviews_two
    pull_request_page("reviews", [review(3)], false, nil, 3)
  end

  def threads_one
    first = thread("THREAD_1", [inline_comment(1), inline_reply(2, "inline_1")],
                   true, "thread-comments-next", false, 3)
    pull_request_page("reviewThreads", [first], true, "threads-next", 2)
  end

  def threads_two
    second = thread("THREAD_2", [inline_comment(4)], false, nil, true)
    pull_request_page("reviewThreads", [second], false, nil, 2)
  end

  def thread_replies
    thread_page("THREAD_1", [inline_reply(3, "inline_1")], false, nil, 3)
  end
end
