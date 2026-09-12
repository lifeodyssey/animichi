# frozen_string_literal: true

require_relative "test_helper"

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
