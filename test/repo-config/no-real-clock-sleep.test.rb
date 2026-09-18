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
# a literal number states its delay on the face of the source — bare
# (`sleep N`), parenthesised (`sleep(N)`), receiver-qualified (`Kernel.sleep
# N`, `Kernel.sleep(N)`), the number whole, dotted (`sleep N.N`), or a
# leading-dot fraction (`sleep .N`), a shell sleep, or a heredoc writing a
# stub binary — and is refused here, and the line is read as a whole: every
# stated literal
# is judged, so a zero-delay call does not launder a line whose other call
# states a real delay. An argument that is a variable or an interpolation
# cannot be judged statically, and a waiter that never names sleep is
# invisible to it; the reviewable seam this guard draws is that a test may
# not state a literal delay. A line whose only stated delays are zeros stays
# legal — zero is not the real clock — so a stub can still answer a waiter's
# shape without waiting. (These examples spell the delay N because a literal
# here would make this file refuse itself.)
require "minitest/autorun"

class NoRealClockSleepTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SCANNED_GLOBS = ["{.github/test,test/repo-config}/**/*.rb",
                   "{.github/test,test/repo-config}/**/*.sh"].freeze
  # A word boundary keeps `sleeps` and `sleepless` out; the boundary after a
  # dot keeps `Kernel.sleep` in. The argument is then captured in the two
  # spellings a line actually writes it — a run of whitespace before a bare
  # number, or a number inside parentheses, whose closing half is optional
  # because an unclosed one still states the delay. The number itself is
  # taken whole, dotted, or as a leading-dot fraction: `sleep .N` states the
  # same real delay as `sleep N.N`, and `sleep  .N` — any run of whitespace —
  # states the same delay as `sleep .N`.
  SLEEP_CALL = /\bsleep(?:\s+|\s*\(\s*)((?:\d+(?:\.\d+)?|\.\d+))(?:\s*\))?/.freeze
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

  # A line is an offender if any literal delay it states is non-zero — not
  # only its first: a zero-delay call does not launder a line whose other
  # call states a real delay. A literal zero names no delay, so a line whose
  # stated delays are all zeros is not an offender.
  def sleeping_lines(path)
    File.readlines(path).each_with_index.map do |line, index|
      next unless states_a_nonzero_delay?(line)
      "#{path}:#{index + 1}: #{line.strip}"
    end.compact
  end

  def states_a_nonzero_delay?(line)
    line.scan(SLEEP_CALL).any? { |stated| !stated.first.to_f.zero? }
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
