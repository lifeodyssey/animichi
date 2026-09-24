# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

module PiTestFixture
  PI_MODEL = "opencode-go/deepseek-v4.1-flash".freeze
  PI_MODELS = [PI_MODEL, "bigmodel/glm-5.3-flash",
               "opencode-go/mimo-v2.5-pro", "opencode-go/mimo-v2.5"].freeze

  def pi_start_args
    start_args("pi", PI_MODEL, "max")
  end

  def pi_binary
    File.realpath(File.join(@bin, "pi"))
  end

  def start_pi(runner = FakeCommandRunner.new(successful_start_results))
    invoke(pi_start_args, runner)
  end
end

# The pi provider is a fixed set of selections: only the dispatched models in PI_MODELS at max
# are accepted, and nothing about the state directory or transport contract changes around them.
class HeadlessPiSelectionTest < Minitest::Test
  include HeadlessFixture
  include PiTestFixture

  def test_accepts_every_dispatched_pi_selection_and_resolves_the_pi_binary
    PI_MODELS.each do |model|
      input = OrcaHeadless::StartInputParser.parse(start_args("pi", model, "max").drop(1),
                                                   resolver: @resolver)
      assert_equal ["pi", model, "max"], [input.provider, input.model, input.effort], model
      assert_equal pi_binary, input.agent, model
    end
  end

  def test_refuses_an_unqualified_pi_model_selection
    assert_refused("pi", "deepseek-v4.1-flash", "max")
  end

  def test_refuses_a_pi_effort_below_the_fixed_selection
    assert_refused("pi", PI_MODEL, "high")
  end

  def test_refuses_another_providers_model_for_pi
    assert_refused("pi", "gpt-5.6-sol", "max")
  end

  def test_refuses_an_unknown_provider_instead_of_falling_back_to_grok
    input = OrcaHeadless::StartInput.new(nil, nil, nil, nil, nil, "unknown")
    assert_raises(OrcaHeadless::InputError) { OrcaHeadless::ModelCommand.build(input) }
  end

  def test_refuses_an_existing_state_directory_before_resolving_pi
    Dir.mkdir(@state, 0o700)
    runner = FakeCommandRunner.new
    code, = start_pi(runner)
    assert_equal 1, code
    assert_empty runner.calls
    assert_empty Dir.children(@state)
  end

  private

  def assert_refused(provider, model, effort)
    runner = FakeCommandRunner.new
    code, _out, error = invoke(start_args(provider, model, effort), runner)
    assert_equal 1, code
    assert_match(/unsupported provider\/model\/effort/, error)
    assert_empty runner.calls
    refute File.exist?(@state)
  end
end

class HeadlessPiCommandTest < Minitest::Test
  include HeadlessFixture
  include PiTestFixture
  include RuntimeFixtures

  def test_launches_print_mode_with_the_pinned_model_thinking_and_approval
    assert_equal 0, start_pi.first
    assert_equal [pi_binary, "--print", "--model", PI_MODEL, "--thinking", "max", "--approve"],
                 runner_config.fetch("argv")
  end

  def test_pipes_the_exact_preamble_from_the_pinned_prompt_file
    assert_equal 0, start_pi.first
    assert_equal File.join(File.realpath(@state), "prompt.txt"), runner_config.fetch("stdin")
    assert_equal PREAMBLE.b, File.binread(File.join(@state, "prompt.txt"))
  end

  def test_keeps_pi_in_print_mode_with_stdio_on_files
    assert_equal 0, start_pi.first
    argv = runner_config.fetch("argv")
    refute(argv.any? { |value| %w[--continue --resume --mode --tui-mode].include?(value) })
    assert_equal %w[output.txt stderr.log],
                 runner_config.values_at("stdout", "stderr").map { |path| File.basename(path) }
  end

  def test_records_provider_model_effort_and_the_spawnable_argv
    code, out, = start_pi
    assert_equal 0, code
    launch = JSON.parse(File.binread(File.join(@state, "launch.json")))
    assert_equal ["pi", PI_MODEL, "max"], launch.values_at("provider", "model", "effort")
    assert_equal runner_config.fetch("argv"), launch.fetch("modelArgv")
    assert_equal "started", JSON.parse(out).fetch("status")
    assert_equal runner_config.fetch("argv"),
                 OrcaHeadless::RunnerConfigLoader.load(File.realpath(@state)).argv
  end

  def test_keeps_the_state_directory_private
    assert_equal 0, start_pi.first
    assert_equal 0o700, File.stat(@state).mode & 0o777
    assert_equal 0o600, File.stat(File.join(@state, "prompt.txt")).mode & 0o777
  end

  def test_still_requires_positive_exit_evidence_before_cleanup
    assert_equal 0, start_pi.first
    args = ["cleanup", "--state-dir", @state, "--settlement-message", "msg_done1"]
    code, _out, error = invoke(args, FakeCommandRunner.new)
    assert_equal 1, code
    assert_match(/cleanup requires positive agent exit evidence/, error)
  end
end
