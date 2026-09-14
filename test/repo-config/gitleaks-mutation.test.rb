# SUT: .gitleaks.toml and its default-rule inheritance.
# Every probe copies the contract's config into a throwaway directory and
# mutates the copy; the committed .gitleaks.toml is never written to.
require "minitest/autorun"
require "open3"
require "tmpdir"

class GitleaksMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = File.join(ROOT, "test/repo-config/gitleaks.test.rb")
  CONFIG = File.join(ROOT, ".gitleaks.toml")

  EXTEND_BLOCK = /^\[extend\]\n\s*useDefault\s*=\s*true\n/
  USE_DEFAULT = /useDefault\s*=\s*true/
  ALLOWLIST_PATHS = /paths\s*=\s*\[.*\]/
  ALLOWLIST = "[allowlist]"
  ZERO_RULES = "zero rules"
  REDEFINED = "redefining that inherited rule can stop it"
  UNREADABLE = "this guard cannot read that configuration"
  NONCANONICAL = "gitleaks weak typing reads that spelling as a one-element list"
  SILENCED = "silencing that rule class"
  HIDDEN = "dropped before they are reported"

  # gitleaks honors every one of these spellings of the canonical
  # `[[rules]] id = "github-pat"`; the reader has to resolve them to one ID.
  RULE_ID_ENCODINGS = [
    %([[rules]]\nid = "github-pat"),
    %([[rules]]\nid = """github-pat"""),
    %([[rules]]\nid = '''github-pat'''),
    %([[rules]]\n"id" = "github-pat"),
    %([[rules]]\nid = "github\\u002dpat"),
    %([[rules]]\nID = "github-pat"),
    %([[Rules]]\nid = "github-pat"),
    %([rules]\nid = "github-pat"),
    %([['rules']]\nid = "github-pat"),
    %([["rules"]]\nid = "github-pat"),
    %([["\\u0072ules"]]\nid = "github-pat")
  ].freeze

  def reject_config(path, label, consequence)
    out, err, status = Open3.capture3({ "GITLEAKS_CONFIG" => path }, RbConfig.ruby, CONTRACT)
    refute status.success?, "mutation survived: #{label}"
    assert_includes out + err, consequence, "mutation must name its consequence: #{label}"
  end

  def accept_config(path, label)
    out, err, status = Open3.capture3({ "GITLEAKS_CONFIG" => path }, RbConfig.ruby, CONTRACT)
    assert status.success?, "valid config rejected: #{label}\n#{out}#{err}"
  end

  def with_temp_config(source, prefix)
    Dir.mktmpdir(prefix) do |dir|
      path = File.join(dir, ".gitleaks.toml")
      File.write(path, source)
      yield path
    end
  end

  def probe(source, label, consequence = ZERO_RULES)
    with_temp_config(source, "gitleaks-config-mutation-") do |path|
      reject_config(path, label, consequence)
    end
  end

  def accept_probe(source, label)
    with_temp_config(source, "gitleaks-config-custom-") do |path|
      accept_config(path, label)
    end
  end

  def probe_rule(block, label)
    probe("#{File.read(CONFIG)}\n#{block}\n", label, REDEFINED)
  end

  def probe_allowlist(assignment, label, consequence)
    probe("#{File.read(CONFIG)}\n#{assignment}\n", label, consequence)
  end

  def probe_absent(label, consequence)
    Dir.mktmpdir("gitleaks-config-mutation-") do |dir|
      reject_config(File.join(dir, ".gitleaks.toml"), label, consequence)
    end
  end

  def mutate(needle, replacement, label, consequence = ZERO_RULES)
    source = File.read(CONFIG)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    probe(changed, label, consequence)
  end

  def test_accepts_the_committed_configuration
    accept_config(CONFIG, "committed configuration")
  end

  def test_rejects_default_rules_relocated_into_the_allowlist
    source = File.read(CONFIG)
    changed = source.sub(EXTEND_BLOCK, "") + "\n  useDefault = true\n"
    refute_equal source, changed, "relocation mutation must change the config"
    probe(changed, "useDefault relocated into [allowlist]")
  end

  def test_rejects_deleted_configuration
    probe_absent("config file deleted", "falls back to its default rules")
  end

  def test_rejects_deleted_extend_table
    mutate(EXTEND_BLOCK, "", "[extend] table deleted")
  end

  def test_rejects_disabled_default_rules
    mutate(USE_DEFAULT, "useDefault = false", "useDefault flipped to false")
  end

  def test_rejects_renamed_extend_table
    mutate("[extend]", "[extended]", "[extend] table renamed")
  end

  def test_rejects_commented_default_rules
    mutate(USE_DEFAULT, "# useDefault = true", "useDefault commented out")
  end

  def test_rejects_disabled_inherited_rules
    mutate(USE_DEFAULT, "useDefault = true\n  disabledRules = [\"github-pat\"]",
           "inherited rules dropped by name", "the named rules stop running")
  end

  def test_rejects_weakly_typed_default_inheritance
    ['useDefault = "true"', "useDefault = 1"].each do |field|
      mutate(USE_DEFAULT, field, "weakly typed useDefault: #{field}")
    end
  end

  def test_rejects_every_encoding_of_a_default_rule_id
    RULE_ID_ENCODINGS.each do |block|
      probe_rule(block, "equivalent default rule id encoding: #{block.lines.last.strip}")
    end
  end

  def test_rejects_a_rules_table_the_reader_cannot_vouch_for
    probe(%(#{File.read(CONFIG)}\nrules = [{ id = "github-pat", regex = '''$^''' }]\n),
          "inline-table rules the guard cannot compare", UNREADABLE)
  end

  def test_rejects_escaped_allowlist_values
    [[%(stopwords = ["AIza\\u0053y"]), SILENCED], [%(regexes = ["\\u002e*"]), HIDDEN]].each do |assignment, consequence|
      probe_allowlist(assignment, "escaped allowlist value: #{assignment}", consequence)
    end
  end

  def test_rejects_scalar_allowlist_values
    [%(stopwords = "AIzaSy"), %(paths = ".*"), %(regexes = "AIzaSy")].each do |assignment|
      probe_allowlist(assignment, "scalar allowlist value: #{assignment}", NONCANONICAL)
    end
  end

  def test_allows_a_noncolliding_custom_rule
    source = "#{File.read(CONFIG)}\n[[rules]]\nid = \"animichi-custom-secret\"\nregex = '''ANIMICHI_[A-Z0-9]{16}'''\n"
    accept_probe(source, "animichi custom rule")
  end

  def test_allows_an_equivalent_encoding_of_a_noncolliding_custom_rule
    source = "#{File.read(CONFIG)}\n[[\"rules\"]]\nid = \"animichi-custom-secret\"\nregex = '''ANIMICHI_[A-Z0-9]{16}'''\n"
    accept_probe(source, "animichi custom rule under a quoted header")
  end

  def test_rejects_allowlist_for_every_path
    mutate(ALLOWLIST_PATHS, "paths = ['''.*''']",
           "allowlist path widened to every file", "exempt from every rule")
  end

  def test_rejects_allowlist_for_every_value
    mutate(ALLOWLIST, "#{ALLOWLIST}\n  regexes = ['''.*''']",
           "allowlist regex hid every secret value", HIDDEN)
  end

  def test_rejects_stopwords_that_silence_a_rule_class
    mutate(ALLOWLIST, "#{ALLOWLIST}\n  stopwords = [\"GHP_\"]",
           "allowlist stopword silenced a whole rule class", SILENCED)
  end

  def test_rejects_stopwords_that_silence_google_api_keys
    mutate(ALLOWLIST, "#{ALLOWLIST}\n  stopwords = [\"AIzaSy\"]",
           "allowlist stopword silenced Google API keys", SILENCED)
  end
end
