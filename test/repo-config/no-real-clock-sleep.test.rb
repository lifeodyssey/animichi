# SUT: no test under `.github/test/` or `test/repo-config/` sleeps on a real
# clock (#1770).
#
# The rule's origin is a measurement: `release-schema-gate.test.rb` spent 142 s
# of the contracts lane on nine real 15-second waits, and the repo's own testing
# strategy already says to mock the clock. That file now injects its intervals;
# this guard is the general rule those facts became, quantified over whatever
# files the two trees actually hold — not a frozen list that a new test quietly
# escapes.
#
# What a grep can and cannot catch, honestly: any line that invokes sleep with
# a literal number states its delay on the face of the source — a shell sleep,
# Ruby's `Kernel.sleep`, or a heredoc writing a stub binary — and is refused
# here. An argument that is a variable or an interpolation cannot be judged
# statically, and a waiter that never names sleep is invisible to it; the
# reviewable seam this guard draws is that a test may not state a literal
# delay. Zero is not the real clock and stays legal, so a stub can still
# answer a waiter's shape without waiting.
require "minitest/autorun"

class NoRealClockSleepTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SCANNED_GLOBS = ["{.github/test,test/repo-config}/**/*.rb",
                   "{.github/test,test/repo-config}/**/*.sh"].freeze
  # A word boundary keeps `sleeps` and `sleepless` out; the boundary after a
  # dot keeps `Kernel.sleep` in.
  SLEEP_CALL = /\bsleep\s+(\d+(?:\.\d+)?)/.freeze
  CONSEQUENCE = "tests must not sleep on the real clock (#1770)"
  GUIDANCE = <<~MESSAGE.freeze
    Mock the clock instead: inject the interval (an environment variable the
    test sets to zero) or stub sleep on PATH, as the schema-preflight suites
    already do. This guard is grep-level and honest about its gaps: an
    argument that is a variable or an interpolation is not caught, and
    neither is a waiter that does not name sleep.
  MESSAGE

  def test_no_repository_test_sleeps_on_the_real_clock
    offenders = scanned_tests.flat_map { |path| sleeping_lines(path) }
    assert_empty offenders, refusal(offenders)
  end

  private

  def scanned_tests
    SCANNED_GLOBS.flat_map { |glob| Dir.glob(File.join(ROOT, glob)).sort }
  end

  # A literal zero names no delay, so it is not an offender; any other literal
  # number is, wherever on the line it sits.
  def sleeping_lines(path)
    File.readlines(path).each_with_index.map do |line, index|
      stated = line.match(SLEEP_CALL)
      next if stated.nil? || stated[1].to_f.zero?
      "#{path}:#{index + 1}: #{line.strip}"
    end.compact
  end

  def refusal(offenders)
    quoted = offenders.map { |line| "  #{line}" }.join("\n")
    <<~MESSAGE
      #{CONSEQUENCE}. These lines state a literal delay:
      #{quoted}
      #{GUIDANCE}
    MESSAGE
  end
end
