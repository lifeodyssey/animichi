# SUT: the production blocks of workers/edge/wrangler.toml ([env.production]) and of
# apps/web/wrangler.jsonc (the top level — the same Worker as env.production, `animichi-web` —
# and env.production itself). Those blocks must declare `workers_dev = false` and
# `preview_urls = false` explicitly; staging keeps `workers_dev = true` on purpose (#1369,
# behind the Access application).
#
# workers/migrator is deliberately OUT of this contract: its `[env.production]` sets
# `workers_dev = true` on purpose, in its own words —
#
#   # The migrator is a live helper endpoint (OIDC-protected) the deploy pipeline
#   # calls, so it exposes a CI-reachable host. Staging uses the account's
#   # workers.dev host (a public config, not a credential); stateful/private
#   # Workers keep workers_dev = false (see catalog/users).
#
# — so "workers_dev is off in production" is a claim about the edge and web Workers only.
# workers/users declares no `preview_urls` at any level and is followed up separately (#1836).
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
require "json"
require "minitest/autorun"

class WranglerWorkersDevTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  EDGE_TOML = "workers/edge/wrangler.toml"
  WEB_JSONC = "apps/web/wrangler.jsonc"

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

  def edge_sections
    @edge_sections ||= begin
      parsed = Hash.new { |hash, key| hash[key] = {} }
      current = nil
      content_lines(File.read(File.join(ROOT, EDGE_TOML))).each do |line|
        table = /\A\[+([^\]]+)\]+\z/.match(line)
        current = table[1][/\Aenv\.[A-Za-z0-9_-]+\z/] if table
        next if current.nil?
        pair = /\A([A-Za-z0-9_-]+)\s*=\s*(\S+)\z/.match(line)
        parsed[current][pair[1]] = pair[2] if pair
      end
      parsed
    end
  end

  def content_lines(toml)
    toml.split("\n").map(&:strip).reject { |line| line.empty? || line.start_with?("#") }
  end

  def web_config
    @web_config ||= JSON.parse(File.read(File.join(ROOT, WEB_JSONC)))
  end
end
