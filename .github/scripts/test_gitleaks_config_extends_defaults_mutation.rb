# frozen_string_literal: true

# Proves the static guard actually fails when the [extend] table is weakened,
# so a future edit to .gitleaks.toml cannot silently disable secret scanning.

require "open3"
require "tmpdir"

ROOT = File.expand_path("../..", __dir__)
CONTRACT = File.join(ROOT, ".github/scripts/test_gitleaks_config_extends_defaults.rb")
CONFIG = File.join(ROOT, ".gitleaks.toml")

def probe(source, label)
  Dir.mktmpdir("gitleaks-config-mutation-") do |dir|
    copy = File.join(dir, ".gitleaks.toml")
    File.write(copy, source)
    _out, err, status = Open3.capture3({ "GITLEAKS_CONFIG" => copy }, RbConfig.ruby, CONTRACT)
    abort "mutation survived: #{label}" if status.success?
    abort "mutation message must name the consequence: #{label}" unless err.include?("zero rules")
  end
end

def mutate(needle, replacement, label)
  source = File.read(CONFIG)
  changed = source.sub(needle, replacement)
  abort "mutation needle missing: #{label}" if changed == source
  probe(changed, label)
end

_out, _err, baseline = Open3.capture3({ "GITLEAKS_CONFIG" => CONFIG }, RbConfig.ruby, CONTRACT)
abort "baseline must pass on the committed config" unless baseline.success?

mutate(/^\[extend\]\n\s*useDefault = true\n/, "", "[extend] table deleted")
mutate("useDefault = true", "useDefault = false", "useDefault flipped to false")
mutate("[extend]", "[extended]", "[extend] table renamed")
mutate("useDefault = true", "# useDefault = true", "useDefault commented out")
probe(File.read(CONFIG).sub(/^\[extend\]\n\s*useDefault = true\n/, "") +
      "\n  useDefault = true\n", "useDefault relocated into [allowlist]")

puts "Gitleaks config mutation probes: deletion, false, rename, comment-out, and relocation rejected"
