# SUT: package.json test scripts and pnpm-workspace.yaml.
require "minitest/autorun"
require "json"
require "psych"

class PackageTestSegmentsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  # The native lanes run node's own test runner, loaded through tsx. Those two facts are the shape;
  # the flags around them are not. Pinning the literal adjacency `node --import tsx --test` failed the
  # day `packages/agent` put `--expose-gc` in front of the loader to force a real collection, so the
  # property is asserted instead: one node invocation that both loads tsx and runs the test runner,
  # in either order, with anything else in between — and never a longer `--test-*` flag standing in
  # for the runner itself.
  TSX_LOADED_TEST_RUNNER = %r{\bnode\b(?=[^&|]*--import\s+tsx)(?=[^&|]*--test(?![\w-]))}

  REQUIRED_SEGMENTS = {
    "workers/edge" => %w[test:node test:chat-answer-part test:bundle-smoke test:ratelimit-namespace],
    "workers/catalog" => %w[test:worker],
    "workers/users" => %w[test:worker],
    "workers/migrator" => ["vitest run"],
    "packages/contract" => ["vitest run", "vet:baseline", "test:openapi-drift"],
    "packages/agent" => [TSX_LOADED_TEST_RUNNER],
    "packages/pi-session-neon" => ["node --test", "test/contract-types.test.ts"],
    "packages/prisma-geography" => ["node --test", "test/*.unit.test.ts"],
    "packages/eval" => [TSX_LOADED_TEST_RUNNER],
    "packages/test-postgres" => ["node --test"],
    "infra" => ["node --test", "test:program-load"],
    "apps/web" => ["vitest run"],
    "apps/agent" => ["uv run pytest"],
    "e2e" => ["playwright test", "E2E_SERVE_EMITTED_WORKER=1",
              "web-404.spec.ts", "web-maplibre-canary.spec.ts",
              "web-chat-anonymous.spec.ts", "web-hero-query.spec.ts",
              "web-state-ownership.spec.ts", "web-a11y-axe.spec.ts",
              "web-a11y-keyboard.spec.ts", "web-a11y-states.spec.ts",
              "web-cwv.spec.ts", "web-chat-settings-return.spec.ts"]
  }.freeze

  # A package whose Docker-backed suite must stay outside `test` (#1473): `test` is the script every
  # affected package runs, and chaining it booted a container on every push that touched the package.
  # The suite is `test:integration` instead — the standard second lane, which pre-push, the CI
  # affected matrix and `make check-full` all run for an affected package, so nothing has to name it
  # again. The pair is pinned in both directions: the script exists, and `test` does not chain it.
  DOCKER_FREE_TEST_SCRIPTS = {
    "workers/catalog" => "test:integration"
  }.freeze

  DELEGATED_COMMANDS = {
    ["workers/edge", "test:bundle-smoke"] => "bundle-smoke/",
    ["workers/edge", "test:ratelimit-namespace"] => "check-edge-ratelimit-namespace.sh",
    ["workers/catalog", "test:integration"] => "vitest.integration.config.ts",
    ["packages/contract", "test:openapi-drift"] => "contract-drift.sh",
    ["infra", "test:program-load"] => "infra-check.sh"
  }.freeze

  def manifest_of(directory)
    JSON.parse(File.read(File.join(ROOT, directory, "package.json")))
  end

  def scripts_of(directory)
    manifest_of(directory)["scripts"] || {}
  end

  def workspace_directories
    globs = Psych.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml")))["packages"]
    globs.flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
         .map { |path| File.dirname(path).delete_prefix("#{ROOT}/") }
         .sort
  end

  def assert_package_segments(directory, segments)
    scripts = scripts_of(directory)
    refute_empty scripts.fetch("test", ""), "#{directory}/package.json: test script is missing"
    segments.each do |segment|
      if segment.is_a?(Regexp)
        assert_match segment, scripts["test"], "#{directory}: test must run #{segment}"
      else
        assert_includes scripts["test"], segment, "#{directory}: test must run #{segment}"
      end
    end
    segments.grep(/^test:/).each { |segment| assert scripts.key?(segment), "#{directory}: #{segment} is undefined" }
  end

  def test_every_declared_segment_runs
    REQUIRED_SEGMENTS.each { |directory, segments| assert_package_segments(directory, segments) }
  end

  def test_manifest_covers_every_workspace_test_lane
    lanes = workspace_directories.select { |directory| scripts_of(directory).key?("test") }
    assert_empty lanes - REQUIRED_SEGMENTS.keys, "pnpm-workspace.yaml: new test lanes need required segments"
  end

  def test_delegated_scripts_keep_their_commands
    DELEGATED_COMMANDS.each do |(directory, script), command|
      assert_includes scripts_of(directory).fetch(script, ""), command, "#{directory}: #{script} must run #{command}"
    end
  end

  def assert_docker_free_test_script(directory, segment)
    scripts = scripts_of(directory)
    assert scripts.key?(segment), "#{directory}: #{segment} is undefined"
    refute_includes scripts.fetch("test", ""), segment,
                    "#{directory}: #{segment} must stay outside the Docker-free `test` script"
  end

  def test_docker_backed_suites_stay_out_of_the_test_script
    DOCKER_FREE_TEST_SCRIPTS.each { |directory, segment| assert_docker_free_test_script(directory, segment) }
  end
end
