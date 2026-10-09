# SUT: `.nvmrc` as the repository's one Node version source (#716).
#
# The toolchain ran Node 24 while `@types/node` was on the 26 line, so the compiler
# checked code against runtime APIs the toolchain may not have. The owner chose Node 26
# (2026-10-02) and asked that the version live in one place `.nvmrc`. This contract is
# the reader that makes a reintroduced literal, a drifting `engines.node` floor, or an
# `@types/node` major that no longer matches the runtime a failure that names the file,
# instead of a green run on the wrong interpreter.
require "minitest/autorun"
require "json"
require "psych"

class NodeVersionSourceTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  NVMRC = ".nvmrc"
  ROOT_MANIFEST = "package.json"
  WORKSPACE_MANIFEST = "pnpm-workspace.yaml"
  WORKFLOW_GLOB = ".github/workflows/*.yml"
  ACTION_GLOB = ".github/actions/**/action.yml"
  SETUP_NODE = %r{\Aactions/setup-node@}.freeze
  VERSION_FILE_KEY = "node-version-file"
  LITERAL_KEY = "node-version"
  CATALOG_FIELDS = %w[dependencies devDependencies optionalDependencies peerDependencies].freeze
  DIGITS = /\d+/.freeze

  def read(relative)
    File.read(File.join(ROOT, relative))
  end

  def node_version
    @node_version ||= read(NVMRC).strip
  end

  def runtime_major
    major = node_version[DIGITS]
    raise "#{NVMRC} names no version: #{node_version.inspect}" if major.nil?

    major
  end

  def major_of(specifier)
    specifier.to_s[DIGITS]
  end

  def document(relative)
    Psych.safe_load(read(relative), aliases: true) || {}
  end

  def workflow_paths
    Dir.glob(WORKFLOW_GLOB, base: ROOT).sort
  end

  def action_paths
    Dir.glob(ACTION_GLOB, base: ROOT).sort
  end

  # Every step of a workflow's jobs, or of a composite action's `runs`.
  def steps(relative)
    parsed = document(relative)
    return parsed.dig("runs", "steps").to_a if parsed.key?("runs")

    parsed.fetch("jobs").values.flat_map { |job| job.fetch("steps", []) }
  end

  def setup_node_steps
    (workflow_paths + action_paths).flat_map do |relative|
      steps(relative).select { |step| step["uses"].to_s.match?(SETUP_NODE) }
                     .map { |step| [relative, step] }
    end
  end

  def node_version_literals
    setup_node_steps.select { |_relative, step| step.fetch("with", {}).key?(LITERAL_KEY) }
                    .map { |relative, _step| relative }.uniq
  end

  def steps_without_the_nvmrc
    setup_node_steps.reject { |_relative, step| step.fetch("with", {})[VERSION_FILE_KEY] == NVMRC }
                    .map { |relative, _step| relative }.uniq
  end

  def manifest_paths
    nested = ["infra/database-access/package.json"].select { |path| File.file?(File.join(ROOT, path)) }
    (["package.json"] + workspace_members.map { |path| path.delete_prefix("#{ROOT}/") } + nested).sort
  end

  # The workspace's own members, from the globs its manifest declares; a generated SDK
  # under a member (`sdks/` is gitignored) is not one and must not be scanned.
  def workspace_members
    document(WORKSPACE_MANIFEST).fetch("packages").flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
  end

  def catalog
    @catalog ||= document(WORKSPACE_MANIFEST)["catalog"] || {}
  end

  def resolve(specifier)
    return specifier unless specifier.start_with?("catalog:")

    catalog["@types/node"]
  end

  def types_node_declarations
    manifest_paths.flat_map do |relative|
      manifest = JSON.parse(read(relative))
      CATALOG_FIELDS.flat_map { |field| manifest.fetch(field, {}).to_a }
                    .select { |name, _specifier| name == "@types/node" }
                    .map { |_name, specifier| [relative, resolve(specifier)] }
    end
  end

  def root_manifest
    JSON.parse(read(ROOT_MANIFEST))
  end

  def test_the_scan_finds_the_repository_setup_node_steps
    refute_empty setup_node_steps,
                 "no actions/setup-node step was found; this contract would pass with its subject deleted"
  end

  def test_no_setup_node_step_pins_a_literal_version
    offenders = node_version_literals
    assert_empty offenders,
                 "an actions/setup-node step pins a `#{LITERAL_KEY}` literal instead of reading #{NVMRC} " \
                 "(#{offenders.join(', ')}); the version belongs in #{NVMRC}, so the next move is one line"
  end

  def test_every_setup_node_step_reads_the_nvmrc
    offenders = steps_without_the_nvmrc
    assert_empty offenders,
                 "every actions/setup-node step must set `#{VERSION_FILE_KEY}: #{NVMRC}` " \
                 "(#{offenders.join(', ')}); a step without it runs whatever the runner image ships"
  end

  def test_the_engines_floor_matches_the_nvmrc_major
    engines = root_manifest.fetch("engines").fetch("node")
    floor = engines[/\A>=\s*(\d+)/, 1]
    assert_equal runtime_major, floor,
                 "#{ROOT_MANIFEST} engines.node is #{engines.inspect} but #{NVMRC} is #{node_version.inspect}; " \
                 "the floor must be `>=#{runtime_major}` so an install cannot pick a runtime the types do not describe"
  end

  def test_every_types_node_declaration_matches_the_nvmrc_major
    declarations = types_node_declarations
    refute_empty declarations,
                 "no @types/node declaration was found; this contract would pass with its subject deleted"
    offenders = declarations.reject { |_relative, resolved| major_of(resolved) == runtime_major }
                            .map { |relative, resolved| "#{relative}: @types/node = #{resolved.inspect}" }
    assert_empty offenders,
                 "@types/node describes the runtime's API surface, so its major must equal #{NVMRC}'s " \
                 "#{runtime_major} (#{offenders.join(', ')}); a 26-line type set checked against a 24 runtime " \
                 "is a silent false positive"
  end
end
