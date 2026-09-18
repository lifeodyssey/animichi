# SUT: cd.yml opens only environment-bound publish credentials after trusted snapshot verification.
require "minitest/autorun"
require "psych"

class CdCredentialsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RETIRED = %w[PULUMI_BACKEND_URL PULUMI_CONFIG_PASSPHRASE R2_ACCESS_KEY_ID
               R2_SECRET_ACCESS_KEY CLOUDFLARE_PULUMI_API_TOKEN].freeze
  RUNTIME = %w[MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
               GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET].freeze

  def setup
    @source = File.read(File.join(ROOT, ".github/workflows/cd.yml"))
    @cd = Psych.safe_load(@source, aliases: true)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def action(job, prefix)
    found = steps(job).select { |step| step["uses"].to_s.start_with?("#{prefix}@") }
    assert_equal 1, found.length
    found.first.fetch("with")
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

  def test_no_runtime_secret_upload_database_credential_or_retired_key
    assert_empty (RETIRED + RUNTIME).select { |key| @source.include?(key) }
    assert_empty @source.scan(/\b[A-Z][A-Z0-9_]*DATABASE[A-Z0-9_]*\b/).uniq
    refute_match(/secret bulk|secrets:/, @source)
  end
end
