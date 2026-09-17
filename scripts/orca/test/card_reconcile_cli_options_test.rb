# frozen_string_literal: true

require_relative "card_reconcile_cli_fixture"

# The CLI's own options: an unknown argument, an unparsable clock, and help.
class CliOptionsTest < Minitest::Test
  include CliFixture

  def test_an_unknown_argument_is_rejected
    with_root do |root|
      status, _stdout, stderr = invoke(root, ["--nonsense"])
      assert_equal 1, status
      assert_match(/invalid option: --nonsense/, stderr)
    end
  end

  def test_invalid_now_is_rejected
    with_root do |root|
      status, _stdout, stderr = invoke(root, ["--now", "yesterday"])
      assert_equal 1, status
      assert_match(/ISO8601/, stderr)
    end
  end

  def test_help_exits_zero
    stdout = StringIO.new
    status = Orca::CardReconcile::CLI.run(["--help"], stdout: stdout, stderr: StringIO.new,
                                                      command: stubbed_command)
    assert_match(/Usage: ruby scripts\/orca\/card-reconcile\.rb/, stdout.string)
    assert_equal 0, status
  end
end
