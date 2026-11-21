# SUT: `.nvmrc` as the repository's one Node version source (#716).
#
# The toolchain ran Node 24 while `@types/node` was on the 26 line, so the compiler
# checked code against runtime APIs the toolchain may not have. The owner chose Node 26
# (2026-10-02) and asked that the version live in one place `.nvmrc`. This contract is
# the reader that makes a reintroduced literal, a job that runs Node before setting it up
# from `.nvmrc`, a drifting `engines.node` floor, or an `@types/node` major that no longer
# matches the runtime a failure that names the file, instead of a green run on the wrong
# interpreter.
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
  LOCAL_ACTION = %r{\A(?:\$|\.)/(\.github/actions/[^@\s]+)\z}.freeze
  RUNS_NODE = /(?:^|[\s;&|(])(?:node|npm|npx|pnpm|corepack)(?=\s|$)/.freeze
  VERSION_FILE_KEY = "node-version-file"
  LITERAL_KEY = "node-version"
  DOCKERFILE_GLOB = "{apps,packages,workers}/*/Dockerfile"
  NODE_IMAGE = /^FROM\s+(?:--\S+\s+)*node:(\d+)/.freeze
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

  def paths(glob)
    Dir.glob(glob, base: ROOT).sort
  end

  # Every step of a workflow's jobs, or of a composite action's `runs`.
  def steps(relative)
    parsed = document(relative)
    return parsed.dig("runs", "steps").to_a if parsed.key?("runs")

    parsed.fetch("jobs").values.flat_map { |job| job.fetch("steps", []) }
  end

  def setup_node_steps
    (paths(WORKFLOW_GLOB) + paths(ACTION_GLOB)).flat_map do |relative|
      steps(relative).select { |step| step["uses"].to_s.match?(SETUP_NODE) }
                     .map { |step| [relative, step] }
    end
  end

  # The files holding an actions/setup-node step that `offends`.
  def setup_node_files_where(&offends)
    setup_node_steps.select { |_relative, step| offends.call(step) }.map(&:first).uniq
  end

  def reads_the_nvmrc?(step)
    step["uses"].to_s.match?(SETUP_NODE) && step.fetch("with", {})[VERSION_FILE_KEY] == NVMRC
  end

  # A job's steps in the order they run, each local composite action's own steps in its place.
  def run_order(job_steps)
    job_steps.flat_map do |step|
      local = step["uses"].to_s[LOCAL_ACTION, 1]
      local ? run_order(steps(File.join(local, "action.yml"))) : [step]
    end
  end

  # Each `<workflow>#<job>` that runs node, npm, npx, pnpm or corepack before any setup-node step
  # reading the .nvmrc, and so on whatever Node the runner image ships.
  def jobs_on_the_runner_node
    paths(WORKFLOW_GLOB).flat_map do |relative|
      document(relative).fetch("jobs").filter_map do |id, job|
        order = run_order(job.fetch("steps", []))
        first = order.index { |step| step["run"].to_s.match?(RUNS_NODE) }
        "#{relative}##{id}" if first && order.first(first).none? { |step| reads_the_nvmrc?(step) }
      end
    end
  end

  # Every `FROM node:<major>` stage of a service image, as [file, major].
  def node_image_stages
    paths(DOCKERFILE_GLOB).flat_map do |relative|
      read(relative).scan(NODE_IMAGE).map { |(major)| [relative, major] }
    end
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
    offenders = setup_node_files_where { |step| step.fetch("with", {}).key?(LITERAL_KEY) }
    assert_empty offenders,
                 "an actions/setup-node step pins a `#{LITERAL_KEY}` literal instead of reading #{NVMRC} " \
                 "(#{offenders.join(', ')}); the version belongs in #{NVMRC}, so the next move is one line"
  end

  def test_every_setup_node_step_reads_the_nvmrc
    offenders = setup_node_files_where { |step| !reads_the_nvmrc?(step) }
    assert_empty offenders,
                 "every actions/setup-node step must set `#{VERSION_FILE_KEY}: #{NVMRC}` " \
                 "(#{offenders.join(', ')}); a step without it runs whatever the runner image ships"
  end

  def test_every_job_that_runs_node_sets_it_up_from_the_nvmrc
    offenders = jobs_on_the_runner_node
    assert_empty offenders,
                 "a job runs node, npm, npx, pnpm or corepack before an actions/setup-node step that reads #{NVMRC} " \
                 "(#{offenders.join(', ')}); it would run on whatever Node the runner image ships"
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

  def test_every_node_image_matches_the_nvmrc_major
    stages = node_image_stages
    refute_empty stages, "no `FROM node:` stage was found; this contract would pass with its subject deleted"
    offenders = stages.reject { |_relative, major| major == runtime_major }
                      .map { |relative, major| "#{relative}: node:#{major}" }
    assert_empty offenders,
                 "a service image builds or runs on a Node major other than #{NVMRC}'s #{runtime_major} " \
                 "(#{offenders.join(', ')}); CI type-checks it against #{NVMRC}, so it would ship on a runtime " \
                 "its types do not describe"
  end
end
