# frozen_string_literal: true

require_relative "test_helper"
require "rbconfig"

class FakeClock
  def initialize
    @now = 0.0
  end

  def monotonic
    @now
  end

  def sleep(seconds)
    @now += seconds
  end
end

class FakeProcess
  attr_reader :calls

  def initialize(pid: 4321, exit_code: 9)
    @pid = pid
    @exit_code = exit_code
    @calls = []
  end

  def spawn(argv, options)
    @calls << [argv, options]
    @pid
  end

  def wait(pid)
    raise "wrong pid" unless pid == @pid

    @exit_code
  end
end

class TrackingChildProcess < OrcaHeadless::ChildProcess
  attr_reader :pid

  def spawn(argv, options)
    @pid = super
  end
end

class ProcessReceiptFailureStore < OrcaHeadless::ReceiptStore
  def write_json(name, value)
    raise OrcaHeadless::InputError, "injected process receipt failure" if name == "process.json"

    super
  end
end

class UncleanableProcess < FakeProcess
  def terminate(_pid)
    raise Errno::EPERM, "injected cleanup failure"
  end
end

class FakeHold
  attr_reader :calls

  def initialize
    @calls = 0
  end

  def call
    @calls += 1
  end
end

module RunnerTestFixture
  def setup
    super
    Dir.mkdir(@state, 0o700)
    write_runner_config
  end

  def write_runner_config
    config = { "cwd" => @workspace, "argv" => ["fake-agent", "arg with ' quote"],
      "stdin" => File.join(@state, "prompt.txt"),
      "stdout" => File.join(@state, "events.jsonl"),
      "stderr" => File.join(@state, "stderr.log") }
    File.write(File.join(@state, "runner-config.json"), JSON.generate(config))
  end
end

class HeadlessRunnerTimeoutTest < Minitest::Test
  include HeadlessFixture
  include RunnerTestFixture

  def test_times_out_without_treating_absence_as_agent_exit
    process = FakeProcess.new
    runner = OrcaHeadless::Runner.new(@state, 1, process: process, clock: FakeClock.new)
    code = runner.call
    assert_equal 124, code
    assert_empty process.calls
    assert_timeout_receipt
  end

  private

  def assert_timeout_receipt
    receipt = JSON.parse(File.read(File.join(@state, "exit.json")))
    assert_equal "prompt_timeout", receipt.fetch("phase")
    refute receipt.key?("childPid")
  end
end

class HeadlessRunnerExitTest < Minitest::Test
  include HeadlessFixture
  include RunnerTestFixture

  def test_records_real_child_pid_and_observed_exit_code
    File.write(File.join(@state, "prompt.txt"), "native preamble")
    process = FakeProcess.new
    hold = FakeHold.new
    runner = OrcaHeadless::Runner.new(@state, 1, process: process,
                                      clock: FakeClock.new, hold: hold)
    assert_equal 9, runner.call
    assert_process_receipts(hold)
  end

  private

  def assert_process_receipts(hold)
    started = JSON.parse(File.read(File.join(@state, "process.json")))
    observed = JSON.parse(File.read(File.join(@state, "exit.json")))
    assert_equal 4321, started.fetch("pid")
    assert_equal ["fake-agent", "arg with ' quote"], started.fetch("argv")
    assert_equal ["agent_exited", 9], observed.values_at("phase", "exitCode")
    assert_equal 1, hold.calls
    assert_hold_receipt
  end

  def assert_hold_receipt
    held = JSON.parse(File.read(File.join(@state, "hold.json")))
    assert_equal "awaiting_cleanup", held.fetch("phase")
    assert_equal Process.pid, held.fetch("wrapperPid")
  end
end

class HeadlessRunnerTrackingFailureTest < Minitest::Test
  include HeadlessFixture
  include RunnerTestFixture
  def test_reaps_the_exact_child_when_process_tracking_fails
    File.binwrite(File.join(@state, "prompt.txt"), "native preamble")
    write_live_runner_config
    process = TrackingChildProcess.new
    assert_equal 127, OrcaHeadless::RunnerWorkflow.call(context_for(process))
    assert_raises(Errno::ECHILD) { Process.waitpid(process.pid, Process::WNOHANG) }
    assert_abort_receipt(process.pid)
  ensure
    reap_owned_child(process&.pid)
  end

  def test_records_uncertainty_when_the_exact_child_cannot_be_terminated
    File.binwrite(File.join(@state, "prompt.txt"), "native preamble")
    assert_equal 127, OrcaHeadless::RunnerWorkflow.call(context_for(UncleanableProcess.new))
    failure = JSON.parse(File.binread(File.join(@state, "failure.json")))
    assert_match(/child cleanup is uncertain/, failure.fetch("message"))
    refute File.exist?(File.join(@state, "process-abort.json"))
  end

  private

  def context_for(process)
    state = File.realpath(@state)
    store = ProcessReceiptFailureStore.new(state)
    OrcaHeadless::RunnerContext.new(state, 1, process, FakeClock.new, FakeHold.new, store)
  end

  def write_live_runner_config
    path = File.join(@state, "runner-config.json")
    config = JSON.parse(File.binread(path))
    config["argv"] = [RbConfig.ruby, "-e", "sleep 60"]
    File.binwrite(path, JSON.generate(config))
  end

  def assert_abort_receipt(pid)
    path = File.join(@state, "process-abort.json")
    receipt = JSON.parse(File.binread(path))
    assert_equal [pid, "reaped"], receipt.values_at("childPid", "state")
  end

  def reap_owned_child(pid)
    Process.kill("KILL", pid)
    Process.wait(pid)
  rescue Errno::ESRCH, Errno::ECHILD, TypeError
    nil
  end
end
