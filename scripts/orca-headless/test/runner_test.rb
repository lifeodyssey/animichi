# frozen_string_literal: true

require_relative "test_helper"

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
