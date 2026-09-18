# SUT: test/repo-config/no-real-clock-sleep.test.rb — the rule has to fire.
#
# The contract asserts the absence of something, which is exactly the shape of
# guard that survives a rewrite by passing. Every probe points the contract's
# TEST_REPOSITORY_ROOT at a throwaway tree, injects one stated delay into a
# probe test, and requires the contract to refuse it (the committed files are
# never written to). A guard that cannot fail is not evidence (#1770).
require "minitest/autorun"
require "open3"
require "tmpdir"
require "fileutils"

class NoRealClockSleepMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = File.join(ROOT, "test/repo-config/no-real-clock-sleep.test.rb")
  CONSEQUENCE = "tests must not sleep on the real clock"
  # Each mutation pairs the probe line with the tree it is planted in. The
  # probe lines interpolate their numbers so this file's own text never
  # carries a literal the contract could refuse — a twin that failed its own
  # guard would prove nothing.
  MUTATIONS = {
    "a whole-second shell sleep" => ["sleep #{15}", ".github/test"],
    "a fractional sleep" => ["sleep #{0.5}", ".github/test"],
    "a Kernel.sleep with a literal" => ["Kernel.sleep #{2}", ".github/test"],
    "a sleep inside a generated stub" => ["  'containers info') sleep #{3} ;;", ".github/test"],
    "the same delay in the repo-config tree" => ["sleep #{9}", "test/repo-config"]
  }.freeze

  def test_the_rule_rejects_every_stated_delay
    MUTATIONS.each do |label, (line, tree)|
      run_contract_with_probe(line, label, tree) do |status, output|
        refute status.success?, "mutation survived: #{label}"
        assert_includes output, CONSEQUENCE, "mutation must name its consequence: #{label}"
      end
    end
  end

  def test_the_rule_accepts_a_test_without_a_delay
    run_contract_with_probe("assert_equal 4, 2 + 2", "plain", ".github/test") do |status, output|
      assert status.success?, "a test without a stated delay must be accepted\n#{output}"
    end
  end

  # Zero names no delay — the carve-out the contract documents — so it must
  # stay legal, or a stub answering a waiter's shape could never be written.
  def test_the_rule_accepts_a_literal_zero
    run_contract_with_probe("sleep #{0}", "zero", ".github/test") do |status, output|
      assert status.success?, "a literal zero cannot delay anything\n#{output}"
    end
  end

  private

  def run_contract_with_probe(line, label, tree)
    Dir.mktmpdir("no-real-clock-sleep-mutation-") do |root|
      write_probe(root, tree, label, line)
      yield(*run_contract(root))
    end
  end

  def write_probe(root, tree, label, line)
    name = label.tr(" .-", "")
    probe = File.join(root, tree, "probe--#{label.tr(' .', '--')}.test.rb")
    FileUtils.mkdir_p(File.dirname(probe))
    File.write(probe, <<~PROBE)
      require "minitest/autorun"
      class Probe#{name}Test < Minitest::Test
        def test_probe
          #{line}
        end
      end
    PROBE
  end

  def run_contract(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, CONTRACT)
    [status, out + err]
  end
end
