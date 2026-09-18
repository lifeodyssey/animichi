# SUT: .gitleaks.toml and its default-rule inheritance.
# CI parity comes only from these exact Ruby invocations in
# `.github/workflows/pr-verification.yml`: `ruby test/repo-config/gitleaks-mutation.test.rb`,
# `ruby test/repo-config/gitleaks-pin-mutation.test.rb`, and
# `ruby test/repo-config/gitleaks.test.rb`; `quality.sh` was retired on this base.
# Values are read through test/repo-config/gitleaks_config.rb, which decodes the
# TOML spellings gitleaks honors and refuses the ones it cannot compare.
# Regex and stopword checks see only the finite probe shapes declared below.
# `.gitleaksignore`, inline `gitleaks:allow`, and allowlist `commits` are out of
# scope by design.
require "minitest/autorun"
require "psych"
require_relative "gitleaks_release"
require_relative "gitleaks_toml"

class GitleaksConfigTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CONFIG = ENV.fetch("GITLEAKS_CONFIG", File.join(ROOT, ".gitleaks.toml"))
  PRE_COMMIT = File.join(ROOT, ".pre-commit-config.yaml")
  WORKFLOW = File.join(ROOT, ".github/workflows/pr-verification.yml")
  GITLEAKS_REPO = "https://github.com/gitleaks/gitleaks"
  GITLEAKS_ACTION = "gitleaks/gitleaks-action@"

  CONSEQUENCE = 'gitleaks runs with zero rules and reports "no leaks found" for every secret'
  ABSENT = "gitleaks falls back to its default rules and nothing in the repository pins that inheritance"
  DISABLED = 'the named rules stop running and gitleaks reports "no leaks found" for the secrets they catch'
  REDEFINED = "redefining that inherited rule can stop it from reporting the secrets it is meant to catch"
  EXEMPTED = 'every matching file is exempt from every rule and gitleaks reports "no leaks found" for its secrets'
  HIDDEN = 'the matching secrets are dropped before they are reported, whatever rule found them'
  SILENCED = 'every secret containing it is dropped, silencing that rule class at any entropy'
  UNREADABLE = "this guard cannot read that configuration, and a config it cannot read is a config it cannot vouch for"
  NONCANONICAL = "gitleaks weak typing reads that spelling as a one-element list, so the guard would compare something other than what scans"
  DRIFTED = "the inventoried default rules are bound to the pinned gitleaks version, so a pin move must re-derive them"
  INVENTORY = "the inventory must be the pinned release's rule IDs, not a subset of them"

  SCANNED = [".", ".env", "workers/edge/src/entry.ts"].freeze

  PROBE_BODY = "QWERTYUIOPASDFGHJKLZXCVBNM0123456789"

  REPORTABLE = [
    "ghp_#{PROBE_BODY}",
    "AKIA#{PROBE_BODY[0, 16]}",
    "glpat-#{PROBE_BODY[0, 20]}",
    "AIzaSy#{PROBE_BODY[0, 33]}"
  ].freeze

  def setup
    assert File.file?(CONFIG), "#{CONFIG} is missing — #{ABSENT}"
    @assignments = GitleaksToml.read(File.read(CONFIG))
  rescue GitleaksToml::Unsupported => error
    flunk "#{CONFIG}: #{error.message} — #{UNREADABLE}"
  end

  # ---- the pinned scanner and the inventory that has to track it ----

  def test_inventory_is_the_pinned_releases_default_rules
    ids = GitleaksRelease::DEFAULT_RULE_IDS
    assert_equal 222, ids.size, "#{INVENTORY}: #{ids.size} entries"
    assert_equal ids, ids.uniq, "#{INVENTORY}: duplicate entries"
  end

  def test_pre_commit_scanner_pin_matches_the_inventoried_release
    assert_equal "v#{GitleaksRelease::PINNED_VERSION}", pre_commit_rev, "#{PRE_COMMIT}: #{DRIFTED}"
  end

  def test_ci_scanner_pin_matches_the_inventoried_release
    assert_equal GitleaksRelease::PINNED_VERSION, ci_action_version, "#{WORKFLOW}: #{DRIFTED}"
  end

  # ---- inheritance and the redefinition that reaches the same effect ----

  def test_default_rules_remain_enabled
    flags = fields("extend", "useDefault").map(&:value)
    assert_equal [true], flags, "#{CONFIG}: [extend] must set useDefault = true — #{CONSEQUENCE}"
  end

  def test_no_inherited_rule_is_disabled
    disabled = fields("extend", "disabledRules").first
    assert_nil disabled, "#{CONFIG}: [extend] carries #{disabled&.key} — #{DISABLED}"
  end

  def test_no_default_rule_is_redefined
    redefinition = GitleaksToml.rule_ids(@assignments).find { |id| GitleaksRelease::DEFAULT_RULE_IDS.include?(id) }
    assert_nil redefinition, "#{CONFIG}: rule id #{redefinition.inspect} — #{REDEFINED}"
  end

  # ---- the value-side checks, on decoded values ----

  def test_allowlist_values_are_canonical_string_arrays
    offender = watched_values.find { |assignment| GitleaksToml.strings(assignment).nil? }
    assert_nil offender, "#{CONFIG}: #{offender&.key} = #{offender&.value.inspect} — #{NONCANONICAL}"
  end

  def test_allowlist_does_not_exempt_scanned_paths
    exempted = allowlist_values("paths").find { |pattern| exempts_scanned_paths?(pattern) }
    assert_nil exempted, "#{CONFIG}: allowlist path #{exempted.inspect} — #{EXEMPTED}"
  end

  def test_allowlist_does_not_hide_reported_values
    hidden = allowlist_values("regexes").find { |pattern| hides_reported_secret?(pattern) }
    assert_nil hidden, "#{CONFIG}: allowlist regex #{hidden.inspect} — #{HIDDEN}"
  end

  def test_allowlist_does_not_silence_rule_classes
    silenced = allowlist_values("stopwords").find { |word| silences_reported_secret?(word) }
    assert_nil silenced, "#{CONFIG}: allowlist stopword #{silenced.inspect} — #{SILENCED}"
  end

  def fields(path, key)
    @assignments.select { |assignment| assignment.path.casecmp?(path) && assignment.key.casecmp?(key) }
  end

  def watched_values
    allowlists = GitleaksToml.allowlists(@assignments)
    allowlists.select { |assignment| GitleaksToml::ALLOWLIST_KEYS.any? { |key| assignment.key.casecmp?(key) } }
  end

  def allowlist_values(key)
    watched_values.select { |assignment| assignment.key.casecmp?(key) }
                  .flat_map { |assignment| GitleaksToml.strings(assignment).to_a }
  end

  def exempts_scanned_paths?(pattern)
    regexp = Regexp.new(pattern)
    SCANNED.any? { |path| regexp.match?(path) }
  end

  def hides_reported_secret?(pattern)
    regexp = Regexp.new(pattern)
    REPORTABLE.any? { |secret| regexp.match?(secret) }
  end

  def silences_reported_secret?(stopword)
    REPORTABLE.any? { |secret| secret.downcase.include?(stopword.downcase) }
  end

  def pre_commit_rev
    repos = Psych.safe_load(File.read(PRE_COMMIT), aliases: true).fetch("repos")
    entry = repos.find { |repo| repo["repo"] == GITLEAKS_REPO }
    entry && entry["rev"]
  end

  def ci_action_version
    steps = Psych.safe_load(File.read(WORKFLOW), aliases: true).dig("jobs", "gitleaks", "steps").to_a
    step = steps.find { |candidate| candidate["uses"].to_s.start_with?(GITLEAKS_ACTION) }
    step && step["env"].to_h["GITLEAKS_VERSION"]
  end
end
