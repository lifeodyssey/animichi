# SUT: the production blocks of workers/edge/wrangler.toml ([env.production]),
# apps/web/wrangler.jsonc (the top level — the same Worker as env.production,
# `animichi-web` — and env.production itself), workers/users/wrangler.toml
# ([env.production]), and workers/migrator/wrangler.toml ([env.production]).
#
# edge, web, and users must declare `workers_dev = false` and
# `preview_urls = false` explicitly. staging keeps `workers_dev = true` on
# purpose (#1369, behind the Access application).
#
# workers/migrator is the deliberate exception: its `[env.production]` sets
# `workers_dev = true` on purpose, in its own words —
#
#   # The migrator is a live helper endpoint (OIDC-protected) the deploy pipeline
#   # calls, so it exposes a CI-reachable host. Staging uses the account's
#   # workers.dev host (a public config, not a credential); stateful/private
#   # Workers keep workers_dev = false (see catalog/users).
#
# — so "workers_dev is off in production" is a claim about the edge, web, and
# users Workers only. The migrator's `workers_dev = true` is intentional and
# asserted (see test_migrator_production_declares_workers_dev_true_intentionally).
#
# #1524 measured why the explicit pin is the contract: wrangler resolves an unset `workers_dev`
# to `routes.length === 0` (wrangler 4.132.0, cli.js `getSubdomainValues`), and both blocks
# this contract covers declare no routes (routing is Pulumi-side) — so omission means the
# workers.dev host is OPEN on the next deploy. Before #1524 neither block set the key, and a
# comment in the edge toml claimed "`workers_dev = false` since #539" while the file declared
# nothing. Measured 2026-09-21, both production hosts answered 404 with a body byte-identical
# both to a never-registered host and to a deployed Worker whose subdomain is off (`error code:
# 1042` in all three cases), so the measurement shows the host is closed and not why. Nothing
# in either config guaranteed it. Parsed structurally, with wrangler's own table scoping: a
# sub-table header (`[env.production.vars]`, `[[env.production.ratelimits]]`) ends the
# environment's own key list, and keys after it belong to the sub-table — so reordering,
# recommenting, or relocating a pin under a sub-table fails this guard rather than passing it.
# The JSONC needs no hand-rolled stripper: the pinned Ruby's JSON.parse (json 2.18.0, a
# Ruby 4.0.7 default gem) skips JSONC comments itself.
#
# #1836 extends this contract to workers/users (must pin both keys off) and
# workers/migrator (must assert the deliberate workers_dev = true). The SUT
# header must name exactly the production units covered; adding a unit to
# publish-services.sh without adding it to this contract makes the test red.
require "json"
require "minitest/autorun"

class WranglerWorkersDevTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  EDGE_TOML = "workers/edge/wrangler.toml"
  WEB_JSONC = "apps/web/wrangler.jsonc"
  USERS_TOML = "workers/users/wrangler.toml"
  MIGRATOR_TOML = "workers/migrator/wrangler.toml"

  # --- edge ---

  def test_edge_production_declares_the_subdomain_closed
    section = edge_sections.fetch("env.production")
    assert_equal "false", section["workers_dev"],
                 "edge [env.production] must declare workers_dev = false explicitly (#1524); " \
                 "unset resolves to routes.length === 0, which is ON for this route-less block"
    assert_equal "false", section["preview_urls"],
                 "edge [env.production] must declare preview_urls = false explicitly (#1524)"
  end

  def test_edge_staging_keeps_its_deliberate_workers_dev_true
    section = edge_sections.fetch("env.staging")
    assert_equal "true", section["workers_dev"],
                 "edge [env.staging] keeps workers_dev = true (owner 2026-08-27, #1369 Access)"
    assert_equal "false", section["preview_urls"],
                 "edge [env.staging] must declare preview_urls = false explicitly"
  end

  def test_edge_declares_exactly_the_environments_this_contract_names
    assert_equal %w[env.production env.staging], edge_sections.keys,
                 "a new edge environment must join this contract, not escape it"
  end

  # --- web ---

  def test_web_top_level_declares_the_subdomain_closed
    config = web_config
    assert_equal false, config["workers_dev"],
                 "the web top level IS the production Worker (name = env.production.name): " \
                 "workers_dev = false (#1524); unset resolves to ON for this route-less config"
    assert_equal false, config["preview_urls"],
                 "the web top level must declare preview_urls = false explicitly (#1524)"
  end

  def test_web_production_declares_the_subdomain_closed
    production = web_config.fetch("env").fetch("production")
    assert_equal false, production["workers_dev"],
                 "web env.production must declare workers_dev = false explicitly (#1524)"
    assert_equal false, production["preview_urls"],
                 "web env.production must declare preview_urls = false explicitly (#1524)"
  end

  def test_web_staging_keeps_its_deliberate_workers_dev_true
    staging = web_config.fetch("env").fetch("staging")
    assert_equal true, staging["workers_dev"],
                 "web env.staging keeps workers_dev = true (owner 2026-08-27, #1369 Access)"
    assert_equal false, staging["preview_urls"],
                 "web env.staging must declare preview_urls = false explicitly"
  end

  def test_web_declares_exactly_the_environments_this_contract_names
    assert_equal %w[production staging], web_config.fetch("env").keys.sort,
                 "a new web environment must join this contract, not escape it"
  end

  # --- users (#1836) ---

  def test_users_production_declares_the_subdomain_closed
    section = users_sections.fetch("env.production")
    assert_equal "false", section["workers_dev"],
                 "users [env.production] must declare workers_dev = false explicitly (#1836); " \
                 "unset resolves to routes.length === 0, which is ON for this route-less block"
    assert_equal "false", section["preview_urls"],
                 "users [env.production] must declare preview_urls = false explicitly (#1836); " \
                 "unset sends no previews_enabled and the server keeps the enabled-by-default state"
  end

  def test_users_staging_keeps_its_deliberate_workers_dev_false
    section = users_sections.fetch("env.staging")
    assert_equal "false", section["workers_dev"],
                 "users [env.staging] must declare workers_dev = false explicitly (#1836)"
  end

  def test_users_declares_exactly_the_environments_this_contract_names
    assert_equal %w[env.production env.staging].sort, users_sections.keys.sort,
                 "a new users environment must join this contract, not escape it; " \
                 "an environment declared only through a sub-table (e.g. [env.preview.vars]) " \
                 "escapes this guard — that blind spot is filed as #1842 and does not apply here " \
                 "because both environments have direct key = value lines"
  end

  # --- migrator (#1836) ---

  def test_migrator_production_declares_workers_dev_true_intentionally
    section = migrator_sections.fetch("env.production")
    assert_equal "true", section["workers_dev"],
                 "migrator [env.production] must declare workers_dev = true intentionally; " \
                 "it is an OIDC-protected live helper endpoint the deploy pipeline calls " \
                 "(workers/migrator/wrangler.toml:28-33, #1051/#1124/#1589); " \
                 "flipping this to false would break the deploy pipeline — drift in both " \
                 "directions must be caught"
    assert_equal "false", section["preview_urls"],
                 "migrator [env.production] must declare preview_urls = false explicitly"
  end

  def test_migrator_staging_declares_workers_dev_true
    section = migrator_sections.fetch("env.staging")
    assert_equal "true", section["workers_dev"],
                 "migrator [env.staging] must declare workers_dev = true explicitly; " \
                 "staging uses the account's workers.dev host (a public config, not a credential)"
    assert_equal "false", section["preview_urls"],
                 "migrator [env.staging] must declare preview_urls = false explicitly"
  end

  def test_migrator_declares_exactly_the_environments_this_contract_names
    assert_equal %w[env.production env.staging].sort, migrator_sections.keys.sort,
                 "a new migrator environment must join this contract, not escape it"
  end

  # --- SUT coverage (#1836 AC3) ---

  # Units this contract deliberately excludes: catalog has its own contract
  # in workers/catalog/test/wrangler-private.worker.test.ts; the migrator is
  # deployed separately (not by publish-services.sh) and is asserted here for
  # its own deliberate config.
  DEPLOY_SCRIPT_EXCLUSIONS = {
    "catalog" => "own contract: workers/catalog/test/wrangler-private.worker.test.ts",
  }.freeze

  # Units this contract covers that are NOT in the deploy script (deployed
  # separately, deliberately asserted here).
  CONTRACT_ONLY_UNITS = {
    "migrator" => "deployed separately; deliberately asserts workers_dev = true (#1836)",
  }.freeze

  def test_contract_sut_header_names_exactly_the_production_units_covered
    deployed = publish_services_deployed_units
    covered  = %w[edge web users migrator]

    uncovered_deployed = deployed - covered - DEPLOY_SCRIPT_EXCLUSIONS.keys
    assert_empty uncovered_deployed,
                 "production units deployed by publish-services.sh but not covered by " \
                 "this contract and not listed in DEPLOY_SCRIPT_EXCLUSIONS: #{uncovered_deployed}. " \
                 "Either add wrangler contract assertions for them here, or add them to " \
                 "DEPLOY_SCRIPT_EXCLUSIONS with a reason. (#{DEPLOY_SCRIPT_EXCLUSIONS})"

    missing_from_script = covered - deployed - CONTRACT_ONLY_UNITS.keys
    assert_empty missing_from_script,
                 "contract covers units not in publish-services.sh and not in " \
                 "CONTRACT_ONLY_UNITS: #{missing_from_script}. Either add them to the " \
                 "deploy script, or add them to CONTRACT_ONLY_UNITS with a reason."
  end

  private

  def edge_sections
    @edge_sections ||= parse_toml_env_sections(File.join(ROOT, EDGE_TOML))
  end

  def web_config
    @web_config ||= JSON.parse(File.read(File.join(ROOT, WEB_JSONC)))
  end

  def users_sections
    @users_sections ||= parse_toml_env_sections(File.join(ROOT, USERS_TOML))
  end

  def migrator_sections
    @migrator_sections ||= parse_toml_env_sections(File.join(ROOT, MIGRATOR_TOML))
  end

  # Parse publish-services.sh to extract the production units it deploys.
  # The script uses two deployment patterns:
  #   1. A `for unit in ...; do ... done` loop
  #   2. Standalone `deploy_service "name" ...` calls
  # This returns all unit names as an array.
  def publish_services_deployed_units
    path = File.join(ROOT, ".github/scripts/release/publish-services.sh")
    content = File.read(path)
    units = []
    # Pattern 1: for unit in X Y Z; do
    for_match = content.match(/for\s+unit\s+in\s+([^;]+);/)
    units.concat(for_match[1].split) if for_match
    # Pattern 2: deploy_service "name" ...
    content.scan(/deploy_service\s+"([^"]+)"/) { units << $1 }
    units.uniq
  end

  # Shared TOML section parser. Structurally mirrors the edge parser that
  # #1524 established: a sub-table header ends the environment's own key list,
  # and keys after it belong to the sub-table.
  #
  # Blind-spot note (#1842): an environment declared only through sub-tables
  # (e.g. [env.preview.vars]) never enters the hash. Both users and migrator
  # environments have direct key = value lines, so this does not apply here.
  def parse_toml_env_sections(path)
    parsed = Hash.new { |hash, key| hash[key] = {} }
    current = nil
    content_lines(File.read(path)).each do |line|
      table = /\A\[+([^\]]+)\]+\z/.match(line)
      current = table[1][/\Aenv\.[A-Za-z0-9_-]+\z/] if table
      next if current.nil?
      pair = /\A([A-Za-z0-9_-]+)\s*=\s*(\S+)\z/.match(line)
      parsed[current][pair[1]] = pair[2] if pair
    end
    parsed
  end

  def content_lines(toml)
    toml.split("\n").map(&:strip).reject { |line| line.empty? || line.start_with?("#") }
  end
end
