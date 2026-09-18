# SUT: the CD-only retirement helper deletes exactly the old edge container application,
# while `RuntimeContainer` still exists and before the deploy that removes it.
#
# Both entry points (`retire-edge-container.sh`, `retire-migrator-container.sh`) call one
# shared implementation, so the paged scan and its fail-closed rules — cursor bounds,
# malformed pages, duplicate exact names, idempotent absence, CD authority — are pinned
# once in `migrator-container-retirement.test.rb`. This file owns what is the edge's:
# its two wrangler-derived application names, its sealed config's deletion contract and
# the fact that the retirement is a real delete rather than a message.
# frozen_string_literal: true
require 'json'
require 'fileutils'
require 'minitest/autorun'
require 'open3'
require 'tmpdir'
class EdgeContainerRetirementTest < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../../..', __dir__))
  SCRIPT = File.join(ROOT, 'scripts/delivery/retire-edge-container.sh')
  CURL_FIXTURE = File.join(__dir__, 'fixtures/release/container-applications-curl.sh')
  # Wrangler resolves an environment-ring application name as
  # `<script name>-<class name lowercased>-<environment>`: `animichi-staging` →
  # `animichi-staging-runtimecontainer-staging`, and `[env.production] name = "animichi"`
  # → `animichi-runtimecontainer-production` (read through `unstable_readConfig`).
  STAGING = 'animichi-staging-runtimecontainer-staging'
  PRODUCTION = 'animichi-runtimecontainer-production'
  def setup
    @root = Dir.mktmpdir
    @config, @pages, @requests = %w[wrangler.json pages requests].map { |name| File.join(@root, name) }
    FileUtils.mkdir_p(@pages)
    write_config
    write_page('root', [])
    install_command('pnpm', pnpm_fixture)
    install_command('curl', File.read(CURL_FIXTURE))
    @environment = fixture_environment
  end
  def fixture_environment
    authority.merge(
      'PATH' => "#{@root}:#{ENV.fetch('PATH')}",
      'FIXTURE_PAGES' => @pages,
      'REQUESTS' => @requests,
      'CLOUDFLARE_ACCOUNT_ID' => 'a' * 32,
      'CLOUDFLARE_API_TOKEN' => 'fixture-token',
    )
  end
  def install_command(name, source)
    File.write(File.join(@root, name), source)
    File.chmod(0o755, File.join(@root, name))
  end
  def teardown
    FileUtils.remove_entry(@root)
  end
  def authority
    { 'GITHUB_ACTIONS' => 'true', 'GITHUB_REPOSITORY' => 'lifeodyssey/animichi',
      'GITHUB_REF' => 'refs/heads/main',
      'GITHUB_WORKFLOW_REF' => 'lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main' }
  end
  def write_config(containers = [], migrations = [{ 'tag' => 'v6', 'deleted_classes' => ['RuntimeContainer'] }])
    ring = { 'containers' => containers, 'migrations' => migrations }
    File.write(@config, { 'containers' => [], 'migrations' => migrations,
                          'env' => { 'staging' => ring, 'production' => ring } }.to_json)
  end
  def applications(*names)
    names.map.with_index do |name, index|
      { 'id' => format('22222222-2222-4222-8222-%012d', index + 1), 'name' => name }
    end
  end
  def write_page(cursor, entries, next_cursor = nil)
    info = next_cursor.nil? ? {} : { 'next_page_token' => next_cursor }
    body = { 'success' => true, 'result' => entries, 'result_info' => info, 'errors' => [] }
    File.write(File.join(@pages, "#{cursor}.json"), body.to_json)
    FileUtils.rm_f(File.join(@pages, "#{cursor}.seen"))
  end
  def invoke(environment = 'staging')
    Open3.capture3(@environment, 'bash', SCRIPT, environment, @config, chdir: @root)
  end
  def requests
    File.exist?(@requests) ? File.readlines(@requests, chomp: true) : []
  end
  def deletes
    requests.select { |request| request.start_with?('exec wrangler containers delete ') }
  end
  def pnpm_fixture
    <<~'SH'
      #!/usr/bin/env bash
      set -euo pipefail
      printf '%s\n' "$*" >> "$REQUESTS"
      case "$*" in
        "exec wrangler containers delete "*)
          [ "${DELETE_EXIT:-0}" = 0 ] || exit "$DELETE_EXIT"
          ;;
        *) exit 64 ;;
      esac
    SH
  end
  def test_staging_deletes_only_the_exact_retired_application
    write_page('root', applications(PRODUCTION, 'animichi-runtimecontainer', STAGING))
    _output, error, status = invoke
    assert status.success?, error
    assert_equal ['exec wrangler containers delete 22222222-2222-4222-8222-000000000003'], deletes
  end
  def test_production_uses_the_name_wrangler_derives_for_that_ring
    write_page('root', applications(STAGING, PRODUCTION))
    _output, error, status = invoke('production')
    assert status.success?, error
    assert_equal ['exec wrangler containers delete 22222222-2222-4222-8222-000000000002'], deletes
  end
  def test_every_ring_still_owning_the_container_skips_the_retirement
    write_config([{ 'class_name' => 'RuntimeContainer', 'image' => 'image@sha256:deadbeef' }])
    _output, error, status = invoke
    assert status.success?, error
    assert_empty requests
  end
  # The selected config can declare no container and still instruct nothing: without the
  # `deleted_classes` tag no application is stranded by the deploy, so no listing is made.
  def test_a_config_that_does_not_retire_the_class_skips_the_retirement
    write_config([], [{ 'tag' => 'v6' }])
    _output, error, status = invoke
    assert status.success?, error
    assert_empty requests
  end
  def test_exhaustive_absence_is_an_idempotent_success_before_any_publication
    write_page('root', applications('unrelated'), 'page-2')
    write_page('page-2', applications('also-unrelated'))
    _output, error, status = invoke
    assert status.success?, error
    assert_equal 2, requests.length
    assert_empty deletes
  end
  def test_duplicate_named_applications_fail_closed
    write_page('root', applications(STAGING, STAGING))
    _output, _error, status = invoke
    refute status.success?
    assert_empty deletes
  end
  def test_delete_failure_stops_the_retirement
    write_page('root', applications(STAGING))
    @environment['DELETE_EXIT'] = '43'
    _output, _error, status = invoke
    refute status.success?
    assert_equal 1, deletes.length
    assert_includes requests.first, '/containers/dash/applications'
  end
  def test_untrusted_controller_fails_before_cloudflare_access
    @environment['GITHUB_REF'] = 'refs/heads/feature'
    _output, _error, status = invoke
    refute status.success?
    assert_empty requests
  end
end
