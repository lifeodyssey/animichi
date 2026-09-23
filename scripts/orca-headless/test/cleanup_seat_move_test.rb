# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

class CleanupSeatMoveSuccessTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def setup
    super
    write_positive_exit_receipts
  end

  def test_settles_as_the_runs_current_coordinator_after_a_seat_move
    moved = run_show_response("term_coordinator2", 25)
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response,
                 moved, settlement_response, release_response, terminal_show_response,
                 close_response]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, out, = invoke(cleanup_args, runner)
    assert_equal 0, code
    assert_equal "cleaned", JSON.parse(out).fetch("status")
    check = runner.calls.fetch(3)
    assert_equal ["orchestration", "check", "--terminal", "term_coordinator2", "--run",
                  "run_example1", "--all", "--types", "worker_done", "--json"], check.drop(1)
    refute check.include?("term_coordinator1")
  end
end

class CleanupThirdPartyRefusalTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  def setup
    super
    write_positive_exit_receipts
  end

  def test_refuses_when_the_runtime_fences_a_caller_that_is_neither_coordinator
    fenced = fenced_response("term_thirdparty", "term_coordinator2")
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response,
                 run_show_response("term_coordinator2", 25), fenced]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, _out, err = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/settlement-.* failed \(consumer_fenced\)/, err)
    assert_equal 4, runner.calls.length
    assert_equal "term_coordinator2", runner.calls.fetch(3).fetch(4)
    refute File.exist?(File.join(@state, "worker-release-request.json"))
    refute File.exist?(File.join(@state, "terminal-close-request.json"))
  end

  def test_refuses_a_run_record_that_does_not_bind_the_attempts_run
    stranger = run_show_response("term_coordinator2", 25)
    stranger.dig("result", "run")["id"] = "run_someoneelse"
    responses = [worker_show_response("completed", "succeeded"), terminal_show_response, stranger]
    runner = FakeCommandRunner.new(responses.map { |item| command_result(item) })
    code, _out, err = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/current coordinator is unknown/, err)
    assert_equal 3, runner.calls.length
    refute File.exist?(File.join(@state, "worker-release-request.json"))
  end

  private

  def fenced_response(attested, requested)
    { "id" => "msg_fence1", "ok" => false,
      "error" => { "code" => "consumer_fenced",
                   "message" => "This terminal is attested as #{attested} and cannot act as #{requested}.",
                   "data" => { "effectsApplied" => false } },
      "_meta" => { "runtimeId" => RUNTIME_ID } }
  end
end
