# SUT: cd.yml opens only environment-bound credentials after trusted snapshot verification: the
# publish credentials, and the migrator's OIDC token, which only call-migrator mints and presents.
require "minitest/autorun"
require_relative "repository-yaml"

class CdCredentialsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RETIRED = %w[PULUMI_BACKEND_URL PULUMI_CONFIG_PASSPHRASE R2_ACCESS_KEY_ID
               R2_SECRET_ACCESS_KEY CLOUDFLARE_PULUMI_API_TOKEN].freeze
  RUNTIME = %w[MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
               GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET
               INGEST_SIGNING_KEY].freeze
  CALLER = "$/.github/actions/call-migrator"
  # Every step that reaches the migrator, in job order, and the client each runs through the action.
  MIGRATOR_CALLS = { "Preview the selected native migration graph" => "schema-preflight",
                     "Apply the selected migration chain" => "migrate-through-worker",
                     "Verify the promoted catalog schema" => "verify-catalog-schema",
                     "Read the migrator's schema view for the receipt" => "schema-preflight" }.freeze
  TARGETS = { "stage" => ["staging", "${{ vars.MIGRATOR_STAGING_URL }}"],
              "promote-production" => ["production", "${{ vars.MIGRATOR_PRODUCTION_URL }}"] }.freeze

  def setup
    @source = File.read(File.join(ROOT, ".github/workflows/cd.yml"))
    @cd = RepositoryYaml.parse(@source)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def action(job, prefix)
    found = steps(job).select { |step| step["uses"].to_s.start_with?("#{prefix}@") }
    assert_equal 1, found.length
    found.first.fetch("with")
  end

  def calls(job)
    steps(job).select { |step| step["uses"] == CALLER }
  end

  # The whole step, so a call carries no `if:` that could skip it, no `env:` that would reach
  # the action's steps, and no `id` through which a later step could address it.
  def test_each_migrator_call_names_its_own_environment_migrator_and_client
    TARGETS.each do |job, (environment, url)|
      assert_equal MIGRATOR_CALLS.keys, calls(job).map { |step| step["name"] }
      calls(job).each do |step|
        inputs = { "environment" => environment, "migrator-url" => url, "client" => MIGRATOR_CALLS.fetch(step["name"]) }
        assert_equal({ "name" => step["name"], "uses" => CALLER, "with" => inputs }, step, "#{job}: #{step['name']}")
      end
      assert_equal environment, @cd.dig("jobs", job, "environment")
    end
  end

  # The runner passes an empty value for an input a caller omits and only warns about one the
  # action does not declare, so the two files must agree on the names.
  def test_each_call_passes_exactly_the_inputs_the_action_declares
    declared = RepositoryYaml.load_file(File.join(ROOT, ".github/actions/call-migrator/action.yml")).fetch("inputs").keys
    TARGETS.each_key { |job| calls(job).each { |step| assert_equal declared.sort, step.fetch("with").keys.sort } }
  end

  # Only call-migrator mints the migrator's token and only its client step holds it, so no step
  # here mints, holds or exports one: not the recorder after the receipt read (#1695), whatever
  # its key would be called.
  def test_no_cd_step_mints_holds_or_exports_a_migrator_token
    refute_match(/github-script|getIDToken|MIGRATOR_OIDC_TOKEN|exportVariable|GITHUB_ENV|ACTIONS_ID_TOKEN_REQUEST/, @source)
  end

  def test_the_migrator_is_called_after_snapshot_verification_in_a_job_that_may_mint
    TARGETS.each_key do |job|
      verified = steps(job).index { |step| step["uses"] == "$/.github/actions/hydrate-release" }
      assert_operator steps(job).index(calls(job).first), :>, verified
      assert_equal "write", @cd.dig("jobs", job, "permissions", "id-token")
    end
    assert_equal TARGETS.keys, @cd.fetch("jobs").select { |_id, job| job.dig("permissions", "id-token") }.keys
  end

  def test_existing_personal_pulumi_token_exchange_remains_exact
    %w[stage promote-production].each do |job|
      auth = action(job, "pulumi/auth-actions")
      assert_equal "lifeodyssey", auth.fetch("organization")
      assert_equal "urn:pulumi:token-type:access_token:personal", auth.fetch("requested-token-type")
      assert_equal "user:lifeodyssey", auth.fetch("scope")
    end
  end

  def test_staging_exports_only_publish_and_front_door_credentials
    esc = action("stage", "pulumi/esc-action")
    assert_equal "lifeodyssey/animichi/staging", esc.fetch("environment")
    assert_equal %w[CLOUDFLARE_API_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET], esc.fetch("export-environment-variables").split(",")
    assert_equal ["lifeodyssey/staging"], steps("stage").map { |step| step.dig("with", "stack-name") }.compact.uniq
  end

  def test_production_principals_only_open_in_the_approved_job
    assert_equal "production", @cd.dig("jobs", "promote-production", "environment")
    esc = action("promote-production", "pulumi/esc-action")
    assert_equal "lifeodyssey/animichi/prod", esc.fetch("environment")
    assert_equal "CLOUDFLARE_API_TOKEN", esc.fetch("export-environment-variables")
    assert_equal ["lifeodyssey/prod"], steps("promote-production").map { |step| step.dig("with", "stack-name") }.compact.uniq
    refute_match(/CF_ACCESS_CLIENT_ID|CF_ACCESS_CLIENT_SECRET|pulumi\/auth-actions/, steps("select").to_s)
  end

  def test_access_credentials_stay_in_staging
    %w[CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET].each do |name|
      holders = @cd.fetch("jobs").select { |_id, job| job.to_s.include?(name) }.keys
      assert_equal ["stage"], holders
    end
    assert_includes steps("stage").to_s, "staging-smoke-check.sh"
    assert_includes File.read(File.join(ROOT, ".github/scripts/staging-smoke-check.sh")), "CF_ACCESS_CLIENT_ID"
  end

  # The Neon key opens every branch of the project, production's included, so it reaches exactly
  # one step: the staging rebuild reads it from the ESC step's own output (pulumi/esc-action sets
  # an output for every environment variable) instead of the job-wide export list above, and no
  # other step's process ever holds it.
  def test_neon_key_reaches_only_the_staging_rebuild
    holders = @cd.fetch("jobs").flat_map do |id, job|
      job.fetch("steps").select { |item| item.to_s.include?("NEON_API_KEY") }.map { |item| [id, item["name"]] }
    end
    assert_equal [["stage", "Rebuild a staging schema stranded on the Atlas chain"]], holders
    rebuild = steps("stage").find { |item| item["name"] == holders.first.last }
    assert_equal({ "NEON_API_KEY" => "${{ steps.esc.outputs.NEON_API_KEY }}" }, rebuild["env"])
    esc = steps("stage").find { |item| item["uses"].to_s.start_with?("pulumi/esc-action@") }
    assert_equal "esc", esc["id"]
  end

  # #1717: the release names no image, so the registry read `inspect-images.rb` performed
  # validated an empty set in both jobs. The pull login, the buildx setup and the proof step
  # left with it; the selected snapshot's verification is the gate that remains (cd-migrations).
  def test_cd_opens_no_registry_credential
    %w[stage promote-production].each do |job|
      job_steps = steps(job)
      assert_empty job_steps.map { |step| step["uses"].to_s }.grep(%r{\Adocker/setup-buildx-action@})
      refute_match(/registry-login\.sh|inspect-images\.rb/, job_steps.map { |step| step["run"].to_s }.join("\n"))
    end
  end

  def test_no_runtime_secret_upload_database_credential_or_retired_key
    assert_empty (RETIRED + RUNTIME).select { |key| @source.include?(key) }
    assert_empty @source.scan(/\b[A-Z][A-Z0-9_]*DATABASE[A-Z0-9_]*\b/).uniq
    refute_match(/secret bulk|secrets:/, @source)
  end
end
