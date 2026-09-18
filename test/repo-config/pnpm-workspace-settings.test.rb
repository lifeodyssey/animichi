# SUT: pnpm-workspace.yaml as the workspace's one settings and version surface.
#
# pnpm 11 moved every non-auth setting out of `.npmrc` and removed the
# `package.json#pnpm` field; pnpm 12 rejects a workspace setting it does not
# recognise. A setting left in either old home is not read, so it still looks
# configured while configuring nothing (#1672, AC3).
#
# The second half is the catalog rule (AC6): a dependency two importers declare
# is declared once, in `pnpm-workspace.yaml`.
require "minitest/autorun"
require "json"
require "psych"

class PnpmWorkspaceSettingsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKSPACE_MANIFEST = "pnpm-workspace.yaml"
  CATALOG_FIELDS = %w[dependencies devDependencies optionalDependencies peerDependencies].freeze
  # A resolved specifier these name is a location inside the workspace, so one
  # catalog entry could not mean the same location for every importer.
  LOCAL_PROTOCOLS = %w[workspace: file: link: portal:].freeze

  # pnpm answers a setting it cannot find with its own default, so a deleted key is
  # not "no opinion" — it is that default, silently. Deleting any of these three was
  # green here and green through `pnpm install --frozen-lockfile`, the only other
  # reader; this pin is the one place the deletion is visible, and it names the key.
  SETTING_VALUES = {
    "nodeLinker" => "hoisted",
    "shamefullyHoist" => true,
    "catalogMode" => "strict"
  }.freeze

  # The settings this card moved out of a `package.json#pnpm`: the root's `overrides`
  # and `patchedDependencies`, and `infra/database-access`'s own `overrides` (not a
  # member of this workspace; the `packages:` globs stop at `infra`). Pinned present
  # only — the contents are the lockfile's business, and a frozen install already
  # refuses a lockfile whose `overrides` the manifest no longer declares.
  MOVED_SETTINGS = {
    WORKSPACE_MANIFEST => %w[overrides patchedDependencies],
    "infra/database-access/pnpm-workspace.yaml" => %w[overrides]
  }.freeze

  # `.npmrc` is auth and registry only: the default registry, a scoped registry,
  # and the credential block keyed by registry host.
  REGISTRY_KEYS = [/\Aregistry\z/, /\A@[^:\s]+:registry\z/].freeze
  AUTH_KEYS = %w[_auth _authToken _password username email always-auth auth-type
                 ca cafile certfile keyfile].freeze
  SCOPED_KEY = %r{\A//[^:\s]+/:(.+)\z}

  def workspace
    @workspace ||= Psych.safe_load(File.read(File.join(ROOT, WORKSPACE_MANIFEST)))
  end

  def read_json(relative)
    JSON.parse(File.read(File.join(ROOT, relative)))
  end

  # Tolerant on purpose: a manifest a pin below reads can be deleted, and that is a
  # finding to report by name, not an Errno::ENOENT. The root has strict readers too.
  def workspace_at(relative)
    path = File.join(ROOT, relative)
    return {} unless File.exist?(path)

    Psych.safe_load(File.read(path)) || {}
  end

  def setting_value_drift
    SETTING_VALUES.map do |key, expected|
      next "#{WORKSPACE_MANIFEST}: #{key} is missing, so pnpm applies its own default" unless workspace.key?(key)
      next nil if workspace[key] == expected

      "#{WORKSPACE_MANIFEST}: #{key} is #{workspace[key].inspect}, must be #{expected.inspect}"
    end.compact
  end

  def moved_setting_drift
    MOVED_SETTINGS.flat_map do |relative, keys|
      declared = workspace_at(relative)
      keys.reject { |key| declared.key?(key) }.map { |key| "#{relative}: #{key} is missing" }
    end
  end

  # Every file pnpm installs from: the root project plus each workspace glob.
  def importer_paths
    members = workspace.fetch("packages").flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
    (["package.json"] + members.map { |path| path.delete_prefix("#{ROOT}/") }).sort
  end

  # Every manifest in the tree, including a nested workspace root such as
  # `infra/database-access` that no root glob matches.
  def manifest_paths
    Dir.glob("**/package.json", base: ROOT).reject { |path| path.split("/").include?("node_modules") }.sort
  end

  def declarations(path)
    read_json(path).slice(*CATALOG_FIELDS).flat_map { |_field, entries| entries.to_a }
  end

  def external?(specifier)
    LOCAL_PROTOCOLS.none? { |protocol| specifier.start_with?(protocol) }
  end

  def external_declarations
    importer_paths.flat_map do |path|
      declarations(path).select { |_, specifier| external?(specifier) }.map { |name, specifier| [name, path, specifier] }
    end
  end

  def declarations_by_name
    external_declarations.group_by { |name, _, _| name }
  end

  def catalog_for(specifier)
    name = specifier.delete_prefix("catalog:")
    return workspace["catalog"] || {} if name.empty?
    (workspace["catalogs"] || {})[name] || {}
  end

  def unreadable_npmrc_keys
    Dir.glob("**/.npmrc", base: ROOT).reject { |path| path.split("/").include?("node_modules") }.sort.flat_map do |path|
      npmrc_keys(path).reject { |key| auth_or_registry?(key) }.map { |key| "#{path}: #{key}" }
    end
  end

  def npmrc_keys(path)
    # Ruby 2.6 (the macOS system ruby the pre-push gate runs) has no `filter_map`.
    File.readlines(File.join(ROOT, path)).map do |line|
      stripped = line.strip
      next if stripped.empty? || stripped.start_with?("#", ";", "[")
      stripped.split("=", 2).first.to_s.strip
    end.compact
  end

  def auth_or_registry?(key)
    scoped = key.match(SCOPED_KEY)
    return AUTH_KEYS.include?(scoped[1]) if scoped
    REGISTRY_KEYS.any? { |pattern| key.match?(pattern) } || AUTH_KEYS.include?(key)
  end

  def test_npmrc_holds_only_auth_and_registry_keys
    assert_empty unreadable_npmrc_keys,
                 "pnpm 11 reads only auth and registry settings from .npmrc (#{unreadable_npmrc_keys.join(', ')}); " \
                 "every other setting belongs in #{WORKSPACE_MANIFEST}, and in .npmrc it is a line that configures nothing"
  end

  def test_no_manifest_carries_a_pnpm_field
    offenders = manifest_paths.select { |path| read_json(path).key?("pnpm") }
    assert_empty offenders,
                 "pnpm 11 removed the `pnpm` field from package.json (#{offenders.join(', ')}); those settings must be " \
                 "top-level keys in #{WORKSPACE_MANIFEST}, or nothing reads them"
  end

  def test_the_settings_the_move_chose_keep_their_values
    drift = setting_value_drift
    assert_empty drift,
                 "these settings must stay declared with the values the pnpm 12 move chose (#{drift.join('; ')}); " \
                 "pnpm answers a key it cannot find with its own default, so a dropped `nodeLinker` re-links every " \
                 "consumer, a dropped `shamefullyHoist` un-hoists the root `node_modules` wrangler resolves " \
                 "through, and a dropped `catalogMode` makes strict catalogs a suggestion again"
  end

  def test_the_settings_the_move_carried_over_keep_their_declaration
    drift = moved_setting_drift
    assert_empty drift,
                 "these settings moved out of a `package.json#pnpm` field this card removed (#{drift.join('; ')}); " \
                 "the file they left is read for nothing, so a manifest is the only place the declaration exists"
  end

  def test_the_workspace_declares_settings_in_camel_case
    offenders = workspace.keys.select { |key| key.include?("-") }
    assert_empty offenders,
                 "pnpm loads only camelCase settings from #{WORKSPACE_MANIFEST} (#{offenders.join(', ')}); a kebab-case " \
                 "key is ignored with a warning and the setting stops applying"
  end

  def test_every_shared_external_dependency_uses_the_catalog
    raw = declarations_by_name.select { |_, uses| uses.length > 1 }
                              .flat_map { |name, uses| uses.reject { |_, _, specifier| specifier.start_with?("catalog:") }
                                                          .map { |_, path, specifier| "#{path}: #{name} = #{specifier}" } }
    assert_empty raw,
                 "a dependency declared by two or more importers is declared once in the catalog (#{raw.join(', ')}); " \
                 "a raw specifier beside a `catalog:` one is the drift the catalog exists to remove"
  end

  def test_every_catalog_reference_resolves
    missing = external_declarations.select { |_, _, specifier| specifier.start_with?("catalog:") }
                                   .reject { |name, _, specifier| catalog_for(specifier).key?(name) }
                                   .map { |name, path, _| "#{path}: #{name}" }
    assert_empty missing,
                 "a `catalog:` reference must name a dependency that catalog defines (#{missing.join(', ')}); " \
                 "pnpm fails the install when it does not"
  end

  def test_the_catalog_names_no_location
    offenders = (workspace["catalog"] || {}).select { |_name, specifier| !external?(specifier) }.keys
    assert_empty offenders,
                 "a catalog entry must be a version or a range, not a location (#{offenders.join(', ')}); one entry " \
                 "cannot resolve to a different directory for each importer"
  end
end
