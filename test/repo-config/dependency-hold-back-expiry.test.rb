# SUT: the expiry every `# hold-back:` line in pnpm-workspace.yaml states, read by
# test/repo-config/dependency_hold_back_expiry.rb. A hold-back is an exception to the
# latest-dependencies rule, and an exception names the date it lapses on: a line past that date,
# or a line that names none, is a finding.
require "minitest/autorun"
require "date"
require_relative "dependency_hold_back_expiry"

class DependencyHoldBackExpiryTest < Minitest::Test
  DATED = "  # hold-back: vitest@^4.1.11 -> 5.0.1 fails workers/users test:worker — #1742, expires 2027-01-31"
  UNDATED = "  # hold-back: vitest@^4.1.11 -> 5.0.1 fails workers/users test:worker — #1742"
  # The workspace file's own header quotes the shape; quoting it is not registering anything.
  QUOTED = "#   `# hold-back: <package>@<declared> -> <latest> fails <gate> — #<issue>, expires <YYYY-MM-DD>`"

  def findings(line, today)
    HoldBacks.expiry_findings(["catalog:", line], today: today)
  end

  # The one check that reads the real date, on purpose: on the day a committed line lapses, every
  # run goes red until the pin is retired or the owner moves the date. The cases below inject theirs.
  def test_no_line_in_the_register_has_lapsed_or_names_no_expiry
    lines = HoldBacks::Declarations.new.register_source.lines.map(&:chomp)
    lapsed = HoldBacks.expiry_findings(lines, today: Date.today)
    assert_empty lapsed, "the hold-back register disagrees with the calendar:\n  #{lapsed.join("\n  ")}"
  end

  def test_a_line_is_in_force_the_day_before_its_expiry
    assert_empty findings(DATED, Date.new(2027, 1, 30))
  end

  def test_a_line_has_lapsed_on_its_expiry_date
    assert_equal ["line 2: vitest@^4.1.11 expired on 2027-01-31 — retire the pin, or the owner extends the date"],
                 findings(DATED, Date.new(2027, 1, 31))
  end

  def test_a_line_that_names_no_expiry_is_refused_by_name
    assert_equal ["line 2: no `, expires <YYYY-MM-DD>` after its issue"], findings(UNDATED, Date.new(2027, 1, 1))
  end

  # A dated line that lost the register's shape, here a hyphen where the em dash goes, is refused
  # by name rather than passed as a line with nothing to report.
  def test_a_dated_line_in_another_shape_is_refused_by_name
    assert_equal ["line 2: not in the register's one shape (see pnpm-workspace.yaml's header)"],
                 findings(DATED.sub(" — #", " - #"), Date.new(2027, 1, 1))
  end

  def test_a_date_the_calendar_does_not_have_is_refused
    assert_equal ["line 2: 2027-02-30 is not a calendar date"],
                 findings(DATED.sub("2027-01-31", "2027-02-30"), Date.new(2027, 1, 1))
  end

  def test_the_header_that_quotes_the_shape_is_not_a_register_line
    assert_empty findings(QUOTED, Date.new(2099, 1, 1))
  end
end
