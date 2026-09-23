# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

class CleanupAuthorityRefusalTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def test_refuses_a_worker_done_message_from_another_attempt
    write_positive_exit_receipts
    wrong = settlement_response("msg_someoneelse")
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response,
                 run_show_response, wrong]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_equal 4, runner.calls.length
    refute File.exist?(File.join(@state, "worker-release-request.json"))
  end

  def test_refuses_a_worker_done_outcome_that_disagrees_with_the_dispatch
    write_positive_exit_receipts
    wrong = settlement_response("msg_done1", "failed")
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response,
                 run_show_response, wrong]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    refute File.exist?(File.join(@state, "worker-release-request.json"))
  end

  def test_refuses_an_ambiguous_prior_release_without_closing
    write_positive_exit_receipts
    request = { "requestId" => "request-1", "dispatchId" => "ctx_example1",
      "runtimeId" => RUNTIME_ID }
    File.write(File.join(@state, "worker-release-request.json"), JSON.generate(request))
    runner = FakeCommandRunner.new(cleanup_prechecks)
    code, = invoke(cleanup_args, runner)
    assert_unknown_release(code, runner, 4)
  end

  def test_refuses_an_ambiguous_prior_close_before_any_native_call
    write_positive_exit_receipts
    File.write(File.join(@state, "terminal-close-request.json"), "{}")
    runner = FakeCommandRunner.new
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_empty runner.calls
  end

  def test_refuses_an_unknown_release_without_closing
    write_positive_exit_receipts
    unknown = ok_response("dispatchId" => "ctx_example1", "state" => "release_unknown",
                          "processAction" => "unknown")
    runner = FakeCommandRunner.new(cleanup_prechecks + [command_result(unknown, 1)])
    code, = invoke(cleanup_args, runner)
    assert_unknown_release(code, runner, 5)
  end

  private

  def assert_unknown_release(code, runner, call_count)
    assert_equal 1, code
    assert_equal call_count, runner.calls.length
    assert File.exist?(File.join(@state, "worker-release-request.json"))
    refute File.exist?(File.join(@state, "terminal-close-request.json"))
  end
end
