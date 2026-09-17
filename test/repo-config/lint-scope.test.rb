# SUT: repository lint-scope configuration; tests preserve the reviewed tool input and install policy.
require "minitest/autorun"
require "json"
require "psych"

class LintScopeTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  OXLINT_CONFIG = ".oxlintrc.json"
  OXLINT_REVIEWED_IGNORES = {
    "." => [],
    "apps/web" => ["node_modules/**", ".output/**", ".nitro/**", ".tanstack/**", "coverage/**",
                   "dist/**", "vitest*.config.ts", "vite.config.ts", "**/routeTree.gen.ts"],
    "packages/agent" => ["coverage/**"],
    "packages/pi-session-neon" => [],
    "packages/prisma-geography" => [],
    "e2e" => ["node_modules/**", "test-results/**", "playwright-report/**", ".auth/**",
              "generated/**", "agent-discovered/**", "visual/report/**", "visual/canonical/**"],
    "workers/catalog" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                          "vitest.config.ts", "vitest.integration.config.ts"],
    "workers/migrator" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                           "vitest.config.ts"],
    "workers/users" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                        "vitest.config.ts"]
  }.freeze

  def declared_oxlint_ignores
    paths = Dir.glob("**/#{OXLINT_CONFIG}", base: ROOT)
               .reject { |path| path.split("/").include?("node_modules") }
    paths.each_with_object({}) do |path, ignores|
      parsed = JSON.parse(File.read(File.join(ROOT, path)))
      ignores[File.dirname(path)] = Array(parsed["ignorePatterns"])
    end
  end

  def test_every_oxlint_config_is_reviewed
    found = declared_oxlint_ignores.keys.sort
    assert(found == OXLINT_REVIEWED_IGNORES.keys.sort,
                     "the reviewed oxlint configs are #{OXLINT_REVIEWED_IGNORES.keys.sort.join(', ')} " \
                     "(found #{found.join(', ')}); an unreviewed #{OXLINT_CONFIG} can ignore its own package's " \
                     "source, and a deleted one takes its package out of the type-aware lane entirely")
  end

  def render_patterns(patterns)
    patterns.empty? ? "none" : patterns.join(", ")
  end

  def test_oxlint_ignores_only_what_was_reviewed
    declared_oxlint_ignores.each do |directory, patterns|
      reviewed = OXLINT_REVIEWED_IGNORES[directory]
      assert(patterns == reviewed,
                       "#{File.join(directory, OXLINT_CONFIG)}: ignorePatterns must be exactly " \
                       "#{render_patterns(reviewed)} (got #{render_patterns(patterns)}); a pattern added here " \
                       "deletes files from `oxlint --type-aware --deny-warnings` without touching the command")
    end
  end
end
