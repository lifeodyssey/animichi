# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "stringio"
require "tmpdir"

require_relative "../orca_headless"

class FakeCommandRunner
  attr_reader :calls

  def initialize(results = [])
    @results = results
    @calls = []
  end

  def run(argv)
    @calls << argv
    @results.fetch(@calls.length - 1)
  end
end

class FakeProcessObserver
  attr_reader :calls

  def initialize(observation)
    @observations = observation.is_a?(Array) ? observation : [observation]
    @calls = []
  end

  def observe(pid)
    @calls << pid
    @observations.fetch(@calls.length - 1, @observations.last)
  end
end

module HeadlessFixture
  def setup
    @root = Dir.mktmpdir("orca headless test '")
    assign_fixture_paths
    create_fixture_files
  end

  def assign_fixture_paths
    @workspace = File.join(@root, "workspace with ' quote")
    @state = File.join(@root, "state with ' quote")
    @spec = File.join(@root, "spec with ' quote.md")
    @runtime_client = File.join(@root, "out", "cli", "runtime", "client.js")
    @bin = File.join(@root, "bin")
  end

  def create_fixture_files
    FileUtils.mkdir_p(@workspace)
    FileUtils.mkdir_p(File.dirname(@runtime_client))
    FileUtils.mkdir_p(@bin)
    %w[node orca codex grok].each { |name| write_executable(name) }
    @resolver = OrcaHeadless::ExecutableResolver.new(@bin)
    File.write(@runtime_client, "module.exports = {};")
    File.write(@spec, "Implement safely.\n")
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def start_args(provider = "codex", model = "gpt-5.6-sol", effort = "max")
    ["start", "--workspace", @workspace, "--coordinator", "term_coordinator1",
     "--run", "run_example1", "--title", "Headless test", "--spec-file", @spec,
     "--provider", provider, "--model", model, "--effort", effort,
     "--state-dir", @state, "--runtime-client", @runtime_client]
  end

  def command_result(payload, exit_code = 0, stderr = "")
    OrcaHeadless::CommandResult.new(JSON.generate(payload), stderr, exit_code)
  end

  def invoke(argv, runner, process_observer: nil)
    out = StringIO.new
    err = StringIO.new
    options = { stdout: out, stderr: err, runner: runner, resolver: @resolver }
    options[:process_observer] = process_observer if process_observer
    code = OrcaHeadless::CLI.run(argv, **options)
    [code, out.string, err.string]
  end

  def write_executable(name)
    path = File.join(@bin, name)
    File.write(path, "#!/bin/sh\nexit 0\n")
    File.chmod(0o700, path)
  end

  def write_positive_exit_receipts(exit_code = 0)
    ready = { "pid" => 66, "recordedAt" => Time.now.utc.iso8601 }
    File.write(File.join(@state, "runner-ready.json"), JSON.generate(ready))
    File.write(File.join(@state, "process.json"), JSON.generate("pid" => 77))
    exit_payload = { "phase" => "agent_exited", "childPid" => 77, "exitCode" => exit_code }
    hold_payload = { "phase" => "awaiting_cleanup", "wrapperPid" => 66, "childPid" => 77 }
    File.write(File.join(@state, "exit.json"), JSON.generate(exit_payload))
    File.write(File.join(@state, "hold.json"), JSON.generate(hold_payload))
  end

  def wrapper_observation(overrides = {})
    ready = JSON.parse(File.read(File.join(@state, "runner-ready.json")))
    launch = JSON.parse(File.read(File.join(@state, "launch.json")))
    baseline = { "verdict" => "live", "pid" => 66, "ppid" => 55,
      "processGroup" => 44, "foregroundProcessGroup" => 44,
      "startedAt" => prior_second(ready), "tty" => "ttys001",
      "command" => launch.fetch("wrapperArgv").drop(1).join(" "),
      "observedAt" => Time.now.utc.iso8601 }
    baseline.merge(overrides)
  end

  def prior_second(receipt)
    (Time.parse(receipt.fetch("recordedAt")) - 1).utc.iso8601
  end
end

module CleanupTestFixture
  def setup
    super
    invoke(start_args, FakeCommandRunner.new(successful_start_results))
  end

  def cleanup_args
    ["cleanup", "--state-dir", @state, "--settlement-message", "msg_done1"]
  end

  def invoke(argv, runner, process_observer: nil)
    ready = File.file?(File.join(@state, "runner-ready.json"))
    observer = process_observer
    observer ||= FakeProcessObserver.new(wrapper_observation) if argv.first == "cleanup" && ready
    super(argv, runner, process_observer: observer)
  end

  def cleanup_prechecks
    [worker_show_response("completed", "succeeded"), terminal_show_response,
     settlement_response].map { |item| command_result(item) }
  end
end
