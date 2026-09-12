# frozen_string_literal: true

require_relative "test_helper"

module CollectorCapture
  private

  def capture(transport)
    Orca::PrFeedback.capture(repository: "lifeodyssey/animichi", pr: 17,
                             transport: transport, clock: -> { Time.utc(2026, 9, 12) })
  end
end

module CollectorResponseFixtures
  private

  def json_responses(*payloads)
    payloads.map { |payload| JsonResponse.new(payload) }
  end
end

module CollectorPaginationFixtures
  private

  def later_page_contradiction
    first = FeedbackFixtures.pull_request_page(
      "comments", [FeedbackFixtures.feedback_record("comment", 1)], true, "comments-next", 2
    )
    second = FeedbackFixtures.pull_request_page(
      "comments", [FeedbackFixtures.feedback_record("comment", 2)], true, "comments-extra", 2
    )
    terminal = FeedbackFixtures.pull_request_page("comments", [], false, nil, 2)
    complete_responses(first, second, terminal)
  end

  def complete_responses(*comments)
    empty_reviews = FeedbackFixtures.pull_request_page("reviews", [])
    empty_threads = FeedbackFixtures.pull_request_page("reviewThreads", [])
    [FeedbackFixtures.metadata, *comments, empty_reviews, empty_threads, FeedbackFixtures.metadata]
  end
end

class CollectorResponseFailureTest < Minitest::Test
  include CollectorCapture
  include CollectorResponseFixtures

  def test_rejects_partial_graphql_data_with_errors
    partial = FeedbackFixtures.comments_one.merge("errors" => [{ "message" => "field denied" }])
    transport = FakeGhTransport.new(json_responses(FeedbackFixtures.metadata, partial))
    error = assert_raises(Orca::PrFeedback::Failure) { capture(transport) }
    assert_match(/GraphQL errors/, error.message)
  end

  def test_rejects_malformed_pagination_shape
    malformed = { "data" => { "repository" => { "pullRequest" => { "comments" => { "nodes" => [] } } } } }
    transport = FakeGhTransport.new(json_responses(FeedbackFixtures.metadata, malformed))
    error = assert_raises(Orca::PrFeedback::Failure) { capture(transport) }
    assert_match(/pageInfo/, error.message)
  end

  def test_propagates_failure_from_a_later_page
    failure = RaisedResponse.new(Orca::PrFeedback::Failure.new("comments page unavailable"))
    responses = json_responses(FeedbackFixtures.metadata, FeedbackFixtures.comments_one) + [failure]
    error = assert_raises(Orca::PrFeedback::Failure) { capture(FakeGhTransport.new(responses)) }
    assert_equal "comments page unavailable", error.message
  end
end

class CollectorPaginationInvariantTest < Minitest::Test
  include CollectorCapture
  include CollectorPaginationFixtures
  include CollectorResponseFixtures

  def test_rejects_a_final_page_with_missing_items
    item = FeedbackFixtures.feedback_record("comment", 1)
    comments = FeedbackFixtures.pull_request_page("comments", [item], false, nil, 2)
    reviews = FeedbackFixtures.pull_request_page("reviews", [])
    threads = FeedbackFixtures.pull_request_page("reviewThreads", [])
    transport = FakeGhTransport.new(json_responses(FeedbackFixtures.metadata, comments, reviews,
                                                   threads, FeedbackFixtures.metadata))
    error = assert_raises(Orca::PrFeedback::Failure) { capture(transport) }
    assert_match(/totalCount/, error.message)
  end

  def test_rejects_an_empty_connection_that_claims_another_page
    comments = FeedbackFixtures.pull_request_page("comments", [], true, "comments-next", 0)
    responses = complete_responses(comments, FeedbackFixtures.pull_request_page("comments", []))
    transport = FakeGhTransport.new(json_responses(*responses))
    error = assert_raises(Orca::PrFeedback::Failure) { capture(transport) }
    assert_match(/claims another page/, error.message)
    assert_equal 2, transport.calls.length
  end

  def test_rejects_a_later_page_that_reaches_total_and_claims_another
    transport = FakeGhTransport.new(json_responses(*later_page_contradiction))
    error = assert_raises(Orca::PrFeedback::Failure) { capture(transport) }
    assert_match(/claims another page/, error.message)
    assert_equal 3, transport.calls.length
  end
end

class CollectorFreshnessFailureTest < Minitest::Test
  include CollectorCapture

  def test_rejects_a_head_change_during_capture
    responses = FeedbackFixtures.happy_responses
    responses[-1] = JsonResponse.new(FeedbackFixtures.metadata(FeedbackFixtures::LATER_SHA))
    error = assert_raises(Orca::PrFeedback::Failure) { capture(FakeGhTransport.new(responses)) }
    assert_equal "pull request head changed during capture", error.message
  end
end

class NestedPaginationFailureTest < Minitest::Test
  include CollectorCapture

  def test_propagates_failure_while_paging_thread_replies
    failure = RaisedResponse.new(Orca::PrFeedback::Failure.new("thread replies unavailable"))
    responses = FeedbackFixtures.happy_responses.first(7) + [failure]
    error = assert_raises(Orca::PrFeedback::Failure) { capture(FakeGhTransport.new(responses)) }
    assert_equal "thread replies unavailable", error.message
  end
end
