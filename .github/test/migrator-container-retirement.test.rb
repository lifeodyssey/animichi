# SUT: the CD-only retirement helper deletes exactly the old migrator application.
# frozen_string_literal: true
require 'json'
require 'fileutils'
require 'minitest/autorun'
require 'open3'
require 'tmpdir'
class MigratorContainerRetirementTest < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../..', __dir__))
  SCRIPT = File.join(ROOT, 'scripts/delivery/retire-migrator-container.sh')
  CURL_FIXTURE = File.join(__dir__, 'fixtures/release/container-applications-curl.sh')
  STAGING = 'migrator-staging-migrationcontainer-staging'
  PRODUCTION = 'migrator-production-migrationcontainer-production'
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
  def write_config(containers = [])
    ring = { 'containers' => containers,
             'migrations' => [{ 'tag' => 'v3-retire-migration-container',
                                'deleted_classes' => ['MigrationContainer'] }] }
    File.write(@config, { 'containers' => [], 'migrations' => ring['migrations'],
                          'env' => { 'staging' => ring, 'production' => ring } }.to_json)
  end
  def applications(*names)
    names.map.with_index do |name, index|
      { 'id' => format('11111111-1111-4111-8111-%012d', index + 1), 'name' => name }
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
    write_page('root', applications(STAGING, PRODUCTION, 'animichi-agent-staging'))
    _output, error, status = invoke
    assert status.success?, error
    assert_includes requests.first, '/containers/dash/applications'
    assert_includes requests.first, 'Authorization: Bearer fixture-token'
    assert_equal 'exec wrangler containers delete 11111111-1111-4111-8111-000000000001', requests.last
  end
  def test_deletes_the_exact_target_when_it_is_not_on_the_first_page
    write_page('root', applications('unrelated'), 'page-2')
    write_page('page-2', applications(STAGING))
    _output, error, status = invoke
    assert status.success?, error
    assert_includes requests[1], 'page_token=page-2'
    assert_equal 'exec wrangler containers delete 11111111-1111-4111-8111-000000000001', requests.last
  end
  def test_later_page_error_is_not_treated_as_absence
    write_page('root', applications('unrelated'), 'page-2')
    File.write(File.join(@pages, 'page-2.exit'), '42')
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_duplicate_exact_names_across_pages_fail_closed
    write_page('root', applications(STAGING), 'page-2')
    write_page('page-2', applications(STAGING))
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_repeated_cursor_fails_closed
    write_page('root', applications('unrelated'), 'repeat')
    write_page('repeat', applications('also-unrelated'), 'repeat')
    write_page('repeat-repeat', [])
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_invalid_cursor_fails_closed
    write_page('root', applications('unrelated'), false)
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_unique_cursor_scan_is_bounded
    write_page('root', [], 'page-1')
    (1...40).each { |index| write_page("page-#{index}", [], "page-#{index + 1}") }
    _output, _error, status = invoke
    refute status.success?
    assert_equal 40, requests.length
  end
  def test_production_uses_the_production_application_name
    write_page('root', applications(PRODUCTION))
    _output, error, status = invoke('production')
    assert status.success?, error
    assert_equal 'exec wrangler containers delete 11111111-1111-4111-8111-000000000001', requests.last
  end
  def test_exhaustive_absence_is_an_idempotent_success
    write_page('root', applications('unrelated'), 'page-2')
    write_page('page-2', applications('also-unrelated'))
    _output, error, status = invoke
    assert status.success?, error
    assert_equal 2, requests.length
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_repeat_after_deletion_is_an_idempotent_success
    write_page('root', applications(STAGING))
    _output, first_error, first = invoke
    write_page('root', [])
    _output, second_error, second = invoke
    assert first.success?, first_error
    assert second.success?, second_error
    assert_equal 2, requests.count { |request| request.include?('/containers/dash/applications') }
    assert_equal 1, requests.count { |request| request.start_with?('exec wrangler containers delete ') }
  end
  def test_historical_container_snapshot_skips_retirement
    write_config([{ 'name' => STAGING, 'class_name' => 'MigrationContainer' }])
    _output, error, status = invoke
    assert status.success?, error
    assert_empty requests
  end
  def test_duplicate_named_applications_fail_closed
    write_page('root', applications(STAGING, STAGING))
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_api_failure_is_not_treated_as_genuine_absence
    File.write(File.join(@pages, 'root.exit'), '42')
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_malformed_api_response_fails_closed
    File.write(File.join(@pages, 'root.json'), '{"success":false,"result":[]}')
    _output, _error, status = invoke
    refute status.success?
    refute requests.any? { |request| request.include?('containers delete') }
  end
  def test_invalid_selected_config_fails_before_cloudflare_access
    File.write(@config, '{')
    _output, _error, status = invoke
    refute status.success?
    assert_empty requests
  end
  def test_delete_failure_stops_the_retirement
    write_page('root', applications(STAGING))
    @environment['DELETE_EXIT'] = '43'
    _output, _error, status = invoke
    refute status.success?
    assert_equal 2, requests.length
  end
  def test_untrusted_controller_fails_before_cloudflare_access
    @environment['GITHUB_REF'] = 'refs/heads/feature'
    _output, _error, status = invoke
    refute status.success?
    assert_empty requests
  end
end
