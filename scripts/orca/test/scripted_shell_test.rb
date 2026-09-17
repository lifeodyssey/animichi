# frozen_string_literal: true

require "minitest/autorun"
require_relative "scripted_shell"

# The stub answers at an argument boundary: a command whose final argument merely extends a
# registered key's last token is unstubbed, not a silent reuse of the shorter key's response.
class ScriptedShellTest < Minitest::Test
  def test_answers_the_exact_command
    shell = ScriptedShell.new("git status --porcelain" => "")
    assert_equal "", shell.call(%w[git status --porcelain]).stdout
  end

  def test_answers_a_command_that_continues_with_another_argument
    shell = ScriptedShell.new("git -C /repo log" => "c1\n")
    assert_equal "c1\n", shell.call(["git", "-C", "/repo", "log", "-1"]).stdout
  end

  def test_a_partial_final_argument_is_an_unstubbed_command
    shell = ScriptedShell.new("git status --porcelain" => "")
    error = assert_raises(RuntimeError) { shell.call(%w[git status --porcelain=v2]) }
    assert_match(/unstubbed command/, error.message)
  end
end
