# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

class CleanupReceiptRefusalTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def test_refuses_cleanup_when_agent_exit_is_absent
    runner = FakeCommandRunner.new
    code, _out, err = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/positive agent exit/, err)
    assert_empty runner.calls
  end

  def test_refuses_cleanup_without_positive_agent_exit
    File.write(File.join(@state, "process.json"), JSON.generate("pid" => 77))
    stale = { "phase" => "agent_exited", "childPid" => 77, "exitCode" => 0 }
    File.write(File.join(@state, "exit.json"), JSON.generate(stale))
    runner = FakeCommandRunner.new
    code, _out, err = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/positive agent exit/, err)
    assert_empty runner.calls
  end

  def test_refuses_an_unsettled_dispatch
    write_positive_exit_receipts
    runner = FakeCommandRunner.new([command_result(worker_show_response)])
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_equal 1, runner.calls.length
    refute File.exist?(File.join(@state, "worker-release-request.json"))
  end
end

class CleanupIdentityRefusalTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def test_refuses_a_changed_terminal_incarnation
    write_positive_exit_receipts
    responses = [worker_show_response("completed", "succeeded"),
                 terminal_show_response("changed-incarnation")]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, = invoke(cleanup_args, runner)
    assert_cleanup_before_release(code, runner)
  end

  def test_refuses_stale_provider_metadata_without_process_evidence
    write_positive_exit_receipts
    code, runner, observer = cleanup_with_observation(nil)
    assert_refused_observation(code, runner, observer)
  end

  def test_refuses_absent_provider_metadata_without_process_evidence
    write_positive_exit_receipts
    code, runner, observer = cleanup_with_observation(nil, provider_metadata: false)
    assert_refused_observation(code, runner, observer)
  end

  def test_refuses_stale_provider_metadata_for_another_wrapper_command
    write_positive_exit_receipts
    observation = wrapper_observation("command" => "/usr/bin/ruby another-runner.rb")
    code, runner, observer = cleanup_with_observation(observation)
    assert_refused_observation(code, runner, observer)
  end

  def test_refuses_absent_provider_metadata_for_another_wrapper_command
    write_positive_exit_receipts
    observation = wrapper_observation("command" => "/usr/bin/ruby another-runner.rb")
    code, runner, observer = cleanup_with_observation(observation, provider_metadata: false)
    assert_refused_observation(code, runner, observer)
  end

  def test_refuses_stale_provider_metadata_for_a_reused_wrapper_pid
    write_positive_exit_receipts
    ready = JSON.parse(File.read(File.join(@state, "runner-ready.json")))
    reused_at = (Time.parse(ready.fetch("recordedAt")) + 1).utc.iso8601
    code, runner, observer = cleanup_with_observation(wrapper_observation("startedAt" => reused_at))
    assert_refused_observation(code, runner, observer)
  end

  def test_refuses_provider_metadata_when_wrapper_no_longer_owns_the_foreground
    write_positive_exit_receipts
    observation = wrapper_observation("foregroundProcessGroup" => 45)
    code, runner, observer = cleanup_with_observation(observation)
    assert_refused_observation(code, runner, observer)
  end

  def test_refuses_close_when_wrapper_evidence_disappears_after_release
    write_positive_exit_receipts
    responses = cleanup_prechecks + [command_result(release_response),
                                     command_result(terminal_show_response)]
    runner = FakeCommandRunner.new(responses)
    observer = FakeProcessObserver.new([wrapper_observation, nil])
    code, = invoke(cleanup_args, runner, process_observer: observer)
    assert_equal 1, code
    assert_equal 5, runner.calls.length
    assert_equal [66, 66], observer.calls
    refute File.exist?(File.join(@state, "terminal-close-request.json"))
  end

  def test_refuses_stale_provider_metadata_with_malformed_process_evidence
    write_positive_exit_receipts
    code, runner, observer = cleanup_with_observation(wrapper_observation("ppid" => "55"))
    assert_refused_observation(code, runner, observer)
  end

  private

  def assert_cleanup_before_release(code, runner)
    assert_equal 1, code
    assert_equal 2, runner.calls.length
    refute File.exist?(File.join(@state, "worker-release-request.json"))
  end

  def cleanup_with_observation(observation, provider_metadata: true)
    terminal = terminal_show_response
    terminal.dig("result", "terminal")["agentIdentity"] = "codex" if provider_metadata
    responses = [worker_show_response("completed", "succeeded"), terminal]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    observer = FakeProcessObserver.new(observation)
    code, = invoke(cleanup_args, runner, process_observer: observer)
    [code, runner, observer]
  end

  def assert_refused_observation(code, runner, observer)
    assert_cleanup_before_release(code, runner)
    assert_equal [66], observer.calls
  end
end

class CleanupAuthorityRefusalTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def test_refuses_a_worker_done_message_from_another_attempt
    write_positive_exit_receipts
    wrong = settlement_response("msg_someoneelse")
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response, wrong]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_equal 3, runner.calls.length
    refute File.exist?(File.join(@state, "worker-release-request.json"))
  end

  def test_refuses_a_worker_done_outcome_that_disagrees_with_the_dispatch
    write_positive_exit_receipts
    wrong = settlement_response("msg_done1", "failed")
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response, wrong]
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
    assert_unknown_release(code, runner, 3)
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
    assert_unknown_release(code, runner, 4)
  end

  private

  def assert_unknown_release(code, runner, call_count)
    assert_equal 1, code
    assert_equal call_count, runner.calls.length
    assert File.exist?(File.join(@state, "worker-release-request.json"))
    refute File.exist?(File.join(@state, "terminal-close-request.json"))
  end
end
