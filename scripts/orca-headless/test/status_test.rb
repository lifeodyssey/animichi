# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

class HeadlessUnknownStatusTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures

  def test_reports_unknown_without_inventing_a_native_stage
    Dir.mkdir(@state, 0o700)
    runner = FakeCommandRunner.new
    code, out, = invoke(["status", "--state-dir", @state], runner)
    assert_equal 1, code
    assert_unknown_status(JSON.parse(out))
    assert_empty runner.calls
  end

  private

  def assert_unknown_status(status)
    assert_equal "unknown", status.fetch("stage")
    assert_equal "unknown", status.dig("taskSettlement", "state")
    assert_equal "unknown", status.dig("agentCliExit", "state")
    assert_equal "not_evaluated", status.fetch("candidateApproval")
  end
end

class HeadlessNativeStatusTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures

  def test_keeps_cli_exit_separate_from_task_settlement
    invoke(start_args, FakeCommandRunner.new(successful_start_results))
    write_positive_exit_receipts(17)
    results = [worker_show_response("completed", "succeeded"), terminal_show_response]
    runner = FakeCommandRunner.new(results.map { |item| command_result(item) })
    code, out, = invoke(["status", "--state-dir", @state], runner)
    assert_equal 0, code
    assert_settled_status(JSON.parse(out))
  end

  def test_reports_identity_change_as_unknown_and_fails_closed
    invoke(start_args, FakeCommandRunner.new(successful_start_results))
    results = [worker_show_response, terminal_show_response("different-incarnation")]
    runner = FakeCommandRunner.new(results.map { |item| command_result(item) })
    code, out, = invoke(["status", "--state-dir", @state], runner)
    assert_equal 1, code
    assert_equal "mismatch", JSON.parse(out).dig("terminalIdentity", "state")
  end

  private

  def assert_settled_status(status)
    assert_equal 17, status.dig("agentCliExit", "exitCode")
    assert_equal "settled", status.dig("taskSettlement", "state")
    assert_equal "succeeded", status.dig("taskSettlement", "outcome")
    assert_equal "match", status.dig("terminalIdentity", "state")
    assert_equal "not_evaluated", status.fetch("candidateApproval")
  end
end

class HeadlessInconsistentStatusTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures

  def test_reports_inconsistent_native_settlement_as_unknown
    invoke(start_args, FakeCommandRunner.new(successful_start_results))
    results = [worker_show_response("completed"), terminal_show_response]
    runner = FakeCommandRunner.new(results.map { |item| command_result(item) })
    code, out, = invoke(["status", "--state-dir", @state], runner)
    assert_equal 1, code
    assert_equal "unknown", JSON.parse(out).dig("taskSettlement", "state")
  end
end
