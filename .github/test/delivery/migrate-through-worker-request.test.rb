# SUT: scripts/delivery/migrate-through-worker.sh — the shipped migration controller
# forwards the selected artifact's complete metadata, under the token its step was handed.
require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "json"
require "open3"

class ReleaseMigrationRequestTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../../..", __dir__))
  REF = "b" * 64
  # What the call-migrator action's mint step hands the apply as MIGRATOR_OIDC_TOKEN.
  TOKEN = "fixture-handed-token"

  def setup
    @directory = Dir.mktmpdir("selected-migration-")
    FileUtils.mkdir_p(File.join(@directory, "bin"))
    FileUtils.cp(File.join(ROOT, ".github/test/delivery/fixtures/migration-curl.rb"), File.join(@directory, "bin/curl"))
    FileUtils.chmod(0755, File.join(@directory, "bin/curl"))
    File.write(File.join(@directory, 'contract.json'), { 'storage' => { 'storageHash' => REF } }.to_json)
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def invoke(overrides = {})
    environment = { "PATH" => "#{@directory}/bin:#{ENV.fetch('PATH')}", "MIGRATOR_URL" => "https://fixture.invalid",
      "RUNNER_TEMP" => @directory, "MIGRATOR_OIDC_TOKEN" => TOKEN, "SEALED_REF" => REF,
      "POST_BODY" => File.join(@directory, "body.json"), "CALL_LOG" => File.join(@directory, "calls"),
      "BUNDLE_POLL_SECONDS" => "0", "STALE_BUNDLE_ATTEMPTS" => "2" }
    Open3.capture3(environment.merge(overrides), "bash", File.join(ROOT, "scripts/delivery/migrate-through-worker.sh"), "staging",
                   File.join(@directory, 'contract.json'))
  end

  def migration_count
    File.readlines(File.join(@directory, "calls")).count { |line| line.include?("/migrate") }
  end

  { "schema_refusal" => '{"error":"incompatible_schema"}', "unknown_conflict" => '{"error":"unknown"}',
    "malformed_conflict" => 'not-json', "success_shaped_conflict" => '{"success":true}',
    "non_object_conflict" => '[]' }.each do |name, body|
    define_method("test_#{name}_stops_after_one_apply_request") do
      _output, _error, status = invoke("MIGRATION_CODES" => "409 200", "MIGRATION_CONFLICT" => body)
      refute status.success?
      assert_equal 1, migration_count
    end
  end

  def test_explicit_stale_prisma_bundle_rechecks_the_bundle_and_retries
    output, error, status = invoke("MIGRATION_CODES" => "409 200", "MIGRATION_CONFLICT" => { "error" => "stale_prisma_bundle" }.to_json)
    assert status.success?, output + error
    assert_equal 2, migration_count
    assert_equal 2, File.readlines(File.join(@directory, "calls")).count { |line| line.include?("/healthz") }
  end

  # The retired Atlas code is no longer a retryable conflict: it must stop after one apply.
  def test_retired_stale_bundle_code_stops_after_one_apply_request
    _output, _error, status = invoke("MIGRATION_CODES" => "409 200", "MIGRATION_CONFLICT" => { "error" => "stale_bundle" }.to_json)
    refute status.success?
    assert_equal 1, migration_count
  end

  def test_forwards_the_selected_native_contract_without_reading_latest
    _output, error, status = invoke
    assert status.success?, error
    assert_equal REF, JSON.parse(File.read(File.join(@directory, 'body.json')))['expectedPrismaRef']
  end

  # One authority, one identity (#1634, #1635): the request body carries the schema identity and
  # nothing else — an extra key is an invalid request at the receiver, which is exactly why the
  # two sides could only change together.
  def test_forwards_exactly_the_selected_identity
    output, error, status = invoke
    assert status.success?, "#{output}\n#{error}"
    assert_equal({ "expectedPrismaRef" => REF }, JSON.parse(File.read(File.join(@directory, "body.json"))))
  end

  def test_missing_contract_stops_before_any_request
    File.write(File.join(@directory, "contract.json"), "{}")
    _output, _error, status = invoke
    refute status.success?
    refute File.exist?(File.join(@directory, "calls"))
  end

  # Every apply request, the stale-bundle retry included, carries the token the call-migrator
  # action's mint step handed it, and nothing the controller prints carries it.
  def test_every_apply_request_carries_the_token_its_step_was_handed
    output, error, status = invoke("MIGRATION_CODES" => "409 200")
    assert status.success?, output + error
    applies = File.readlines(File.join(@directory, "calls"), chomp: true).grep(%r{/migrate})
    assert_equal 2, applies.length
    applies.each { |line| assert_includes line, "Authorization: Bearer #{TOKEN} " }
    refute_includes output + error, TOKEN
  end

  # A step handed no token (no mint step before it, or an expression naming another step, which
  # evaluates to '') stops before any request, in one line, rather than send an empty bearer.
  { "unset" => nil, "empty" => "" }.each do |name, value|
    define_method("test_a_step_handed_an_#{name}_token_stops_before_any_request") do
      output, error, status = invoke("MIGRATOR_OIDC_TOKEN" => value)
      refute status.success?
      assert_equal "::error title=migration::MIGRATOR_OIDC_TOKEN is required for staging\n", output + error
      refute File.exist?(File.join(@directory, "calls"))
    end
  end
end
