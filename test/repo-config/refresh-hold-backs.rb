#!/usr/bin/env ruby
# The documented refresh for the hold-back register (#1736):
#
#   ruby test/repo-config/refresh-hold-backs.rb          # report drift, exit 1 when stale
#   ruby test/repo-config/refresh-hold-backs.rb --write  # rewrite the committed snapshot
#
# What it derives. `pnpm outdated -r --format json` lists every declared dependency whose
# lockfile version is behind the newest release that clears the workspace's own
# `minimumReleaseAge`; it is the registry view, and its rows are of two kinds. A specifier
# that already admits that release is only a stale lockfile line — `pnpm update` takes it,
# and no register line belongs beside it. A specifier that does NOT admit it is a pin: some
# gate stopped the bump, and the register owes that pin a `# hold-back:` line recording the
# gate. This command derives the second set and compares it with the committed snapshot
# `fixtures/dependency-hold-backs.json`.
#
# What it does not do. It cannot know WHY a bump failed — only a hand that ran the bump
# does — so it never invents a gate, and it only writes the machine half of the register
# (package, declared specifier, latest, where the specifier is declared, plus the follow-up
# issue it carries over from the entry it replaces). A run that reports drift leaves the
# contract red until the lines beside the pins are written or removed.
require_relative "dependency_hold_backs"
require "date"

module HoldBacks
  # The registry view, derived: every below-latest declaration whose specifier blocks the release.
  class Derivation
    Entry = Struct.new(:package, :declared, :latest, :declaredIn) do
      def to_h
        { "package" => package, "declared" => declared, "latest" => latest, "declaredIn" => declaredIn }
      end
    end

    def initialize(declarations, outdated_json)
      @declarations = declarations
      @outdated = JSON.parse(outdated_json)
    end

    def entries
      # Ruby 2.6 (the macOS system ruby the pre-push gate runs) has no `filter_map`.
      @outdated.keys.sort.map { |package| entry_for(package) }.compact
    end

    def entry_for(package)
      found = @declarations.specifier_for(package)
      return nil if found.nil?

      specifier, declared_in = found
      latest = @outdated.fetch(package).fetch("latest")
      return nil if HoldBacks.admits?(specifier, latest, name: package)

      Entry.new(package, specifier, latest, declared_in)
    end
  end

  # The committed snapshot and the derivation side by side.
  class Refresh
    # What `--write` records in the fixture's `note`, so a rewritten snapshot says what it holds.
    NOTE = "Derived by `ruby test/repo-config/refresh-hold-backs.rb --write`; read by " \
           "dependency-hold-backs.test.rb. `issue` is the follow-up card the register line beside the pin cites; " \
           "`--write` carries it over from the entry it replaces."

    def initialize(root = ROOT)
      @root = root
      @declarations = Declarations.new(root)
      @snapshot = Snapshot.new(File.join(root, FIXTURE))
    end

    def command
      "pnpm outdated -r --format json"
    end

    def outdated_json
      output = IO.popen(["pnpm", "outdated", "-r", "--format", "json"], chdir: @root, &:read)
      # `pnpm outdated` exits 1 whenever it has rows; unparseable output is the real failure.
      raise "pnpm outdated produced no JSON:\n#{output}" unless output.strip.start_with?("{")

      output
    end

    def derived
      Derivation.new(@declarations, outdated_json).entries
    end

    def drift
      HoldBacks.drift_between(@snapshot.entries, derived.map(&:to_h))
    end

    def write
      body = { "refreshed" => Date.today.to_s, "command" => command, "note" => NOTE,
               "holdbacks" => HoldBacks.with_carried_issues(derived.map(&:to_h), @snapshot.entries) }
      File.write(File.join(@root, FIXTURE), "#{JSON.pretty_generate(body)}\n")
    end
  end
end

if $PROGRAM_NAME == __FILE__
  refresh = HoldBacks::Refresh.new
  if ARGV.include?("--write")
    refresh.write
    puts "refreshed #{HoldBacks::FIXTURE} from #{refresh.command} (#{refresh.derived.length} hold-backs)"
  else
    drift = refresh.drift
    puts drift.empty? ? "the register matches #{refresh.command}" : drift.map { |line| "  #{line}" }.join("\n")
    exit(drift.empty? ? 0 : 1)
  end
end
