# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

module ClaudeTestFixture
  CLAUDE_MODEL = "claude-opus-5".freeze

  def claude_start_args
    start_args("claude", CLAUDE_MODEL, "max")
  end

  def claude_binary
    File.realpath(File.join(@bin, "claude"))
  end

  def start_claude(runner = FakeCommandRunner.new(successful_start_results))
    invoke(claude_start_args, runner)
  end
end

# The claude provider is one more fixed selection: only claude/claude-opus-5/max is accepted,
# and nothing about the state directory or transport contract changes around it.
class HeadlessClaudeSelectionTest < Minitest::Test
  include HeadlessFixture
  include ClaudeTestFixture

  def test_accepts_the_fixed_claude_selection_and_resolves_the_claude_binary
    input = OrcaHeadless::StartInputParser.parse(claude_start_args.drop(1), resolver: @resolver)
    assert_equal ["claude", CLAUDE_MODEL, "max"], [input.provider, input.model, input.effort]
    assert_equal claude_binary, input.agent
  end

  # Claude models no longer review (owner, 2026-09-24), so the review effort left the roster
  # with this landing: `high` is refused exactly like any unlisted effort.
  def test_refuses_the_retired_review_effort_high
    assert_refused("claude", CLAUDE_MODEL, "high")
  end

  def test_refuses_a_claude_model_alias_instead_of_the_fixed_model
    assert_refused("claude", "opus-5", "max")
  end

  def test_refuses_another_providers_model_for_claude
    assert_refused("claude", "gpt-5.6-sol", "max")
  end

  def test_refuses_an_unknown_provider_instead_of_falling_back_to_pi
    input = OrcaHeadless::StartInput.new(nil, nil, nil, nil, nil, "unknown")
    assert_raises(OrcaHeadless::InputError) { OrcaHeadless::ModelCommand.build(input) }
  end

  def test_refuses_an_existing_state_directory_before_resolving_claude
    Dir.mkdir(@state, 0o700)
    runner = FakeCommandRunner.new
    code, = start_claude(runner)
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

class HeadlessClaudeCommandTest < Minitest::Test
  include HeadlessFixture
  include ClaudeTestFixture
  include RuntimeFixtures

  def test_launches_print_mode_with_the_pinned_model_effort_and_permission_mode
    assert_equal 0, start_claude.first
    assert_equal [claude_binary, "--print", "--model", CLAUDE_MODEL, "--effort", "max",
                  "--permission-mode", "bypassPermissions"], runner_config.fetch("argv")
  end

  def test_pipes_the_exact_preamble_from_the_pinned_prompt_file
    assert_equal 0, start_claude.first
    assert_equal File.join(File.realpath(@state), "prompt.txt"), runner_config.fetch("stdin")
    assert_equal PREAMBLE.b, File.binread(File.join(@state, "prompt.txt"))
  end

  def test_keeps_claude_in_print_mode_with_stdio_on_files
    assert_equal 0, start_claude.first
    argv = runner_config.fetch("argv")
    refute(argv.any? { |value| %w[--continue --resume --background --cloud --tmux].include?(value) })
    assert_equal %w[output.txt stderr.log],
                 runner_config.values_at("stdout", "stderr").map { |path| File.basename(path) }
  end

  def test_records_provider_model_effort_and_the_spawnable_argv
    code, out, = start_claude
    assert_equal 0, code
    launch = JSON.parse(File.binread(File.join(@state, "launch.json")))
    assert_equal ["claude", CLAUDE_MODEL, "max"], launch.values_at("provider", "model", "effort")
    assert_equal runner_config.fetch("argv"), launch.fetch("modelArgv")
    assert_equal "started", JSON.parse(out).fetch("status")
    assert_equal runner_config.fetch("argv"),
                 OrcaHeadless::RunnerConfigLoader.load(File.realpath(@state)).argv
  end

  def test_keeps_the_state_directory_private
    assert_equal 0, start_claude.first
    assert_equal 0o700, File.stat(@state).mode & 0o777
    assert_equal 0o600, File.stat(File.join(@state, "prompt.txt")).mode & 0o777
  end

  def test_still_requires_positive_exit_evidence_before_cleanup
    assert_equal 0, start_claude.first
    args = ["cleanup", "--state-dir", @state, "--settlement-message", "msg_done1"]
    code, _out, error = invoke(args, FakeCommandRunner.new)
    assert_equal 1, code
    assert_match(/cleanup requires positive agent exit evidence/, error)
  end
end
