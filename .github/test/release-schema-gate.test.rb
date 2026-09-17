# SUT: schema-preflight.sh fails closed on unavailable or incompatible migration ledgers.
# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require 'json'
require 'open3'

class ReleaseSchemaGateTest < Minitest::Test
  def setup
    @directory = Dir.mktmpdir
    FileUtils.mkdir_p(File.join(@directory, 'release/migrations'))
    File.write(File.join(@directory, 'curl'), curl_fixture)
    File.chmod(0o755, File.join(@directory, 'curl'))
    @body = { 'compatible' => true }
    bundle = File.join(@directory, 'release/migrator/bundle')
    FileUtils.mkdir_p(bundle)
    File.write(File.join(bundle, 'contract.json'), { 'storage' => { 'storageHash' => 'b' * 64 } }.to_json)
    @body['prisma'] = { 'targetHash' => 'b' * 64, 'markerHash' => 'empty',
                        'migrations' => [{ 'spaceId' => 'app', 'from' => 'empty', 'to' => 'b' * 64 }], 'usedLiveMarker' => true }
    @served = { 'prismaTarget' => 'b' * 64 }
    @environment = request_environment
  end

  def request_environment
    { 'PATH' => "#{@directory}:#{ENV.fetch('PATH')}", 'MIGRATOR_URL' => 'https://migrator.example.invalid',
                     'ACTIONS_ID_TOKEN_REQUEST_TOKEN' => 'test-request-token', 'ACTIONS_ID_TOKEN_REQUEST_URL' => 'https://oidc.example.invalid?request=1',
                     'PROBE_STATUS' => '200', 'BUNDLE_POLL_ATTEMPTS' => '2', 'BUNDLE_POLL_SECONDS' => '0', 'STALE_BUNDLE_ATTEMPTS' => '2' }
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def curl_fixture
    <<~'SH'
      #!/usr/bin/env bash
      set -euo pipefail
      case "${@: -1}" in
        https://oidc.example.invalid*) printf '{"value":"test-oidc-token"}' ;;
        https://migrator.example.invalid/healthz) cat served.json ;;
        https://migrator.example.invalid/preflight)
          count="$(cat post-count 2>/dev/null || printf '0')"
          printf '%s' "$((count + 1))" > post-count
          code="$(awk -v i="$count" '{print (i + 1 <= NF) ? $(i + 1) : $NF}' <<< "$PROBE_STATUS")"
          cp response.json schema-preflight.json
          [ "$code" != 409 ] || printf '{"error":"stale_prisma_bundle"}' > schema-preflight.json
          printf '%s' "$code" ;;
        *) exit 1 ;;
      esac
    SH
  end

  def preflight
    File.write(File.join(@directory, 'response.json'), @body.to_json)
    File.write(File.join(@directory, 'served.json'), @served.to_json)
    script = File.expand_path('../scripts/release/schema-preflight.sh', __dir__)
    Open3.capture3(@environment, 'bash', script, 'staging', chdir: @directory)
  end

  # One authority, one identity (#1634, #1635): the request carries the selected schema identity
  # and nothing the receiver would have to ignore.
  def test_sends_only_verified_identity_metadata_to_existing_endpoint
    output, error, status = preflight
    assert status.success?, error
    request = JSON.parse(File.read(File.join(@directory, 'preflight-request.json')))
    assert_equal %w[expectedPrismaRef], request.keys.sort
    refute_includes output + error, 'test-oidc-token'
  end

  def test_native_preflight_binds_the_selected_prisma_contract
    _output, error, status = preflight
    assert status.success?, error
    request = JSON.parse(File.read(File.join(@directory, 'preflight-request.json')))
    assert_equal 'b' * 64, request['expectedPrismaRef']
  end

  def test_native_preflight_reads_the_real_generated_contract
    source = File.expand_path('../../packages/pi-session-neon/src/contract.json', __dir__)
    FileUtils.cp(source, File.join(@directory, 'release/migrator/bundle/contract.json'))
    target = JSON.parse(File.read(source)).fetch('storage').fetch('storageHash')
    @served['prismaTarget'] = target
    @body['prisma'] = { 'targetHash' => target, 'markerHash' => target, 'migrations' => [], 'usedLiveMarker' => true }
    _output, error, status = preflight
    assert status.success?, error
    assert_equal target, JSON.parse(File.read(File.join(@directory, 'preflight-request.json')))['expectedPrismaRef']
  end

  def test_a_migrator_serving_another_identity_cannot_pass_preflight
    @served['prismaTarget'] = 'c' * 64
    refute preflight.last.success?
    refute File.exist?(File.join(@directory, 'schema-preflight.json'))
  end

  def test_native_target_substitution_is_refused
    @body['prisma']['targetHash'] = 'c' * 64
    refute preflight.last.success?
  end

  def test_preview_without_live_marker_evidence_is_refused
    @body['prisma']['usedLiveMarker'] = false
    refute preflight.last.success?
  end

  def test_empty_path_without_matching_installed_marker_is_refused
    @body['prisma']['migrations'] = []
    refute preflight.last.success?
  end

  def test_native_replay_with_matching_marker_and_empty_path_is_allowed
    @body['prisma']['markerHash'] = 'b' * 64
    @body['prisma']['migrations'] = []
    assert preflight.last.success?
  end

  def test_missing_contract_refuses_before_identity_acquisition
    File.unlink(File.join(@directory, 'release/migrator/bundle/contract.json'))
    refute preflight.last.success?
    refute File.exist?(File.join(@directory, 'preflight-request.json'))
  end

  def test_native_preflight_rechecks_after_a_rollout_race
    @environment['PROBE_STATUS'] = '409 200'
    assert preflight.last.success?
    assert_equal '2', File.read(File.join(@directory, 'post-count'))
  end

  def test_schema_refusal_is_not_retried_as_a_rollout
    @environment['PROBE_STATUS'] = '422 200'
    refute preflight.last.success?
    assert_equal '1', File.read(File.join(@directory, 'post-count'))
  end

  def test_missing_bootstrap_route_is_not_success
    @environment['PROBE_STATUS'] = '404'
    refute preflight.last.success?
  end

  def test_schema_refusal_is_not_success
    @environment['PROBE_STATUS'] = '422'
    refute preflight.last.success?
  end

  def test_unavailable_ledger_is_not_success
    @environment['PROBE_STATUS'] = '503'
    refute preflight.last.success?
  end

  def test_an_incompatible_verdict_is_not_success
    @body['compatible'] = false
    refute preflight.last.success?
  end

  def test_a_missing_native_preview_is_not_compatible_evidence
    @body.delete('prisma')
    refute preflight.last.success?
  end

  def test_a_marker_that_is_neither_empty_nor_a_contract_hash_is_refused
    @body['prisma']['markerHash'] = 'not-a-hash'
    refute preflight.last.success?
  end

  def test_http_endpoint_refuses_before_request_body_or_identity
    @environment['MIGRATOR_URL'] = 'http://migrator.example.invalid'
    refute preflight.last.success?
    refute File.exist?(File.join(@directory, 'preflight-request.json'))
  end
end
