# SUT: .github/scripts/release/verify-config.mjs — CD's check, before any credential or
# deploy, that each selected unit's deployed wrangler.json is exactly what that unit's source
# at the snapshot's source commit seals into. The fixture commits the five real source
# configs, seals them as the release build does, and runs the real verifier, so the installed
# Wrangler reads the TOML sources and the comparison is CD's own strict one.
# frozen_string_literal: true
require 'minitest/autorun'
require 'open3'
require 'json'
require 'tmpdir'
require 'fileutils'

class VerifyConfigTest < Minitest::Test
  REPOSITORY = File.expand_path('../../..', __dir__)
  VERIFIER = File.join(REPOSITORY, '.github/scripts/release/verify-config.mjs')
  SOURCES = %w[workers/catalog/wrangler.toml workers/users/wrangler.toml workers/edge/wrangler.toml
               workers/migrator/wrangler.toml apps/web/wrangler.jsonc].freeze
  # The release build's own sealing: `build-worker.mjs` writes each Worker's file and
  # `release-build.yml` the web app's, both as `JSON.stringify(sealedConfig(unit, image), null, 2)`.
  SEAL = <<~JS
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { sealedConfig } from #{File.join(REPOSITORY, '.github/lib/release/config.mjs').to_json};
    for (const unit of ['catalog', 'users', 'edge', 'migrator', 'web']) {
      mkdirSync(`release/${unit}`, { recursive: true });
      writeFileSync(`release/${unit}/wrangler.json`, JSON.stringify(sealedConfig(unit, ''), null, 2));
    }
  JS

  def setup
    @root = Dir.mktmpdir
    source = commit_sources
    write('release/release.json', { 'source_sha' => source, 'images' => {} }.to_json)
    command('node', '--input-type=module', '-e', SEAL)
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def command(*arguments)
    out, err, status = Open3.capture3(*arguments, chdir: @root)
    raise err unless status.success?
    out.strip
  end

  def write(path, content)
    target = File.join(@root, path)
    FileUtils.mkdir_p(File.dirname(target))
    File.write(target, content)
  end

  def commit_sources
    SOURCES.each { |path| write(path, File.read(File.join(REPOSITORY, path))) }
    command('git', 'init', '--initial-branch=main')
    command('git', 'config', 'user.name', 'Release Test')
    command('git', 'config', 'user.email', 'release-test@example.invalid')
    command('git', 'add', '.')
    command('git', 'commit', '-m', 'source')
    command('git', 'rev-parse', 'HEAD')
  end

  def tamper(unit)
    path = File.join(@root, "release/#{unit}/wrangler.json")
    config = JSON.parse(File.read(path))
    yield config
    File.write(path, JSON.pretty_generate(config))
  end

  def verify
    Open3.capture3('node', VERIFIER, chdir: @root)
  end

  # Wrangler reads each TOML table as a null-prototype object, and the deployed file is plain
  # JSON: the snapshot matches its source in content, which is what CD must judge. Under
  # wrangler 4.165.0 CD refused all four TOML units here.
  def test_accepts_every_unit_sealed_from_its_own_source
    _output, error, status = verify
    assert status.success?, error
  end

  # A change made after sealing is refused, and the refusal names the unit that changed: the
  # migrator is read fourth, after three TOML units that have to pass for it to be reached.
  def test_refuses_a_var_changed_after_sealing_and_names_its_unit
    tamper('migrator') { |config| config.dig('env', 'staging', 'vars')['ENVIRONMENT'] = 'production' }
    _output, error, status = verify
    refute status.success?
    assert_includes error, 'migrator config is outside the selected source closure'
  end
end
