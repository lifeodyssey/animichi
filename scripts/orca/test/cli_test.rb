# frozen_string_literal: true

require "stringio"
require "tmpdir"
require_relative "test_helper"

class CliValidationTest < Minitest::Test
  def test_rejects_invalid_repository_without_calling_gh
    transport = FakeGhTransport.new([])
    status, _stdout, stderr = run_cli(["--repo", "owner/repo/extra", "--pr", "17"], transport)
    assert_equal 1, status
    assert_match(/OWNER\/REPO/, stderr)
    assert_empty transport.calls
  end

  def test_rejects_nonpositive_pull_request_number
    status, _stdout, stderr = run_cli(["--repo", "lifeodyssey/animichi", "--pr", "0"],
                                      FakeGhTransport.new([]))
    assert_equal 1, status
    assert_match(/positive integer/, stderr)
  end

  private

  def run_cli(argv, transport)
    stdout = StringIO.new
    stderr = StringIO.new
    status = Orca::PrFeedback::CLI.run(argv, transport: transport, stdout: stdout,
                                      stderr: stderr, clock: -> { Time.utc(2026, 9, 12) })
    [status, stdout.string, stderr.string]
  end
end

module CliOutputInvocation
  private

  def run_cli(path, transport)
    stdout = StringIO.new
    stderr = StringIO.new
    args = ["--repo", "lifeodyssey/animichi", "--pr", "17", "--output", path]
    status = Orca::PrFeedback::CLI.run(args, transport: transport, stdout: stdout,
                                      stderr: stderr, clock: -> { Time.utc(2026, 9, 12) })
    [status, stdout.string, stderr.string]
  end
end

module CliOutputFailureFixtures
  private

  def failing_transport
    partial = FeedbackFixtures.comments_one.merge("errors" => [{ "message" => "denied" }])
    FakeGhTransport.new([JsonResponse.new(FeedbackFixtures.metadata), JsonResponse.new(partial)])
  end

  def contradictory_transport
    item = FeedbackFixtures.feedback_record("comment", 1)
    comments = FeedbackFixtures.pull_request_page("comments", [item], true, "comments-next", 1)
    terminal = FeedbackFixtures.pull_request_page("comments", [], false, nil, 1)
    reviews = FeedbackFixtures.pull_request_page("reviews", [])
    threads = FeedbackFixtures.pull_request_page("reviewThreads", [])
    payloads = [FeedbackFixtures.metadata, comments, terminal, reviews, threads,
                FeedbackFixtures.metadata]
    FakeGhTransport.new(payloads.map { |payload| JsonResponse.new(payload) })
  end
end

class CliOutputSuccessTest < Minitest::Test
  include CliOutputInvocation

  def test_writes_only_the_complete_inventory_to_the_output_path
    Dir.mktmpdir do |directory|
      path = File.join(directory, "inventory.json")
      status, stdout, stderr = run_cli(path, FakeGhTransport.new(FeedbackFixtures.happy_responses))
      assert_equal [0, "", ""], [status, stdout, stderr]
      assert_equal true, JSON.parse(File.read(path))["complete"]
      assert_equal ["inventory.json"], Dir.children(directory)
    end
  end
end

class CliOutputFailureTest < Minitest::Test
  include CliOutputFailureFixtures
  include CliOutputInvocation

  def test_preserves_existing_output_when_capture_fails
    Dir.mktmpdir do |directory|
      path = File.join(directory, "inventory.json")
      File.write(path, "prior\n")
      status, stdout, stderr = run_cli(path, failing_transport)
      assert_equal 1, status
      assert_equal "", stdout
      assert_match(/GraphQL errors/, stderr)
      assert_equal "prior\n", File.read(path)
      assert_equal ["inventory.json"], Dir.children(directory)
    end
  end

  def test_preserves_existing_output_when_exhausted_page_claims_another
    Dir.mktmpdir do |directory|
      path = File.join(directory, "inventory.json")
      File.write(path, "prior\n")
      status, stdout, stderr = run_cli(path, contradictory_transport)
      assert_equal 1, status
      assert_equal "", stdout
      assert_match(/claims another page/, stderr)
      assert_equal "prior\n", File.read(path)
      assert_equal ["inventory.json"], Dir.children(directory)
    end
  end
end
