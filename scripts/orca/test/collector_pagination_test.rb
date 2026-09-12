# frozen_string_literal: true

require_relative "test_helper"

class CollectorPaginationTest < Minitest::Test
  include FeedbackFixtures

  def test_captures_all_feedback_pages_and_nested_replies
    transport = FakeGhTransport.new(FeedbackFixtures.happy_responses)
    result = capture(transport)
    assert_inventory(result)
    assert_thread_replies(result)
    assert_nested_cursor_call(transport)
    assert_equal 0, transport.remaining
  end

  private

  def capture(transport)
    Orca::PrFeedback.capture(repository: "lifeodyssey/animichi", pr: 17,
                             transport: transport, clock: -> { Time.utc(2026, 9, 12, 12, 30, 0) })
  end

  def assert_inventory(result)
    assert_equal true, result["complete"]
    assert_equal "2026-09-12T12:30:00.000Z", result["captured_at"]
    assert_equal %w[comment_1 comment_2 comment_3], result["top_level_comments"].map { |item| item["id"] }
    assert_equal "1", result["top_level_comments"].first["database_id"]
    assert_equal %w[review_1 review_2 review_3], result["submitted_reviews"].map { |item| item["id"] }
    refute result.key?("merge_ready")
  end

  def assert_thread_replies(result)
    threads = result["review_threads"]
    assert_equal ["THREAD_1", "THREAD_2"], threads.map { |item| item["id"] }
    assert_equal %w[inline_1 inline_2 inline_3], threads.first["comments"].map { |item| item["id"] }
    assert_equal true, threads.last["resolved"]
    assert_equal "inline body 3", threads.first["comments"].last["body"]
  end

  def assert_nested_cursor_call(transport)
    nested = transport.calls.find { |argv| argv.include?("threadId=THREAD_1") }
    refute_nil nested
    assert_includes nested, "after=thread-comments-next"
  end
end

class CollectorFieldTest < Minitest::Test
  def test_preserves_pull_request_identity_and_merge_facts
    pull_request = capture.fetch("pull_request")
    identity = pull_request.values_at("id", "number", "url", "state", "draft")
    assert_equal ["PR_NODE", 17, "https://github.com/lifeodyssey/animichi/pull/17", "open", false], identity
    assert_equal FeedbackFixtures::SHA, pull_request.fetch("head").fetch("sha")
    assert_equal expected_merge, pull_request.fetch("merge")
  end

  def test_preserves_feedback_authors_bodies_urls_and_update_times
    result = capture
    comment = result.fetch("top_level_comments").first
    review = result.fetch("submitted_reviews").first
    assert_equal expected_comment, comment.values_at("author", "body", "url", "updated_at")
    assert_equal expected_review, review.values_at("author", "body", "url", "updated_at")
  end

  private

  def capture
    transport = FakeGhTransport.new(FeedbackFixtures.happy_responses)
    Orca::PrFeedback.capture(repository: "lifeodyssey/animichi", pr: 17,
                             transport: transport, clock: -> { Time.utc(2026, 9, 12) })
  end

  def expected_merge
    { "merged" => false, "merged_at" => nil, "merge_commit_sha" => nil,
      "mergeable" => true, "mergeable_state" => "clean" }
  end

  def expected_comment
    ["author1", "comment body 1", "https://example.test/comment/1", "2026-09-11T02:00:00Z"]
  end

  def expected_review
    ["author1", "review body 1", "https://example.test/review/1", "2026-09-11T02:00:00Z"]
  end
end
