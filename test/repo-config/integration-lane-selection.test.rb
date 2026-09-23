# SUT: which files every workspace package's `test:integration` lane selects.
#
# Most of those lanes boot the shared Postgres container. A file that needs no database pays the
# boot for nothing and hides inside a name that says it does (#1771), so two properties hold the
# line: no integration lane anywhere selects a `*.unit.test.ts` file, and every file a database
# lane selects reaches for the database.
#
# The second property's domain is the lanes that select by glob from a directory they share with
# files that need no database — the place a mis-scoped glob can quietly swallow one. `workers/edge`
# selects four directories that exist only for one database arm each, so a file there needing no
# database is a misplaced file rather than a mis-scoped glob: a different defect, and not this
# subject. The marker is a direct import or call, so a file reaching the database only through a
# module it imports fails until it says so — the safe direction.
#
# Selection is read from the lane, never listed here: the globs its own command writes (through the
# `pnpm run` sub-lanes it chains), or the `include:` of the vitest config it names.
require "minitest/autorun"
require "json"
require "psych"

class IntegrationLaneSelectionTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  LANE = "test:integration"
  UNIT_SUFFIX = ".unit.test.ts"

  SUB_LANE = /pnpm run ([\w:-]+)/
  VITEST_CONFIG = /--config\s+(\S+)/
  VITEST_INCLUDE = /include:\s*\[([^\]]*)\]/m

  # What a file does to take the database, as that lane's own files spell it.
  DATABASE_MARKERS = {
    "packages/pi-session-neon" => './postgres.ts"',
    "packages/prisma-geography" => './support/database.ts"',
    "workers/catalog" => "databaseDescribe(",
    "workers/users" => "databaseDescribe("
  }.freeze

  def workspace_directories
    globs = Psych.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml")))["packages"]
    globs.flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
         .map { |path| File.dirname(path).delete_prefix("#{ROOT}/") }.sort
  end

  def scripts_of(directory)
    JSON.parse(File.read(File.join(ROOT, directory, "package.json")))["scripts"] || {}
  end

  def integration_lanes
    workspace_directories.select { |directory| scripts_of(directory).key?(LANE) }
  end

  # The lane's command with every sub-lane it chains spliced in.
  def lane_command(directory, script = LANE)
    command = scripts_of(directory).fetch(script)
    command.scan(SUB_LANE).flatten.reduce(command) { |text, sub| text + " " + lane_command(directory, sub) }
  end

  # A glob argument: a path token carrying a `*`, however quoted. Flag values are not arguments —
  # `--test-coverage-include` names source files, not the tests the lane runs.
  def glob_arguments(command)
    command.split.reject { |token| token.start_with?("--") }
           .map { |token| token.delete("'\"") }
           .select { |token| token.include?("*") && token.end_with?(".ts") }
  end

  # A vitest lane writes its selection in the config it names instead of on the command line.
  def config_globs(directory, command)
    config = command[VITEST_CONFIG, 1]
    source = File.read(File.join(ROOT, directory, config))
    source[VITEST_INCLUDE, 1].to_s.scan(/["']([^"']+)["']/).flatten
  end

  def declared_globs(directory)
    command = lane_command(directory)
    globs = glob_arguments(command)
    globs.empty? ? config_globs(directory, command) : globs
  end

  # Node lanes `cd` to the repository root before globbing and vitest lanes do not, so a glob is
  # resolved from both and answers from whichever it was written for.
  def resolve(directory, glob)
    Dir.glob(glob, base: ROOT) +
      Dir.glob(glob, base: File.join(ROOT, directory)).map { |path| File.join(directory, path) }
  end

  def selected_files(directory)
    declared_globs(directory).flat_map { |glob| resolve(directory, glob) }.uniq.sort
  end

  def selection
    integration_lanes.to_h { |directory| [directory, selected_files(directory)] }
  end

  def unit_files_in(files)
    files.select { |path| path.end_with?(UNIT_SUFFIX) }
  end

  def databaseless_files_in(directory, files)
    marker = DATABASE_MARKERS.fetch(directory)
    files.reject { |path| File.read(File.join(ROOT, path)).include?(marker) }
  end

  # A lane whose globs this test cannot resolve is a lane it cannot guard, and it would pass by
  # measuring nothing — the failure `coverage_gate.rb` refuses for the same reason.
  def test_every_integration_lane_resolves_to_files
    empty = selection.select { |_, files| files.empty? }.keys
    assert_empty empty, "#{LANE} selects no file in #{empty.join(', ')} — a lane this test cannot " \
                        "see is a lane it cannot guard, so its shape has to be read here first"
  end

  def test_no_integration_lane_selects_a_unit_file
    matched = selection.transform_values { |files| unit_files_in(files) }.reject { |_, files| files.empty? }
    assert_empty matched, "#{LANE} runs unit files inside the container lane: " \
                          "#{matched.values.flatten.join(', ')} — they belong to the `test` lane, " \
                          "which needs no container"
  end

  def test_every_file_a_database_lane_selects_takes_the_database
    lanes = DATABASE_MARKERS.keys.to_h { |directory| [directory, selected_files(directory)] }
    without = lanes.map { |directory, files| databaseless_files_in(directory, files) }.flatten
    assert_empty without, "#{LANE} runs files that never reach for the database: " \
                          "#{without.join(', ')} — each boots the container and uses nothing of it"
  end

  def test_database_lanes_name_packages_that_still_have_the_lane
    stale = DATABASE_MARKERS.keys - integration_lanes
    assert_empty stale, "DATABASE_MARKERS names #{stale.join(', ')}, which declares no #{LANE} — " \
                        "a marker for a retired lane guards nothing"
  end
end
