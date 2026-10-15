# SUT: the database-access osv time-boxed ignore record for GHSA-ch52-4w7c-c8xp and the owner
# decision entry in docs/agents/owner-decisions.md that approves it. The toml holds the security
# lane down only until the expiry its own record approves, so both records must state the same
# operative expiry day: this check pins every statement of that day, in either record, to the
# toml's `ignoreUntil`. It pins the day only — whether the records' reasons still agree is for
# review to settle by reading the two texts side by side, since policing prose reasons with
# regexes is the documentation-consistency test this repository deletes on sight. The day check
# is lexical in turn: OPERATIVE lists the phrasings the records state the day in ("extended it
# to …", "new expiry …", "expires on …", "From … the lane is red"), and an expiry written in a
# phrasing OPERATIVE does not list is outside this check. Procedural: delete this file together
# with the ignore entry and the decision entry.
require "minitest/autorun"

class OsvIgnoreConsistencyTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  TOML = "infra/database-access/osv-scanner.toml"
  DECISIONS = "docs/agents/owner-decisions.md"
  ID = "GHSA-ch52-4w7c-c8xp"
  HEADING = "## osv ignore for #{ID} (2026-10-04)"
  # The sentence shapes the two records state the operative expiry in today. Every other date
  # the pair names — either approval day, the advisory's update, the superseded first window —
  # is dated history that must not satisfy these shapes.
  OPERATIVE = [
    /extended it to (\d{4}-\d{2}-\d{2})/,
    /new expiry(?: of)? (\d{4}-\d{2}-\d{2})/,
    /expires on (\d{4}-\d{2}-\d{2})/,
    /From (\d{4}-\d{2}-\d{2}) the lane is red/,
  ].freeze

  def test_every_operative_expiry_the_two_records_state_equals_the_toml_ignore_until
    drift = operative_dates.uniq - [ignore_until]
    assert_empty(drift, "the records state an operative expiry other than the toml's: " \
                        "#{TOML} has #{ID} expiring on #{ignore_until}, " \
                        "but they also state #{drift.inspect}")
  end

  def test_the_toml_header_times_the_second_approval_and_the_return_to_red
    assert_includes squashed(header), "extended it to #{ignore_until}",
                    "the toml header no longer times the second approval " \
                    "to its entry's `ignoreUntil`"
    assert_includes squashed(header), "From #{ignore_until} the lane is red",
                    "the toml header no longer states the day the lane goes red " \
                    "from that same `ignoreUntil`"
  end

  def test_the_toml_reason_closes_with_the_same_day
    assert_includes squashed(reason), "new expiry #{ignore_until}",
                    "the toml `reason` is what every scanner failure prints; " \
                    "it must carry the approved expiry day"
  end

  def test_the_decision_entry_names_the_same_extension_day
    assert_includes squashed(section.to_s), "with a new expiry of #{ignore_until}",
                    "the decision entry no longer records the expiry day the owner approved"
    assert_includes squashed(section.to_s), "From #{ignore_until} the lane is red",
                    "the decision entry's return-to-red day no longer matches the toml it leaves with"
  end

  def test_the_ignore_and_its_decision_entry_leave_together
    assert_equal(!section.nil?, !tracked_block.nil?,
                 "the toml ignore and the `#{DECISIONS}` entry are one suppression decision: " \
                 "keeping either half alone leaves a suppression without approval " \
                 "or an approval of nothing")
  end

  private

  def toml
    @toml ||= File.read(File.join(ROOT, TOML))
  end

  def decisions
    @decisions ||= File.read(File.join(ROOT, DECISIONS))
  end

  # Wrapping inside one of the pinned phrases is not a wording change, so every phrase check
  # runs against the text with comment markers and whitespace runs collapsed away.
  def squashed(text)
    text.gsub(/^#/, "").gsub(/\s+/, " ")
  end

  # The entry this record is about, from the first `[[IgnoredVulns]]` marker onward; the comment
  # header names the same advisory id, so the pre-marker piece must stay out.
  def tracked_block
    toml.split("[[IgnoredVulns]]").drop(1).find { |block| block.include?(ID) }
  end

  def header
    toml.split("[[IgnoredVulns]]").first
  end

  def reason
    tracked_block.to_s[/\nreason = "([^"]*)"/, 1].to_s
  end

  def ignore_until
    tracked_block.to_s[/ignoreUntil = (\d{4}-\d{2}-\d{2})/, 1] ||
      flunk("#{TOML} carries no #{ID} entry with an `ignoreUntil` date")
  end

  # The section of the decisions doc that approves this ignore, up to the next `## ` heading;
  # nil once the entry has left, which the togetherness test reads.
  def section
    @section ||= decisions[/#{Regexp.escape(HEADING)}.*?(?=\n## |\z)/m]
  end

  def operative_dates
    [toml, section].compact.flat_map do |source|
      text = squashed(source)
      OPERATIVE.flat_map { |shape| text.scan(shape).flatten }
    end
  end
end
