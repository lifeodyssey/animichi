# SUT: record-receipt.mjs writes the receipt CD verifies: every `wrangler containers info` read
# is bounded and retried, and a new snapshot records the edge without a container application.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

class ReleaseReceiptRecordTest < Minitest::Test
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
  # The read cap must stay below the wait budget ((attempts - 1) x retry delay), so a read
  # allowed to answer the stubbed 3 s sleep needs a budget wider than the sleep.
  CONVERGING_ATTEMPTS = 6

  def setup
    @dir = Dir.mktmpdir('release-container-read-')
    @image = "registry.cloudflare.com/#{'a' * 32}/animichi-migrator@sha256:#{'d' * 64}"
    @calls = File.join(@dir, 'calls.log')
    write_release_fixtures
    write_wrangler_configs
    write_pnpm_stub
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def record(attempts: ATTEMPTS, read_timeout: READ_TIMEOUT)
    environment = { 'PATH' => "#{@dir}:#{ENV.fetch('PATH')}", 'CONTAINER_ATTEMPTS' => attempts.to_s,
                    'CONTAINER_RETRY_DELAY' => DELAY.to_s, 'CONTAINER_READ_TIMEOUT' => read_timeout.to_s }
    Open3.capture3(environment, 'node', SCRIPT, 'staging', chdir: @dir)
  end

  def container_reads
    File.readlines(@calls).count { |line| line.include?('containers info') }
  end

  # #1683 review: one hung `containers info` must not stall the receipt until the
  # GitHub job timeout with no diagnostic, and the answer that arrives after the
  # cap must never be recorded as convergence: the read is killed, counted as one
  # failed attempt, retried, and finally reported with the cap in the message.
  # #1606: the edge names no image, so its receipt entry carries no container observation;
  # the migrator fixture below still declares one, a shape no selectable snapshot can name.
  # Reinstating the edge container expectation makes `ReleaseReceipt.validate` refuse this
  # receipt (release-receipt.test.rb pins that, and the mutation record shows it).
  # #1606 removed the agent image from the snapshot, so a deployment that still reports an
  # edge container has no selected image identity to be observed against. The receipt must
  # say so instead of polling an expectation the snapshot never stated.
  def test_an_edge_container_the_snapshot_does_not_name_fails_closed
    container = { 'name' => 'agent-staging', 'class_name' => 'AgentContainer', 'image' => @image }
    write_wrangler_config('edge', { 'name' => 'edge-staging', 'containers' => [container] })
    _output, error, status = record(attempts: CONVERGING_ATTEMPTS, read_timeout: SLOW_ANSWER + 1)
    refute status.success?
    refute File.exist?(File.join(@dir, 'receipt.json'))
    assert_includes error, 'edge-staging declares a container the selected snapshot names no image for'
  end

  def test_a_new_snapshot_records_no_container_application_for_the_edge
    _output, error, status = record(attempts: CONVERGING_ATTEMPTS, read_timeout: SLOW_ANSWER + 1)
    assert status.success?, error
    workers = JSON.parse(File.read(File.join(@dir, 'receipt.json'))).fetch('workers')
    assert_empty workers.find { |worker| worker['unit'] == 'edge' }.fetch('containers')
    assert_equal ['migration-staging'],
                 workers.find { |worker| worker['unit'] == 'migrator' }.fetch('containers').map { |item| item['name'] }
  end

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
    payload('containers-list', [{ 'id' => APPLICATION, 'name' => 'migration-staging' }])
    payload('containers-info', { 'id' => APPLICATION, 'name' => 'migration-staging',
                                'configuration' => { 'image' => @image },
                                'durable_objects' => { 'namespace_id' => 'owned-namespace' } })
    payload('deployments', [{ 'id' => DEPLOYMENT, 'created_on' => '2026-09-16T00:00:00Z',
                              'versions' => [{ 'version_id' => VERSION, 'percentage' => 100 }] }])
    payload('version', { 'id' => VERSION, 'annotations' => { 'workers/tag' => "sha-#{SOURCE}" },
                         'resources' => { 'bindings' => [binding] } })
  end

  # No selectable snapshot may name an image (#1605/#1606 retired the migrator container),
  # so this fixture supplies the migrator image itself to exercise the record's shape.
  def images
    { 'migrator' => @image }
  end

  def binding
    { 'type' => 'durable_object_namespace', 'class_name' => 'MigrationContainer', 'namespace_id' => 'owned-namespace' }
  end

  def preflight
    { 'compatible' => true,
      'prisma' => { 'targetHash' => HASH, 'markerHash' => HASH, 'usedLiveMarker' => true, 'migrations' => [] } }
  end

  def write_wrangler_configs
    %w[catalog users web].each { |unit| write_wrangler_config(unit, { 'name' => "#{unit}-staging" }) }
    write_wrangler_config('edge', { 'name' => 'edge-staging' })
    container = { 'name' => 'migration-staging', 'class_name' => 'MigrationContainer', 'image' => @image }
    write_wrangler_config('migrator', { 'name' => 'migrator-staging', 'containers' => [container] })
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
