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
                 "a new edge environment must join this contract, not escape it; " \
                 "every header that names env.<name> counts — [env.x] directly, " \
                 "[env.x.<sub>] and [[env.x.<sub>]] through TOML's implicit parent " \
                 "tables — so a sub-table-only environment is counted (#1842)"
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
                 "every header that names env.<name> counts — [env.x] directly, " \
                 "[env.x.<sub>] and [[env.x.<sub>]] through TOML's implicit parent " \
                 "tables — so a sub-table-only environment is counted (#1842)"
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
                 "a new migrator environment must join this contract, not escape it; " \
                 "every header that names env.<name> counts — [env.x] directly, " \
                 "[env.x.<sub>] and [[env.x.<sub>]] through TOML's implicit parent " \
                 "tables — so a sub-table-only environment is counted (#1842)"
  end

  # --- the header shape the ratchet reads (#1854) ---

  # TOML permits a comment after a table header, so `[env.preview] # a note` is
  # a live declaration exactly as the bare form is. Both scanners anchored the
  # closing bracket to end-of-line and never saw it — and the hole is wider
  # than the sub-table case that was reported: a plain `[env.preview]` carrying
  # a trailing comment escaped too, so the ratchet's claimed scope ("exactly
  # these environments") exceeded its real scope.
  def test_a_header_with_a_trailing_comment_declares_its_environment
    sections = parse_toml_env_text(<<~TOML)
      [env.production]
      workers_dev = false
      [env.preview] # a preview ring, deliberately declared
      name = "animichi-edge-preview"
      [env.canary.vars] # a sub-table only: TOML's implicit parent declares env.canary
      [[env.qa.ratelimits]] # double-bracketed: still a parent declaration
    TOML

    assert_equal %w[env.canary env.preview env.production env.qa], sections.keys.sort,
                 "a trailing comment closes the header, not the declaration (#1854): " \
                 "the bare, sub-table and double-bracketed forms all count with one"
    assert_equal '"animichi-edge-preview"', sections["env.preview"]["name"],
                 "the commented header still scopes the keys under it (#1854)"
  end

  # The trap: fixing the header scan by stripping everything after the first
  # `#` on every line would silently truncate a value that legitimately holds
  # one — a colour, a URL fragment — trading a missed environment for a wrong
  # one. The rule is the header shape only, and a bracketed value is not a
  # header at all.
  def test_a_hash_inside_a_value_is_read_intact_and_declares_no_environment
    sections = parse_toml_env_text(<<~TOML)
      [env.production]
      accent = "#eb4034"
      docs = "https://animichi.com/docs#install"
      marker = "[env.evil]#not-a-header"
    TOML

    assert_equal %w[env.production], sections.keys.sort,
                 "a `#` inside a value declares nothing; the value line is not a header (#1854)"
    assert_equal '"#eb4034"', sections["env.production"]["accent"],
                 "a colour value is read intact, not truncated at its `#` (#1854)"
    assert_equal '"https://animichi.com/docs#install"', sections["env.production"]["docs"],
                 "a URL fragment is read intact, not truncated at its `#` (#1854)"
  end

  # --- whitespace inside the brackets (#1854) ---

  # TOML ignores whitespace around a table key, so `[ env.preview ]` declares
  # `env.preview`. The scanner normalises the bracketed text once (strip
  # surrounding horizontal whitespace) before deciding `env.<name>` — this
  # shape and any future spacing variant are covered by construction.
  def test_whitespace_inside_the_brackets_declares_its_environment
    sections = parse_toml_env_text(<<~TOML)
      [env.production]
      workers_dev = false
      [ env.preview ]
      name = "animichi-edge-preview"
      [ env.preview.vars ] # note
      foo = "bar"
    TOML

    assert_equal %w[env.production env.preview].sort, sections.keys.sort,
                 "whitespace inside the brackets must not hide the declaration (#1854): " \
                 "the scanner normalises the bracketed text once, so this shape and " \
                 "any future spacing variant are covered by construction"
    assert_equal '"animichi-edge-preview"', sections["env.preview"]["name"],
                 "the normalised header still scopes the keys under it (#1854)"
  end

  # Normalisation must not turn a non-env header into one: `[ envelope ]`
  # declares nothing — stripping spaces makes the key `envelope`, which has
  # no `env.` prefix.
  def test_whitespace_inside_a_non_env_header_declares_nothing
    sections = parse_toml_env_text(<<~TOML)
      [ env.production ]
      workers_dev = false
      [ envelope ]
      foo = "bar"
    TOML

    assert_equal %w[env.production], sections.keys.sort,
                 "normalising `[ envelope ]` must not produce an env declaration (#1854)"
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
    # Validate that every exclusion reason is a non-empty, meaningful string.
    DEPLOY_SCRIPT_EXCLUSIONS.each do |unit, reason|
      assert reason.is_a?(String) && reason.strip.length > 0,
             "DEPLOY_SCRIPT_EXCLUSIONS['#{unit}'] must have a non-empty reason, got: #{reason.inspect}"
    end
    CONTRACT_ONLY_UNITS.each do |unit, reason|
      assert reason.is_a?(String) && reason.strip.length > 0,
             "CONTRACT_ONLY_UNITS['#{unit}'] must have a non-empty reason, got: #{reason.inspect}"
    end

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
    # Pattern 1: for unit in X Y Z; do (scan for ALL loops, not just the first)
    content.scan(/for\s+unit\s+in\s+([^;]+);/) { units.concat($1.split) }
    # Pattern 2: deploy_service "name" ...
    content.scan(/deploy_service\s+"([^"]+)"/) { units << $1 }
    units.uniq
  end

  # Shared TOML section parser. Structurally mirrors the edge test's header
  # scan. #1524 established the key scoping: a sub-table header ends the
  # environment's own key list, and keys after it belong to the sub-table —
  # they are never attributed to the parent.
  #
  # #1842 establishes the environment enumeration: the environments a
  # wrangler.toml declares are the `env.<name>` prefixes named by ANY section
  # header — `[env.<name>]` directly, and `[env.<name>.<sub>]` or
  # `[[env.<name>.<sub>]]` through TOML's implicit parent declaration.
  # Measured with smol-toml 1.8.0: `[env.preview.vars]` with no `[env.preview]`
  # header parses to `env` keys `["production", "preview"]`, and wrangler
  # 4.132.0 enumerates environments as `Object.keys(rawConfig.env ?? {})`
  # (wrangler-dist/cli.js, normalizeAndValidateConfig) — so a sub-table-only
  # environment is a live environment, not a blind spot. Header lines outside
  # that bare-word form (quoted or dotted quoted env names, whitespace inside
  # the brackets) are not recognized by this parser; no config this contract
  # reads uses them. Two hand-rolled implementations of this one rule exist by
  # choice (see the edge test's matching scan): each guard lane stays
  # single-runtime, and each carries its own red/green proof of the rule.
  #
  # #1854 closes the header's tail: TOML permits a comment after a header, so
  # the closing bracket is followed by blank-or-comment, not end-of-line —
  # `[env.preview] # a note` is the same declaration as `[env.preview]`. The
  # rule is the header shape only: a blanket strip from the first `#` of every
  # line would truncate a value that legitimately holds one (a colour, a URL
  # fragment), trading a missed environment for a wrong one. The scan is still
  # line-oriented: a header-shaped line inside a multi-line string reads as a
  # header (a limit the bare form already had), and a comment after a *key's*
  # value is not modelled — that key is dropped, so the contract fails loudly
  # rather than passing silently.
  def parse_toml_env_sections(path)
    parse_toml_env_text(File.read(path))
  end

  def parse_toml_env_text(toml)
    parsed = Hash.new { |hash, key| hash[key] = {} }
    current = nil
    content_lines(toml).each do |line|
      table = /\A(\[+)([^\]]+)\]+[ \t]*(?:#.*)?\z/.match(line)
      if table
        env = table[2].strip[/\Aenv\.[A-Za-z0-9_-]+/]
        if env
          parsed[env] unless parsed.key?(env)
          current = table[2].strip == env ? env : nil
        else
          current = nil
        end
      end
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
