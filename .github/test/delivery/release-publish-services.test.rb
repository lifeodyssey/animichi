# SUT: publish-services.sh invokes the native Wrangler CLI for every sealed service and rejects invalid inputs.
require "minitest/autorun"
require "tmpdir"
require "open3"
require "json"
require "fileutils"

class ReleasePublishServicesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../../..", __dir__))
  SCRIPT = File.join(ROOT, ".github/scripts/release/publish-services.sh")
  SHA = "b" * 40

  def setup
    @dir = Dir.mktmpdir("release-publish-")
    @calls = File.join(@dir, "calls.jsonl")
    File.write(File.join(@dir, "pnpm"), "#!/usr/bin/env ruby\nrequire 'json'\nFile.open(ENV.fetch('CALLS'), 'a') { |f| f.puts ARGV.to_json }\n")
    File.chmod(0o755, File.join(@dir, "pnpm"))
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def publish(environment, sha = SHA)
    env = { "PATH" => "#{@dir}:#{ENV.fetch('PATH')}", "CALLS" => @calls, "SOURCE_SHA" => sha }
    Open3.capture3(env, "bash", SCRIPT, environment)
  end

  def deploy_call(config, env)
    ["exec", "wrangler", "deploy", "--no-bundle", "--config", "release/#{config}/wrangler.json", "--env", env, "--tag", "sha-#{SHA}"]
  end

  def test_staging_publishes_every_sealed_service_with_the_selected_source_tag
    _out, error, status = publish("staging")
    assert status.success?, error
    # #1929: the api unit additionally deploys its own workers.dev mirror ring
    # from the same sealed config — `animichi-api-staging` on staging.
    expected = [
      deploy_call("catalog", "staging"),
      deploy_call("users", "staging"),
      deploy_call("api", "staging"),
      deploy_call("api", "api-staging"),
      deploy_call("web", "staging"),
    ]
    assert_equal expected, File.readlines(@calls).map { |line| JSON.parse(line) }
  end

  def test_production_publishes_the_api_mirror_ring_once_a_promotion_is_approved
    _out, error, status = publish("production")
    assert status.success?, error
    expected = [
      deploy_call("catalog", "production"),
      deploy_call("users", "production"),
      deploy_call("api", "production"),
      deploy_call("api", "api-production"),
      deploy_call("web", "production"),
    ]
    assert_equal expected, File.readlines(@calls).map { |line| JSON.parse(line) }
  end

  def test_unknown_environment_never_invokes_wrangler
    _out, _error, status = publish("preview")
    refute status.success?
    refute File.exist?(@calls)
  end

  def test_invalid_selected_sha_never_invokes_wrangler
    _out, _error, status = publish("production", "not-a-sha")
    refute status.success?
    refute File.exist?(@calls)
  end
end
