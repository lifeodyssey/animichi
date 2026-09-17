# SUT: test/repo-config/fixtures/dependency-hold-backs.json — the hold-back register
# (#1736). The fixture is the machine-readable snapshot; `pnpm-workspace.yaml` carries
# the reason beside each pin. One direction without the other is a hole: an entry with
# no line, or a line whose entry is no longer below latest, is a register that lies.
require "minitest/autorun"
require_relative "dependency_hold_backs"

class DependencyHoldBacksTest < Minitest::Test
  include HoldBacks

  def setup
    @declarations = HoldBacks::Declarations.new
    @snapshot = HoldBacks::Snapshot.new
    @source = @declarations.register_source
    @lines = @source.lines.map(&:chomp)
  end

  def register_lines
    # Ruby 2.6 (the macOS system ruby the pre-push gate runs) has no `filter_map`.
    @register_lines ||= @lines.each_with_index.map do |text, index|
      match = REGISTER_LINE.match(text.strip)
      next if match.nil?

      { index: index, package: match[:package], declared: match[:declared], latest: match[:latest], issue: match[:issue] }
    end.compact
  end

  def manifest_pins_block
    # The file's own prose names the block, so only a line that IS the marker opens it.
    marker = @lines.index { |line| line.strip.start_with?(MANIFEST_PINS_MARKER) }
    return (0...0) if marker.nil?

    relative = @lines[(marker + 1)..].index { |line| !line.strip.empty? && !line.strip.start_with?("#") }
    (marker + 1)...(relative.nil? ? @lines.length : marker + 1 + relative)
  end

  def catalog_line_index(entry)
    declared = entry.fetch("declared")
    @lines.index do |line|
      /\A\s+"?#{Regexp.escape(entry.fetch("package"))}"?:\s+"#{Regexp.escape(declared)}"\s*\z/.match?(line)
    end
  end

  def lines_for(entry)
    register_lines.select { |line| ["package", "declared", "latest"].all? { |key| line[key.to_sym] == entry.fetch(key) } }
  end

  # The declaration the fixture claims, still declared where it claims.
  def declaration_findings
    @snapshot.entries.map do |entry|
      found = @declarations.specifier_for(entry.fetch("package"))
      next if found == [entry.fetch("declared"), entry.fetch("declaredIn")]

      "#{entry.fetch('package')}: declared #{found.inspect}, the register says " \
        "[#{entry.fetch('declared').inspect}, #{entry.fetch('declaredIn').inspect}] — refresh the register"
    end.compact
  end

  # The other half of "below latest": a specifier that admits the latest release is not a hold-back.
  def below_latest_findings
    @snapshot.entries.map do |entry|
      next unless HoldBacks.admits?(entry.fetch("declared"), entry.fetch("latest"), name: entry.fetch("package"))

      "#{entry.fetch('package')}@#{entry.fetch('declared')}: admits #{entry.fetch('latest')} — " \
        "not a hold-back, so take the bump and delete its register line"
    end.compact
  end

  # Every line for an entry has to be in that entry's one registered place, so a second copy
  # somewhere else (the overrides entry, say) is a finding rather than a tolerated echo.
  def comment_findings
    @snapshot.entries.map do |entry|
      found = lines_for(entry)
      missing = ["#{entry.fetch('package')}@#{entry.fetch('declared')}: no `# hold-back:` line for it"]
      found.empty? ? missing : found.map { |line| placement_finding(entry, line) }
    end.flatten.compact
  end

  def placement_finding(entry, line)
    return block_placement_finding(entry, line) unless entry.fetch("declaredIn") == WORKSPACE_MANIFEST

    catalog_placement_finding(entry, line)
  end

  def catalog_placement_finding(entry, line)
    catalog = catalog_line_index(entry)
    return "#{entry.fetch('package')}: the catalog declares no entry at #{entry.fetch('declared').inspect}" if catalog.nil?
    return nil if line[:index] == catalog - 1

    "the line for #{entry.fetch('package')} is at line #{line[:index] + 1}, not immediately above its catalog entry at #{catalog + 1}"
  end

  def block_placement_finding(entry, line)
    return nil if manifest_pins_block.cover?(line[:index])

    "the line for #{entry.fetch('package')} is at line #{line[:index] + 1}, outside the `#{MANIFEST_PINS_MARKER}` block"
  end

  def orphan_findings
    register_lines.map do |line|
      next if @snapshot.entries.any? do |entry|
        entry.fetch("package") == line[:package] && entry.fetch("declared") == line[:declared] && entry.fetch("latest") == line[:latest]
      end

      "line #{line[:index] + 1}: #{line[:package]}@#{line[:declared]} -> #{line[:latest]} names an entry that is not below latest"
    end.compact
  end

  # The snapshot records the follow-up card each line cites, so "name the follow-up issue" is a
  # checked field rather than prose (round 1, must-fix 5: all eleven cited #1736, the card the
  # register was born from, which this change closes).
  def issue_findings
    @snapshot.entries.flat_map do |entry|
      recorded = entry["issue"]
      next ["#{entry.fetch('package')}@#{entry.fetch('declared')}: the snapshot carries no follow-up issue for it"] if recorded.nil?

      wrong_issue_findings(entry, recorded)
    end
  end

  def wrong_issue_findings(entry, recorded)
    lines_for(entry).reject { |line| line[:issue] == recorded.to_s }
                    .map { |line| "line #{line[:index] + 1}: cites ##{line[:issue]}, the snapshot registers ##{recorded}" }
  end

  def findings
    declaration_findings + below_latest_findings + comment_findings + orphan_findings + issue_findings
  end

  def test_every_below_latest_pin_carries_its_reason_and_nothing_else_does
    assert_empty findings, "the hold-back register disagrees with the tree:\n  #{findings.join("\n  ")}"
  end

  def test_the_snapshot_names_the_command_that_refreshes_it
    assert_equal "pnpm outdated -r --format json", @snapshot.command
    assert_match(/\A\d{4}-\d{2}-\d{2}\z/, @snapshot.refreshed)
  end

  def test_the_snapshot_records_a_follow_up_issue_for_every_entry
    missing = @snapshot.entries.reject { |entry| entry["issue"].is_a?(Integer) }.map { |entry| entry.fetch("package") }
    assert_empty missing, "entries with no follow-up issue in the snapshot: #{missing.join(', ')}"
  end

  # The card this change closes recorded the register; it cannot also be the card that retires
  # each pin, or a merged register would point at a closed card (round 1, must-fix 5).
  def test_no_register_line_cites_the_card_that_recorded_the_register
    stale = register_lines.select { |line| line[:issue] == "1736" }.map { |line| line[:package] }
    assert_empty stale, "lines still citing #1736: #{stale.join(', ')}"
  end

  # `Refresh#drift` and `--write` are covered by refresh-hold-backs.test.rb.
  def test_a_specifier_admits_a_release_its_range_allows
    assert HoldBacks.admits?("^4.0.103", "4.0.105")
    assert HoldBacks.admits?("~1.2.3", "1.2.9")
    assert HoldBacks.admits?(">=4.18.1 <5", "4.18.2")
    assert HoldBacks.admits?("^0.18.8", "0.18.9")
    assert HoldBacks.admits?("^8.0.0-rc.9", "8.0.0-rc.11")
    assert HoldBacks.admits?(">=8.0.0-rc.9", "8.0.0-rc.11")
    assert HoldBacks.admits?("4.4.3", "4.4.3")
  end

  # Two plain releases at the same core are one version: `Comparable` reads `==` through
  # `<=>`, and an exact pin that equals latest must not survive as a hold-back.
  def test_two_plain_releases_with_the_same_core_are_equal
    assert_equal 0, HoldBacks.parse("4.4.3") <=> HoldBacks.parse("4.4.3")
    assert_equal HoldBacks.parse("4.4.3"), HoldBacks.parse("4.4.3")
    assert_operator HoldBacks.parse("4.4.3-rc.1"), :<, HoldBacks.parse("4.4.3")
  end

  # SemVer §11: `rc.11` is later than `rc.9`, which a string comparison gets wrong, and the
  # caret/floor readers above start with `version < base`, so a wrong order decides a range
  # wrongly (fix round 1, must-fix 2).
  def test_a_prerelease_orders_by_semver_precedence_not_by_string
    refute_operator HoldBacks.parse("8.0.0-rc.11"), :<, HoldBacks.parse("8.0.0-rc.9")
    assert_operator HoldBacks.parse("8.0.0-rc.9"), :<, HoldBacks.parse("8.0.0-rc.11")
    assert_operator HoldBacks.parse("1.0.0-alpha"), :<, HoldBacks.parse("1.0.0-alpha.1")
    assert_operator HoldBacks.parse("1.0.0-alpha.1"), :<, HoldBacks.parse("1.0.0-alpha.beta")
    assert_operator HoldBacks.parse("8.0.0-rc.11"), :<, HoldBacks.parse("8.0.0")
  end

  def test_a_specifier_does_not_admit_a_release_its_range_excludes
    refute HoldBacks.admits?("^0.18.8", "0.22.0")
    refute HoldBacks.admits?("^1.15.11", "2.0.1-rc.32")
    refute HoldBacks.admits?("~1.2.3", "1.3.0")
    refute HoldBacks.admits?("^0.0.3", "0.0.4")
    refute HoldBacks.admits?("8.0.0-rc.9", "8.0.0-rc.11")
    refute HoldBacks.admits?("5.20260727.1", "5.20260916.1")
    refute HoldBacks.admits?("^1.2.3", "2.0.0-rc.1")
  end

  def test_a_specifier_the_reader_does_not_know_is_reported_rather_than_read_as_blocked
    error = assert_raises(RuntimeError) { HoldBacks.admits?("catalog:", "1.0.0", name: "hono") }
    assert_match(/hono: "catalog:"/, error.message)
  end

  def test_the_workspace_keeps_the_release_age_gate_the_derivation_depends_on
    assert_equal 1440, @declarations.minimum_release_age_minutes
  end
end
