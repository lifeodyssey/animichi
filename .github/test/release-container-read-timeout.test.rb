# SUT: the receipt bounds every `wrangler containers info` read and retries one the cap kills.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

class ReleaseContainerReadTimeoutTest < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../..', __dir__))
  SCRIPT = File.join(ROOT, '.github/scripts/release/record-receipt.mjs')
  SOURCE = 'b' * 40
  HASH = 'c' * 64
  APPLICATION = '11111111-1111-4111-8111-111111111111'
  VERSION = '22222222-2222-4222-8222-222222222222'
  DEPLOYMENT = '33333333-3333-4333-8333-333333333333'
  # Three reads with two one-second waits is the poll's 2 s budget, so the
  # one-second read cap stays strictly below it. The stubbed answer arrives only
  # after three seconds of sleeping, so a read the cap does not kill would still
  # be the same converged digest — exactly the convergence this test forbids.
  ATTEMPTS = 3
  DELAY = 1
  READ_TIMEOUT = 1
  SLOW_ANSWER = 3

  def setup
    @dir = Dir.mktmpdir('release-container-read-')
    @image = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}"
    @calls = File.join(@dir, 'calls.log')
    write_release_fixtures
    write_wrangler_configs
    write_pnpm_stub
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def record
    environment = { 'PATH' => "#{@dir}:#{ENV.fetch('PATH')}", 'CONTAINER_ATTEMPTS' => ATTEMPTS.to_s,
                    'CONTAINER_RETRY_DELAY' => DELAY.to_s, 'CONTAINER_READ_TIMEOUT' => READ_TIMEOUT.to_s }
    Open3.capture3(environment, 'node', SCRIPT, 'staging', chdir: @dir)
  end

  def container_reads
    File.readlines(@calls).count { |line| line.include?('containers info') }
  end

  # #1683 review: one hung `containers info` must not stall the receipt until the
  # GitHub job timeout with no diagnostic, and the answer that arrives after the
  # cap must never be recorded as convergence: the read is killed, counted as one
  # failed attempt, retried, and finally reported with the cap in the message.
  def test_a_read_that_outlives_the_cap_is_retried_and_never_recorded_as_converged
    output, error, status = record
    refute status.success?
    assert_empty output
    refute File.exist?(File.join(@dir, 'receipt.json'))
    assert_includes error, "did not converge after #{ATTEMPTS} attempts"
    assert_includes error, "#{(ATTEMPTS - 1) * DELAY}s wait budget"
    assert_includes error, "did not answer within #{READ_TIMEOUT * 1000}ms"
    assert_equal ATTEMPTS, container_reads
  end

  def write_release_fixtures
    FileUtils.mkdir_p(File.join(@dir, 'release/migrator/bundle'))
    File.write(File.join(@dir, 'release/release.json'), { 'source_sha' => SOURCE, 'images' => images }.to_json)
    File.write(File.join(@dir, 'release/migrator/bundle/contract.json'), { 'storage' => { 'storageHash' => HASH } }.to_json)
    File.write(File.join(@dir, 'schema-preflight.json'), preflight.to_json)
    File.write(File.join(@dir, 'selection.json'), { 'artifact_id' => '7' }.to_json)
    payload('containers-list', [{ 'id' => APPLICATION, 'name' => 'agent-staging' }])
    payload('containers-info', { 'id' => APPLICATION, 'name' => 'agent-staging',
                                'configuration' => { 'image' => @image },
                                'durable_objects' => { 'namespace_id' => 'owned-namespace' } })
    payload('deployments', [{ 'id' => DEPLOYMENT, 'created_on' => '2026-09-16T00:00:00Z',
                              'versions' => [{ 'version_id' => VERSION, 'percentage' => 100 }] }])
    payload('version', { 'id' => VERSION, 'annotations' => { 'workers/tag' => "sha-#{SOURCE}" },
                         'resources' => { 'bindings' => [binding] } })
  end

  def images
    { 'agent' => @image, 'catalog' => 'catalog@digest', 'users' => 'users@digest',
      'web' => 'web@digest', 'migrator' => 'migrator@digest' }
  end

  def binding
    { 'type' => 'durable_object_namespace', 'class_name' => 'AgentContainer', 'namespace_id' => 'owned-namespace' }
  end

  def preflight
    { 'compatible' => true, 'expectedHead' => 'B', 'appliedHead' => 'B', 'pendingCount' => 0,
      'prisma' => { 'targetHash' => HASH, 'markerHash' => HASH, 'usedLiveMarker' => true, 'migrations' => [] } }
  end

  def write_wrangler_configs
    %w[catalog users web migrator].each { |unit| write_wrangler_config(unit, { 'name' => "#{unit}-staging" }) }
    container = { 'name' => 'agent-staging', 'class_name' => 'AgentContainer', 'image' => @image }
    write_wrangler_config('edge', { 'name' => 'edge-staging', 'containers' => [container] })
  end

  def write_wrangler_config(unit, staging)
    config = { 'name' => unit, 'main' => 'bundle/entry.js', 'compatibility_date' => '2026-01-01',
               'env' => { 'staging' => staging } }
    directory = File.join(@dir, "release/#{unit}")
    FileUtils.mkdir_p(directory)
    File.write(File.join(directory, 'wrangler.json'), config.to_json)
  end

  def payload(name, content = nil)
    path = File.join(@dir, "#{name}.json")
    File.write(path, content.to_json) if content
    path
  end

  def write_pnpm_stub
    File.write(File.join(@dir, 'pnpm'), pnpm_stub)
    File.chmod(0o755, File.join(@dir, 'pnpm'))
  end

  def pnpm_stub
    <<~SH
      #!/usr/bin/env bash
      set -euo pipefail
      printf '%s\\n' "$*" >> '#{@calls}'
      case "$3 $4" in
        'containers list') cat '#{payload('containers-list')}' ;;
        'containers info') sleep #{SLOW_ANSWER}; cat '#{payload('containers-info')}' ;;
        'deployments list') cat '#{payload('deployments')}' ;;
        'versions view') cat '#{payload('version')}' ;;
        *) echo "unexpected stub call: $*" >&2; exit 2 ;;
      esac
    SH
  end
end
