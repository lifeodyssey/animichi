# SUT: e2e/playwright.config.ts; tests check service-token scope without starting a browser.
require "minitest/autorun"

class PlaywrightConfigTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  PLAYWRIGHT_CONFIG = File.join(ROOT, "e2e", "playwright.config.ts")
  ACCESS_TOKEN_MODULE = '@animichi/contract/access-service-token'
  ACCESS_TOKEN_READER = "accessServiceTokenHeaders(process.env)"
  ACCESS_TOKEN_LANE_GUARD = "if (isLoopbackTarget(baseUrl)) throw new Error(loopbackRefusal());"
  ACCESS_TOKEN_LOOPBACK_REFUSAL = /function loopbackRefusal\(\): string \{/
  CROSS_ORIGIN_REFUSAL = "if (foreign.length > 0) throw new Error(crossOriginRefusal(foreign));"
  CROSS_ORIGIN_VARS = %w[NEON_AUTH_BASE_URL VITE_NEON_AUTH_BASE_URL].freeze
  LOOPBACK_RULE_MODULE = "isLoopbackHostname"
  LANE_PORT_MODULE = '"./lane-port"'
  LANE_PORT_DERIVATION = "emittedWorkerPort(process.env, worktreeRoot)"
  RETIRED_HARDCODED_PORT = 'const emittedWorkerPort = "8799"'
  PORT_CLAIM = 'claimLanePort(lanePort)'
  PORT_CLAIM_FROM_THE_RUN = 'claimedPort(process.env)'
  # Port 9229 is wrangler's inspector, and it is a machine-global singleton of
  # its own: two lanes that each own their serving port still fight over this
  # one, and the loser's server exits before a spec runs (measured, #1692 AC1).
  # `--inspector-port 0` takes an OS-assigned one instead — the same recipe
  # packages/agent's integration harness uses.
  INSPECTOR_PORT = "--inspector-port 0"
  # The KEY, not the word: the config's own comment quotes Playwright's advice
  # in order to reject it, and that must not read as setting it.
  REUSE_EXISTING_SERVER_KEY = /^\s*reuseExistingServer:/

  def test_the_lane_port_belongs_to_its_checkout
    config = File.read(PLAYWRIGHT_CONFIG)
    assert(config.include?(LANE_PORT_MODULE),
           "e2e/playwright.config.ts: the emitted Worker's port must come from #{LANE_PORT_MODULE} " \
           "(#1692: one hardcoded port is shared by every worktree on the machine)")
    assert(config.include?(LANE_PORT_DERIVATION),
           "e2e/playwright.config.ts: the port must be derived from this checkout's root, not chosen")
    assert(config.include?(PORT_CLAIM_FROM_THE_RUN),
           "e2e/playwright.config.ts: a run must reuse the port its runner claimed, or a worker " \
           "process re-derives it after the server has bound")
    refute(config.include?(RETIRED_HARDCODED_PORT),
           "e2e/playwright.config.ts: #{RETIRED_HARDCODED_PORT} is back — that is the machine-global " \
           "port two worktrees collide on")
    assert(config.include?(INSPECTOR_PORT),
           "e2e/playwright.config.ts: wrangler's inspector must not stay on its default :9229, " \
           "which two concurrent lanes collide on even when their serving ports differ")
  end

  def test_the_lane_claims_its_port_before_playwright_can
    config = File.read(PLAYWRIGHT_CONFIG)
    assert(config.include?(PORT_CLAIM),
           "e2e/playwright.config.ts: the lane must claim its port")
    # At config load, not inside the server command: Playwright checks webServer.url
    # itself first, and its answer suggests reuseExistingServer (see below).
    assert_operator(config.index(PORT_CLAIM), :<, config.index("export default defineConfig"),
                    "e2e/playwright.config.ts: the claim must run while the config loads, ahead of " \
                    "Playwright's own port check")
  end

  def test_the_lane_never_adopts_another_checkouts_server
    config = File.read(PLAYWRIGHT_CONFIG)
    refute_match(REUSE_EXISTING_SERVER_KEY, config,
           "e2e/playwright.config.ts: reuseExistingServer must stay unset (Playwright's undefined " \
           "is the safe value) — setting it makes a lane silently attach to another checkout's " \
           "server, which is the #1692 symptom rather than its cure")
  end

  def test_the_suite_presents_the_staging_access_token
    config = File.read(PLAYWRIGHT_CONFIG)
    assert(config.include?(ACCESS_TOKEN_MODULE),
                     "e2e/playwright.config.ts: must read the Access service token from #{ACCESS_TOKEN_MODULE}")
    assert(config.include?(ACCESS_TOKEN_READER),
                     "e2e/playwright.config.ts: must resolve the token from the process environment")
    assert(config.match?(/extraHTTPHeaders:\s*accessHeaders/),
                     "e2e/playwright.config.ts: the token must ride on use.extraHTTPHeaders, " \
                     "or every staging navigation answers with the Access login page")
    assert_the_token_is_scoped_to_a_staging_target(config)
    assert_the_token_cannot_leave_the_target_origin(config)
  end

  def assert_the_token_is_scoped_to_a_staging_target(config)
    assert(config.include?(ACCESS_TOKEN_LANE_GUARD),
                     "e2e/playwright.config.ts: the token must be read only for a non-loopback target, " \
                     "or a local run sends staging's service token to whatever is on that port")
    assert(config.match?(ACCESS_TOKEN_LOOPBACK_REFUSAL),
                     "e2e/playwright.config.ts: a token declared against a loopback target must be " \
                     "refused by name, not silently dropped")
    assert(config.include?(LOOPBACK_RULE_MODULE),
                     "e2e/playwright.config.ts: \"this machine\" must come from #{LOOPBACK_RULE_MODULE} " \
                     "in #{ACCESS_TOKEN_MODULE}, not a second spelling that can disagree")
  end

  def assert_the_token_cannot_leave_the_target_origin(config)
    assert(config.include?(CROSS_ORIGIN_REFUSAL),
                     "e2e/playwright.config.ts: use.extraHTTPHeaders is context-wide — the run must be " \
                     "refused when a configured origin sits off the target host")
    declared = cross_origin_vars_of(config)
    CROSS_ORIGIN_VARS.each do |name|
      assert(declared.include?(name),
                       "e2e/playwright.config.ts: #{name} names an origin the browser reaches, so it " \
                       "must be in CROSS_ORIGIN_BASE_URL_VARS (got #{declared.join(', ')})")
    end
  end

  def cross_origin_vars_of(config)
    literal = config[/const CROSS_ORIGIN_BASE_URL_VARS = \[(.*?)\]/m, 1]
    return [] if literal.nil?

    literal.scan(/"([A-Z0-9_]+)"/).flatten
  end
end
