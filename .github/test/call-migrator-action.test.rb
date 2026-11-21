# SUT: call-migrator/action.yml is the one place CD mints the migrator's OIDC token. It waits,
# holding no token, until the migrator serves the selected bundle, mints with the official toolkit,
# and hands the token to one step that runs the controller script the caller names.
require "minitest/autorun"
require_relative "repository-yaml"

class CallMigratorActionTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  ACTION = File.join(ROOT, ".github/actions/call-migrator/action.yml")
  SURFACES = Dir.glob(File.join(ROOT, ".github/{workflows,actions}/**/*.{yml,yaml}")).sort
  # The identity waited for is the one every client names: migrator-bundle.sh reads it for both.
  WAIT = <<~BASH
    source scripts/delivery/migrator-bundle.sh
    prisma_ref="$(selected_prisma_ref)"
    await_migrator_bundle "$prisma_ref" || { echo '::error::selected migration executor is unavailable'; exit 1; }
  BASH
  MINT = { "result-encoding" => "string", "script" => "return core.getIDToken('animichi:github-actions:migrator')" }.freeze
  # The clients a caller may name, each a script of the controller checkout and never of the
  # hydrated release/; any other name fails the step.
  CLIENT = <<~BASH
    case "$CLIENT" in
      schema-preflight)
        bash .github/scripts/release/schema-preflight.sh "$TARGET_ENVIRONMENT" ;;
      migrate-through-worker)
        bash scripts/delivery/migrate-through-worker.sh "$TARGET_ENVIRONMENT" ;;
      verify-catalog-schema)
        bash scripts/delivery/verify-catalog-schema.sh "$TARGET_ENVIRONMENT" ;;
      *)
        echo "::error::no migrator client named $CLIENT"; exit 1 ;;
    esac
  BASH

  def setup
    @source = File.read(ACTION)
    @action = RepositoryYaml.parse(@source)
    @steps = @action.dig("runs", "steps")
    @wait, @mint, @client = @steps
  end

  def test_waits_without_a_token_then_mints_then_runs_the_named_client
    assert_equal "composite", @action.dig("runs", "using")
    assert_equal 3, @steps.length
    assert_equal({ "MIGRATOR_URL" => "${{ inputs.migrator-url }}" }, @wait.fetch("env"))
    assert_equal [WAIT, "bash"], @wait.values_at("run", "shell")
    assert_match %r{\Aactions/github-script@}, @mint.fetch("uses")
    assert_equal [CLIENT, "bash"], @client.values_at("run", "shell")
  end

  def test_no_step_is_conditional_or_tolerated_when_it_fails
    @steps.each do |step|
      refute step.key?("if"), "#{step['name']} must always run"
      refute step.key?("continue-on-error"), "#{step['name']} must fail the action when it fails"
    end
  end

  def test_mints_for_the_migrator_audience_with_the_official_action_pinned_by_commit
    assert_match %r{\Aactions/github-script@[0-9a-f]{40}\z}, @mint.fetch("uses")
    assert_equal MINT, @mint.fetch("with")
    assert_match(/^ +uses: #{Regexp.escape(@mint.fetch('uses'))} # v\d+\.\d+\.\d+$/, @source)
  end

  # A minted token is a bearer credential at the migrator until it expires. The steps of a
  # composite share a steps context of their own and only declared outputs leave it, so the action
  # declares none, the client step alone reads the token, and nothing writes it anywhere.
  def test_the_token_reaches_the_client_step_alone_and_never_leaves_the_action
    refute @action.key?("outputs")
    assert_equal({ "CLIENT" => "${{ inputs.client }}", "TARGET_ENVIRONMENT" => "${{ inputs.environment }}",
                   "MIGRATOR_URL" => "${{ inputs.migrator-url }}",
                   "MIGRATOR_OIDC_TOKEN" => "${{ steps.#{@mint.fetch('id')}.outputs.result }}" }, @client.fetch("env"))
    assert_equal [@client], @steps.select { |step| step.to_s.include?("steps.#{@mint.fetch('id')}.") }
    refute_match(/GITHUB_ENV|GITHUB_OUTPUT|exportVariable|setOutput|set -x|xtrace/, @source)
  end

  # A `${{ }}` inside `run:` is spliced into the script before bash parses it (zizmor's
  # template-injection audit), so the inputs reach both scripts through `env:`.
  def test_inputs_reach_the_scripts_only_through_the_environment
    assert_equal %w[environment migrator-url client], @action.fetch("inputs").keys
    @steps.each { |step| refute_includes step["run"].to_s, "${{" }
  end

  def test_no_other_workflow_or_action_mints_an_oidc_token_by_hand
    minting = SURFACES.select { |path| File.read(path).match?(/github-script|getIDToken|ACTIONS_ID_TOKEN_REQUEST/) }
    assert_equal [ACTION], minting
  end
end
