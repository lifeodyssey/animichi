# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

require "rbconfig"
require "shellwords"

class HeadlessStartValidationTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures

  def test_refuses_an_existing_state_directory_before_transport
    Dir.mkdir(@state, 0o700)
    runner = FakeCommandRunner.new
    code, = invoke(start_args, runner)
    assert_equal 1, code
    assert_empty runner.calls
    assert_empty Dir.children(@state)
  end

  def test_records_an_unsupported_runtime_without_creating_a_terminal
    failure = { "ok" => false, "error" => { "code" => "unsupported_orca_version" } }
    runner = FakeCommandRunner.new([command_result(failure, 1)])
    code, _out, err = invoke(start_args, runner)
    assert_compatibility_failure(code, err, runner)
  end

  private

  def assert_compatibility_failure(code, error, runner)
    assert_equal 1, code
    assert_equal 1, runner.calls.length
    assert_match(/compatibility failed/, error)
    receipt = JSON.parse(File.read(File.join(@state, "failure.json")))
    assert_equal "compatibility", receipt.fetch("stage")
    refute File.exist?(File.join(@state, "terminal-request.json"))
  end
end

class HeadlessCommandResponseShapeTest < Minitest::Test
  include HeadlessFixture

  def test_refuses_a_null_runtime_response
    assert_invalid_runtime_response("null")
  end

  def test_refuses_a_scalar_runtime_response
    assert_invalid_runtime_response("7")
  end

  def test_refuses_an_array_runtime_response
    assert_invalid_runtime_response("[]")
  end

  def test_refuses_a_malformed_nested_runtime_error
    payload = JSON.generate("ok" => false, "error" => "invalid")
    result = OrcaHeadless::CommandResult.new(payload, "", 1)
    code, _out, error = invoke(start_args, FakeCommandRunner.new([result]))
    assert_equal 1, code
    assert_match(/command_failed/, error)
  end

  private

  def assert_invalid_runtime_response(stdout)
    result = OrcaHeadless::CommandResult.new(stdout, "", 0)
    code, _out, error = invoke(start_args, FakeCommandRunner.new([result]))
    assert_equal 1, code
    assert_match(/command returned invalid JSON object/, error)
  end
end

class HeadlessNativeHandleInputTest < Minitest::Test
  include HeadlessFixture

  def test_accepts_a_native_uuid_terminal_handle
    args = start_args.drop(1)
    handle = "term_453fd488-e290-403d-ac13-19662a805045"
    args[args.index("--coordinator") + 1] = handle
    input = OrcaHeadless::StartInputParser.parse(args, resolver: @resolver)
    assert_equal handle, input.coordinator
  end
end

class HeadlessDispatchFailureTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures

  def test_a_failed_dispatch_never_publishes_the_preamble
    failed = { "ok" => false, "error" => { "code" => "task_not_startable" } }
    results = successful_start_results.first(3) + [command_result(failed, 1)]
    code, = invoke(start_args, FakeCommandRunner.new(results))
    assert_failed_dispatch(code)
  end

  private

  def assert_failed_dispatch(code)
    assert_equal 1, code
    refute File.exist?(File.join(@state, "prompt.txt"))
    assert File.exist?(File.join(@state, "terminal.json"))
    assert File.exist?(File.join(@state, "task.json"))
    failure = JSON.parse(File.read(File.join(@state, "failure.json")))
    assert_equal "dispatch", failure.fetch("stage")
  end
end

class HeadlessStartIdentityTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures

  def test_preserves_unsafe_paths_as_argv_and_publishes_exact_preamble
    runner = FakeCommandRunner.new(successful_start_results)
    code, out, = invoke(start_args, runner)
    assert_equal 0, code
    assert_equal PREAMBLE.b, File.binread(File.join(@state, "prompt.txt"))
    assert_terminal_command
    assert_dispatch_command(runner, out)
  end

  def test_creates_private_state_and_records_exact_launch_identity
    code, = invoke(start_args, FakeCommandRunner.new(successful_start_results))
    assert_equal 0, code
    assert_equal 0o700, File.stat(@state).mode & 0o777
    assert_equal 0o600, File.stat(File.join(@state, "prompt.txt")).mode & 0o777
    assert_launch_identity
  end

  private

  def assert_terminal_command
    request = JSON.parse(File.read(File.join(@state, "terminal-request.json")))
    expected = ["exec", RbConfig.ruby, File.expand_path("../runner.rb", __dir__),
                "--state", File.realpath(@state), "--timeout", "120"]
    assert_equal expected, Shellwords.split(request.fetch("params").fetch("command"))
  end

  def assert_dispatch_command(runner, output)
    refute_includes runner.calls.fetch(3), "--inject"
    assert_includes runner.calls.fetch(3), "--return-preamble"
    assert_equal "started", JSON.parse(output).fetch("status")
  end

  def assert_launch_identity
    launch = JSON.parse(File.read(File.join(@state, "launch.json")))
    assert_equal "task_example1", launch.fetch("taskId")
    assert_equal "ctx_example1", launch.fetch("dispatchId")
    assert_equal PTY_ID, launch.dig("terminal", "ptyId")
    assert_equal INCARNATION, launch.dig("terminal", "incarnationId")
    values = launch.values_at("provider", "model", "effort")
    assert_equal ["claude", "claude-opus-5", "max"], values
  end
end
