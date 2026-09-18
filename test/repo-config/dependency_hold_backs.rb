# frozen_string_literal: true
# SUT: the hold-back register — every pin that cannot take the release pnpm's own
# policy allows, with the gate its bump fails recorded beside the pin (#1736).
#
# `pnpm outdated -r --format json` is the registry view: the newest release whose age
# clears `minimumReleaseAge`, and the version the lockfile holds. It is not the
# register, because a specifier that already admits that release is a stale lockfile
# line rather than a decision — a plain `pnpm update` takes it and no comment belongs
# beside it. The register's set is therefore the rows whose DECLARED specifier does not
# admit the age-eligible latest. `refresh-hold-backs.rb` derives that set from the
# registry; the committed snapshot `fixtures/dependency-hold-backs.json` is what the
# contract reads, so no test needs the network.
#
# The human half is one line per entry, in one shape, beside the pin:
#
#   # hold-back: <package>@<declared> -> <latest> fails <gate> — #<issue>
#
# A `package.json` cannot carry a comment, so an entry whose specifier lives in a
# manifest registers in the `# Manifest pins:` block of `pnpm-workspace.yaml`, the
# workspace manifest that owns every package in it; a catalog entry registers
# immediately above its catalog line. `<issue>` is the follow-up card that retires the pin,
# never the card that recorded the register, and the committed snapshot records that number
# per entry, so a line citing any other issue fails the contract.
require "json"
require "psych"

module HoldBacks
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKSPACE_MANIFEST = "pnpm-workspace.yaml"
  FIXTURE = "test/repo-config/fixtures/dependency-hold-backs.json"
  DEPENDENCY_FIELDS = %w[dependencies devDependencies optionalDependencies peerDependencies].freeze
  MANIFEST_GLOBS = ["package.json", "apps/*/package.json", "workers/*/package.json",
                    "packages/*/package.json", "e2e/package.json"].freeze
  # The register line, in its one shape. The gate is free text up to the issue ref.
  REGISTER_LINE = /\A# hold-back: (?<package>\S+)@(?<declared>\S+) -> (?<latest>\S+) fails (?<gate>.+?) — #(?<issue>\d+)\z/
  # The comment block manifest-declared entries register in, and the sentinel that opens it.
  MANIFEST_PINS_MARKER = "# Manifest pins:"
  MINIMUM_RELEASE_AGE_KEY = "minimumReleaseAge"

  # A release a registry hands over. Range bounds may be partial (`<5`), so only a
  # DECLARED specifier is required to be a full triple — a partial one is reported, not guessed.
  VERSION = /\A(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?:-(?<pre>.+))?\z/
  FULL_VERSION = /\A\d+\.\d+\.\d+(?:-.+)?\z/
  CARET = /\A\^(?<rest>\S+)\z/
  TILDE = /\A~(?<rest>\S+)\z/
  FLOOR = /\A>=(?<floor>\S+)(?:\s+<(?<ceiling>\S+))?\z/
  DECLARED_PROTOCOL = /\A[a-z]+:\z/

  Version = Struct.new(:major, :minor, :patch, :pre) do
    include Comparable

    # A release outranks its own prereleases; the prerelease part carries that ordering. The
    # range readers below start with `version < base`, so this ordering decides ranges, not
    # just the "latest" a registry hands over.
    def <=>(other)
      core = [major, minor, patch] <=> [other.major, other.minor, other.patch]
      return core unless core.zero?

      Prerelease.of(pre) <=> Prerelease.of(other.pre)
    end

    def to_s
      "#{major}.#{minor}.#{patch}#{pre.nil? ? '' : "-#{pre}"}"
    end
  end

  # The prerelease part of a version, ordered per SemVer §11: split into identifiers, numeric
  # ones compared as numbers and ranked below alphanumeric ones. A version with no prerelease
  # is modelled as no identifiers, which outranks every prerelease of the same core and equals
  # another such release — the answer `Comparable` reads for `==`.
  class Prerelease
    include Comparable

    def self.of(text)
      new(text.nil? ? [] : text.split("."))
    end

    def initialize(identifiers)
      @identifiers = identifiers
    end

    def <=>(other)
      return 0 if plain? && other.plain?
      return plain? ? 1 : -1 if plain? || other.plain?

      compare_identifiers(other)
    end

    def plain?
      @identifiers.empty?
    end

    protected

    attr_reader :identifiers

    def compare_identifiers(other)
      identifiers.zip(other.identifiers).each do |one, them|
        next if them.nil?

        found = compare_identifier(one, them)
        return found unless found.zero?
      end
      identifiers.length <=> other.identifiers.length
    end

    # Numeric identifiers compare numerically, a numeric identifier ranks below an
    # alphanumeric one, and alphanumeric identifiers compare in ASCII order.
    def compare_identifier(one, other)
      return one.to_i <=> other.to_i if numeric_identifier?(one) && numeric_identifier?(other)
      return -1 if numeric_identifier?(one)
      return 1 if numeric_identifier?(other)

      one <=> other
    end

    def numeric_identifier?(identifier)
      /\A\d+\z/.match?(identifier)
    end
  end

  def self.parse(text)
    match = VERSION.match(text)
    raise "#{text.inspect} is not a version this register can compare" if match.nil?

    Version.new(match[:major].to_i, match[:minor].to_i, match[:patch].to_i, match[:pre])
  end

  def self.parse_declared(text, name)
    raise "#{name}: #{text.inspect} is not a version this register can compare" unless FULL_VERSION.match?(text)

    parse(text)
  end

  def self.plain?(version)
    version.pre.nil?
  end

  # Whether a declared specifier admits a release. Every form is answered or raised, so a
  # specifier this reader does not know cannot be mistaken for "blocked".
  def self.admits?(specifier, text, name: "")
    version = parse(text)
    case specifier
    when CARET then admits_caret?(parse(Regexp.last_match[:rest]), version)
    when TILDE then admits_tilde?(parse(Regexp.last_match[:rest]), version)
    when FLOOR then admits_floor?(Regexp.last_match, version)
    else admits_exact?(specifier, version, name)
    end
  end

  # npm's rule: a prerelease is admitted only by a range that names a prerelease of the
  # same [major, minor, patch], never by a plain caret.
  def self.admits_caret?(base, version)
    return false if version < base
    return false if stray_prerelease?(base, version)
    return version.patch == base.patch if base.major.zero? && base.minor.zero?
    return version.minor == base.minor if base.major.zero?

    version.major == base.major
  end

  def self.admits_tilde?(base, version)
    return false if version < base
    return false if stray_prerelease?(base, version)

    version.major == base.major && version.minor == base.minor
  end

  def self.stray_prerelease?(base, version)
    return false if version.pre.nil?
    return true if base.pre.nil?

    [version.major, version.minor, version.patch] != [base.major, base.minor, base.patch]
  end

  def self.admits_floor?(match, version)
    return false if version < parse(match[:floor])
    return true if match[:ceiling].nil?

    version < parse(match[:ceiling])
  end

  def self.admits_exact?(specifier, version, name)
    raise "#{name}: #{specifier.inspect} is not a version this register can compare" if specifier.match?(DECLARED_PROTOCOL)

    parse_declared(specifier, name) == version
  end

  # Every declaration in the workspace that can hold a version: the catalog, and each
  # manifest's own dependency blocks. `catalog:` is a pointer, not a version.
  class Declarations
    attr_reader :workspace

    def initialize(root = ROOT)
      @root = root
      @workspace = Psych.safe_load(File.read(File.join(root, WORKSPACE_MANIFEST))) || {}
      @manifests = Dir.glob(MANIFEST_GLOBS, base: root).sort.to_h do |relative|
        [relative, JSON.parse(File.read(File.join(root, relative)))]
      end
    end

    def catalog
      @workspace.fetch("catalog", {})
    end

    def overrides
      @workspace.fetch("overrides", {})
    end

    def minimum_release_age_minutes
      @workspace[MINIMUM_RELEASE_AGE_KEY]
    end

    def register_source
      File.read(File.join(@root, WORKSPACE_MANIFEST))
    end

    # Where a dependency's version is declared: the catalog when it is catalogued, else the
    # one manifest that names a version itself.
    def specifier_for(package)
      return [catalog[package], WORKSPACE_MANIFEST] if catalog.key?(package)

      found = manifest_declarations.find { |(_, _, name)| name == package }
      found.nil? ? nil : found.first(2)
    end

    # The versions the manifests name themselves, as [specifier, manifest, package]. A
    # `catalog:` specifier is a pointer rather than a version, so it is not one of these.
    def manifest_declarations
      @manifest_declarations ||= @manifests.flat_map do |relative, manifest|
        DEPENDENCY_FIELDS.flat_map { |field| manifest.fetch(field, {}).to_a }
                         .reject { |(_, specifier)| specifier.match?(DECLARED_PROTOCOL) }
                         .map { |(package, specifier)| [specifier, relative, package] }
      end
    end
  end

  # The drift between the committed register and a derivation of the tree, as instructions
  # for the hand that refreshes it. `before` is the register (the committed snapshot) and
  # `after` is the tree (what the derivation found), so a package only the register has is a
  # line to delete and one only the tree has is a line to write. A shared entry is compared on
  # the derived keys alone: `issue` is a follow-up card the registry cannot know, so it is the
  # register line's business, not drift. Round 1, must-fix 1: the two labels were swapped,
  # which told the reader the opposite of the fix.
  def self.drift_between(before, after)
    registered = before.to_h { |entry| [entry.fetch("package"), entry] }
    derived = after.to_h { |entry| [entry.fetch("package"), entry] }
    (derived.keys - registered.keys).map { |package| "add #{package}" } +
      (registered.keys - derived.keys).map { |package| "drop #{package}" } +
      moved_between(registered, derived)
  end

  def self.moved_between(registered, derived)
    (registered.keys & derived.keys).reject { |package| registered[package].slice(*derived[package].keys) == derived[package] }
                                   .map { |package| "move #{package}: #{registered[package].inspect} -> #{derived[package].inspect}" }
  end

  # `--write` rewrites the machine half from the registry, which cannot know which follow-up
  # card a human opened: an entry the snapshot already carries keeps the issue it recorded,
  # and a new entry is written without one — the contract reports it until a card exists.
  def self.with_carried_issues(derived, registered)
    known = registered.to_h { |entry| [entry.fetch("package"), entry["issue"]] }
    derived.map { |entry| entry.merge("issue" => known[entry.fetch("package")]).compact }
  end

  # The committed snapshot: what the derivation produced, plus the follow-up issue a `--write`
  # carried over, in the shape the contract reads.
  class Snapshot
    def initialize(path = File.join(ROOT, FIXTURE))
      @raw = JSON.parse(File.read(path))
    end

    def refreshed
      @raw.fetch("refreshed")
    end

    def command
      @raw.fetch("command")
    end

    def entries
      @raw.fetch("holdbacks")
    end

    def packages
      entries.map { |entry| entry.fetch("package") }
    end
  end
end
