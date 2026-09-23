# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

module CleanupEvidenceFixture
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def setup
    super
    write_positive_exit_receipts
  end

  def successful_cleanup_with(worker)
    values = [worker, terminal_show_response, run_show_response, settlement_response,
              release_response, terminal_show_response, close_response]
    values.map { |item| command_result(item) }
  end

  def settlement_with(messages)
    response = settlement_response
    response.fetch("result")["messages"] = messages
    response
  end
end

class CleanupSettlementShapeTest < Minitest::Test
  include CleanupEvidenceFixture

  def test_refuses_an_empty_completed_at_value
    worker = worker_show_response("completed", "succeeded")
    worker.dig("result", "dispatch")["completedAt"] = ""
    runner = FakeCommandRunner.new(successful_cleanup_with(worker))
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_equal 1, runner.calls.length
  end

  def test_refuses_a_non_string_completed_at_value
    worker = worker_show_response("completed", "succeeded")
    worker.dig("result", "dispatch")["completedAt"] = true
    runner = FakeCommandRunner.new(successful_cleanup_with(worker))
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_equal 1, runner.calls.length
  end
end

class CleanupMessageShapeTest < Minitest::Test
  include CleanupEvidenceFixture

  def test_refuses_a_non_array_messages_value
    runner = runner_for_messages("not-an-array")
    code, _out, error = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/settlement messages are invalid/, error)
    assert_equal 4, runner.calls.length
  end

  def test_refuses_a_non_object_message_record
    runner = runner_for_messages([nil])
    code, _out, error = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/settlement messages are invalid/, error)
    assert_equal 4, runner.calls.length
  end

  def test_refuses_a_non_object_settlement_payload
    response = settlement_response
    response.dig("result", "messages").first["payload"] = "null"
    runner = runner_for_settlement(response)
    code, _out, error = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/settlement payload is invalid/, error)
  end

  def test_refuses_a_scalar_settlement_result
    response = settlement_response
    response["result"] = 7
    runner = runner_for_settlement(response)
    code, _out, error = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/settlement messages are invalid/, error)
  end

  private

  def runner_for_messages(messages)
    runner_for_settlement(settlement_with(messages))
  end

  def runner_for_settlement(settlement)
    values = [worker_show_response("completed", "succeeded"), terminal_show_response,
              run_show_response, settlement]
    FakeCommandRunner.new(values.map { |item| command_result(item) })
  end
end
