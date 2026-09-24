# frozen_string_literal: true

require_relative "test_helper"

# Both lists are literal on purpose: deriving either from StartInputParser::MODELS would let a
# retired selection return or a current one disappear without this test going red.
class HeadlessFixedSelectionTest < Minitest::Test
  include HeadlessFixture

  RETIRED_SELECTIONS = [
    ["codex", "gpt-5.6-sol", "max"],
    ["codex", "gpt-6-astra", "xhigh"],
    ["grok", "grok-4.6", "xhigh"],
    ["command-code", "deepseek/deepseek-v4-flash", "max"],
    ["claude", "claude-opus-5", "high"],
    ["claude", "claude-fable-5-1", "high"],
    ["claude", "claude-sonnet-5", "max"],
  ].freeze

  CURRENT_SELECTIONS = [
    ["pi", "opencode-go/deepseek-v4.1-flash", "max"],
    ["pi", "bigmodel/glm-5.3-flash", "max"],
    ["pi", "opencode-go/mimo-v2.5-pro", "max"],
    ["pi", "opencode-go/mimo-v2.5", "max"],
    ["claude", "claude-opus-5", "max"],
    ["kimi", "kimi-code/k3-256k-max", "max"],
  ].freeze

  def test_refuses_each_retired_selection
    RETIRED_SELECTIONS.each { |selection| assert_refused(*selection) }
  end

  def test_accepts_every_selection_in_the_current_roster
    CURRENT_SELECTIONS.each { |selection| assert_accepted(*selection) }
  end

  private

  def assert_refused(provider, model, effort)
    error = assert_raises(OrcaHeadless::InputError) { parse_selection(provider, model, effort) }
    assert_equal "unsupported provider/model/effort", error.message, selection(provider, model, effort)
  end

  def assert_accepted(provider, model, effort)
    input = parse_selection(provider, model, effort)
    assert_equal [provider, model, effort], [input.provider, input.model, input.effort]
  end

  def parse_selection(provider, model, effort)
    OrcaHeadless::StartInputParser.parse(start_args(provider, model, effort).drop(1),
                                         resolver: @resolver)
  end

  def selection(provider, model, effort)
    [provider, model, effort].join("/")
  end
end

class HeadlessStateParentInputTest < Minitest::Test
  include HeadlessFixture

  def test_reports_a_missing_state_parent_as_an_input_error
    assert_invalid_parent(File.join(@root, "missing", "attempt"))
  end

  def test_reports_a_file_state_parent_as_an_input_error
    parent = File.join(@root, "parent-file")
    File.binwrite(parent, "not a directory")
    assert_invalid_parent(File.join(parent, "attempt"))
  end

  private

  def assert_invalid_parent(path)
    args = start_args
    args[args.index("--state-dir") + 1] = path
    runner = FakeCommandRunner.new
    code, _out, error = invoke(args, runner)
    assert_equal 1, code
    assert_match(/state directory parent is not a directory/, error)
    assert_empty runner.calls
  end
end
