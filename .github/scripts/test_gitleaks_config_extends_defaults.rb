# frozen_string_literal: true

# A gitleaks config file REPLACES the built-in rule set unless it extends it.
# `.gitleaks.toml` sits at the repo root, so every consumer auto-discovers it:
# the digest-pinned scanner in .github/actions/secret-scan (job `security-diff`)
# and the gitleaks pre-commit hook. Drop `[extend] useDefault = true` and both
# keep exiting 0 on real secrets — a silent, total loss of secret scanning that
# no other check would notice. The `contracts` job has no gitleaks binary, so
# this guard is static: it reads the config's TOML tables directly.

ROOT = File.expand_path("../..", __dir__)
CONFIG = ENV.fetch("GITLEAKS_CONFIG", File.join(ROOT, ".gitleaks.toml"))
CONSEQUENCE = 'gitleaks runs with zero rules and reports "no leaks found" for every secret'

def reject(condition, message)
  abort "gitleaks config contract: #{message}" if condition
end

# Group the config's lines under their TOML table header. Matching on the table
# a key belongs to — rather than on the file text — is what stops a commented-out
# or misplaced `useDefault = true` elsewhere in the file from satisfying the check.
def tables(path)
  current = nil
  File.readlines(path, chomp: true).each_with_object({}) do |raw, grouped|
    line = raw.strip
    next if line.empty? || line.start_with?("#")

    header = line[/\A\[\[?\s*([^\[\]]+?)\s*\]\]?\z/, 1]
    current = header || current
    grouped[current] ||= []
    grouped[current] << line unless header
  end
end

reject(!File.file?(CONFIG), "#{CONFIG} is missing — #{CONSEQUENCE}")

config = tables(CONFIG)
reject(!config.key?("extend"), "no [extend] table in #{File.basename(CONFIG)} — #{CONSEQUENCE}")

assignment = config.fetch("extend").find { |line| line.match?(/\AuseDefault\s*=/) }
reject(assignment.nil?, "[extend] never sets useDefault — #{CONSEQUENCE}")
reject(!assignment.match?(/\AuseDefault\s*=\s*true\s*(#.*)?\z/),
       "[extend] must set useDefault = true, found `#{assignment}` — #{CONSEQUENCE}")

puts "Gitleaks config contract: [extend] useDefault = true keeps the built-in rule set loaded"
