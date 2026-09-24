# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

module KimiTestFixture
  KIMI_MODEL = "kimi-code/k3-256k-max".freeze

  def kimi_start_args
    start_args("kimi", KIMI_MODEL, "max")
  end

  def kimi_binary
    File.realpath(File.join(@bin, "kimi"))
  end

  def start_kimi(runner = FakeCommandRunner.new(successful_start_results))
    invoke(kimi_start_args, runner)
  end
end

# kimi is one more fixed selection: only kimi/kimi-code/k3-256k/max is accepted.
class HeadlessKimiSelectionTest < Minitest::Test
  include HeadlessFixture
  include KimiTestFixture

  def test_accepts_the_fixed_kimi_selection_and_resolves_the_kimi_binary
    input = OrcaHeadless::StartInputParser.parse(kimi_start_args.drop(1), resolver: @resolver)
    assert_equal ["kimi", KIMI_MODEL, "max"], [input.provider, input.model, input.effort]
    assert_equal kimi_binary, input.agent
  end

  # The plain `kimi-code/k3-256k` alias is refused on purpose: its config default_effort is
  # "high", so a lane selecting it would run a rung below the effort its own receipt records.
  def test_refuses_the_plain_alias_whose_configured_effort_is_not_max
    assert_refused("kimi", "kimi-code/k3-256k", "max")
  end

  def test_refuses_a_kimi_effort_below_the_fixed_selection
    assert_refused("kimi", KIMI_MODEL, "high")
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

# The argv is pinned here because kimi's non-interactive contract is unusual in three ways that
# a reader will otherwise re-derive by trial: -p takes the prompt as an ARGUMENT (it rejects
# stdin), it cannot be combined with --auto or --yolo, and --output-format is refused outside
# prompt mode. A narrowing or a "helpful" added flag would break the lane at launch, silently,
# and the wrapper is the only place any of that is written down.
class HeadlessKimiCommandTest < Minitest::Test
  include HeadlessFixture
  include KimiTestFixture
  include RuntimeFixtures

  def test_runs_kimi_in_prompt_mode_through_a_shell_that_reads_the_pinned_prompt
    start_kimi
    argv = runner_config.fetch("argv")
    assert_equal ["/bin/sh", "-c"], argv.take(2),
                 "kimi cannot take the prompt on stdin and the preamble is written after the " \
                 "argv is built, so the file has to be read at exec time"
    assert_equal [kimi_binary, KIMI_MODEL, File.join(File.realpath(@state), "prompt.txt")],
                 argv.drop(3),
                 "the executable, the model and the prompt path are positional parameters"
  end

  def test_the_shell_script_never_interpolates_its_arguments
    start_kimi
    script = runner_config.fetch("argv").fetch(2)
    assert_equal 'exec "$0" -m "$1" --output-format text -p "$(cat "$2")"', script,
                 "every value reaches kimi as a positional parameter, so no path and no byte " \
                 "of the prompt can be read as shell"
  end

  def test_carries_no_approval_flag_because_prompt_mode_refuses_every_one
    script = (start_kimi; runner_config.fetch("argv").fetch(2))
    refute_includes script, "--yolo", "kimi refuses: Cannot combine --prompt with --yolo"
    refute_includes script, "--auto", "kimi refuses: Cannot combine --prompt with --auto"
  end

  def test_reads_an_empty_stdin_and_writes_plain_text_output
    start_kimi
    state = File.realpath(@state)
    assert_equal File.join(state, "empty.stdin"), runner_config.fetch("stdin")
    assert_equal File.join(state, "output.txt"), runner_config.fetch("stdout")
    assert_equal "", File.binread(File.join(state, "empty.stdin")),
                 "the prompt travels in the argv, so stdin must be empty rather than absent"
  end
end
