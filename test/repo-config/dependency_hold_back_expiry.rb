# frozen_string_literal: true
# The expiry half of the hold-back register; `dependency_hold_backs.rb` reads the rest. Every
# `# hold-back:` line ends with the date it lapses on, after its follow-up issue:
#
#   # hold-back: <package>@<declared> -> <latest> fails <gate> — #<issue>, expires <YYYY-MM-DD>
#
# A hold-back is an exception to the latest-dependencies rule, and an exception states its expiry
# (docs/agents/code-standards.md). From that date the line is lapsed: the contract stays red until
# the pin is retired or the owner extends the date. The day is a parameter, so a test names the
# day it means instead of reading the clock.
require "date"
require_relative "dependency_hold_backs"

module HoldBacks
  # A line that opens with the marker is a register line whatever else it says, so one that lost
  # its expiry — and with it the match on `REGISTER_LINE` — is refused by name, not read as prose.
  REGISTER_MARKER = "# hold-back:"
  EXPIRY_FIELD = ", expires "

  def self.expiry_findings(lines, today:)
    lines.each_with_index.map { |text, index| expiry_finding(text.strip, index + 1, today) }.compact
  end

  def self.expiry_finding(text, number, today)
    return nil unless text.start_with?(REGISTER_MARKER)
    return "line #{number}: no `#{EXPIRY_FIELD.strip} <YYYY-MM-DD>` after its issue" unless text.include?(EXPIRY_FIELD)

    match = REGISTER_LINE.match(text)
    return "line #{number}: not in the register's one shape (see #{WORKSPACE_MANIFEST}'s header)" if match.nil?

    lapse_finding(match, number, today)
  end

  # Lapsed ON the date it names: "expires 2027-01-31" is no longer in force on 2027-01-31.
  def self.lapse_finding(match, number, today)
    expires = Date.iso8601(match[:expires])
    return nil if today < expires

    "line #{number}: #{match[:package]}@#{match[:declared]} expired on #{expires} — retire the pin, " \
      "or the owner extends the date"
  rescue ArgumentError
    "line #{number}: #{match[:expires]} is not a calendar date"
  end
end
