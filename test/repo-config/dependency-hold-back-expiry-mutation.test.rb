# SUT: test/repo-config/dependency-hold-back-expiry.test.rb — the expiry on every hold-back line.
# Every probe copies that contract, its two readers and the workspace manifest into a throwaway tree,
# mutates the copy, and runs the copied contract; the committed files are never written to. Each
# probe has to go red AND name its subject: a register that stays green past a line's date, or with
# a line that names no date, is a register whose exceptions never lapse. The past-date probe moves
# the line to yesterday by the real clock, so a check that stopped reading the clock, frozen at any
# fixed day, cannot pass it.
require "minitest/autorun"
require "date"
require "fileutils"
require "open3"
require "tmpdir"

class DependencyHoldBackExpiryMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/dependency-hold-back-expiry.test.rb"
  FILES = [CONTRACT, "test/repo-config/dependency_hold_back_expiry.rb", "test/repo-config/dependency_hold_backs.rb",
           "pnpm-workspace.yaml"].freeze
  MANIFEST = "pnpm-workspace.yaml"
  # The first register line's expiry, found by shape so a review that moves the date keeps the needle.
  EXPIRY = /^(\s*# hold-back: .* — #\d+), expires \d{4}-\d{2}-\d{2}$/
  UNDATED = "no `, expires <YYYY-MM-DD>` after its issue"
  # Only the check that reads the committed register runs: the cases beside it quote the same
  # messages, so a probe running them too could be named by a case's failure diff instead of by
  # the check it mutated.
  LIVE_CHECK = "test_no_line_in_the_register_has_lapsed_or_names_no_expiry"

  # Yesterday stays lapsed even when midnight passes between this process and the copied contract's.
  def yesterday
    Date.today - 1
  end

  def with_tree
    Dir.mktmpdir("hold-back-expiry-mutation-") do |root|
      FILES.each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def rewrite(root, replacement, label)
    path = File.join(root, MANIFEST)
    source = File.read(path)
    changed = source.sub(EXPIRY, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    File.write(path, changed)
  end

  def run_contract(root)
    Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT), "-n", LIVE_CHECK)
  end

  def reject_tree(root, label, consequence)
    out, err, status = run_contract(root)
    refute status.success?, "mutation survived: #{label}"
    assert_includes out + err, consequence, "mutation must name its consequence: #{label}"
  end

  def test_accepts_an_unmutated_copy
    with_tree do |root|
      out, err, status = run_contract(root)
      assert status.success?, "an unmutated copy must pass: the committed register\n#{out}#{err}"
    end
  end

  def test_rejects_a_line_that_lapsed_yesterday
    day = yesterday
    with_tree do |root|
      rewrite(root, "\\1, expires #{day.iso8601}", "a register line's expiry")
      reject_tree(root, "a register line that lapsed yesterday", "expired on #{day.iso8601}")
    end
  end

  def test_rejects_a_line_that_names_no_expiry
    with_tree do |root|
      rewrite(root, '\1', "a register line's expiry")
      reject_tree(root, "a register line with its expiry deleted", UNDATED)
    end
  end
end
