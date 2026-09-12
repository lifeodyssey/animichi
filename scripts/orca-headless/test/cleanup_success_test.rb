# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

class HeadlessCleanupSuccessTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture
  def setup
    super
    write_positive_exit_receipts
  end

  def test_releases_then_closes_only_the_exact_owned_terminal
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response,
                 settlement_response, release_response, terminal_show_response, close_response]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, out, = invoke(cleanup_args, runner)
    assert_cleanup_success(code, out, runner)
  end

  def test_cleans_up_when_provider_metadata_is_stale_but_wrapper_is_owned
    terminal = terminal_show_response
    terminal.dig("result", "terminal")["agentIdentity"] = "codex"
    responses = [worker_show_response("completed", "succeeded"), terminal,
                 settlement_response, release_response, terminal, close_response]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    observer = FakeProcessObserver.new(wrapper_observation)
    code, out, err = invoke(cleanup_args, runner, process_observer: observer)
    assert_cleanup_success(code, out, runner, err)
    assert_equal [66, 66], observer.calls
  end

  def test_repeated_cleanup_trusts_only_a_positive_prior_close_receipt
    responses = successful_cleanup_responses
    invoke(cleanup_args, FakeCommandRunner.new(responses))
    runner = FakeCommandRunner.new
    code, out, = invoke(cleanup_args, runner)
    assert_equal 0, code
    assert_equal "already_cleaned", JSON.parse(out).fetch("status")
    assert_empty runner.calls
  end

  private

  def assert_cleanup_success(code, output, runner, error = nil)
    assert_equal 0, code, error
    assert_equal "cleaned", JSON.parse(output).fetch("status")
    assert_equal %w[worker-release terminal show terminal close], command_markers(runner)
    close = JSON.parse(File.read(File.join(@state, "terminal-close.json")))
    assert_equal true, close.dig("result", "close", "ptyKilled")
    assert_equal WORKER_HANDLE, close.dig("result", "close", "handle")
  end

  def successful_cleanup_responses
    values = [worker_show_response("completed", "succeeded"), terminal_show_response,
              settlement_response, release_response, terminal_show_response, close_response]
    values.map { |item| command_result(item) }
  end

  def command_markers(runner)
    [runner.calls.fetch(3).fetch(2), runner.calls.fetch(4).fetch(1),
     runner.calls.fetch(4).fetch(2), runner.calls.fetch(5).fetch(1),
     runner.calls.fetch(5).fetch(2)]
  end
end
