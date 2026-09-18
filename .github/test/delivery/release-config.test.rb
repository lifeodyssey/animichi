# SUT: .github/lib/release/config.mjs — native Wrangler configuration sealing
# preserves bindings, and a unit whose source declares no [[containers]] block
# stays container-free in every ring.
# frozen_string_literal: true
require 'minitest/autorun'
require 'open3'
require 'json'

class ReleaseConfigTest < Minitest::Test
  def seal(unit, reference = '')
    output, error, status = seal_status(unit, reference)
    assert status.success?, error
    JSON.parse(output)
  end

  # The injectable `original` is the same seam `build-worker.mjs` and `verify-config.mjs`
  # use; it lets a case pin the image rule for a unit whose source still declares a
  # container, which no committed unit does any more.
  def seal_status(unit, reference, original = nil)
    script = File.expand_path('../../lib/release/config.mjs', __dir__)
    call = 'sealedConfig(process.argv[1], process.argv[2]'
    call += ', JSON.parse(process.argv[3])' unless original.nil?
    call += ')'
    source = "import {sealedConfig} from #{script.to_json}; console.log(JSON.stringify(#{call}))"
    arguments = [unit, reference, *[original&.to_json].compact]
    Open3.capture3('node', '--input-type=module', '-e', source, *arguments)
  end

  def test_migrator_keeps_no_container_in_any_ring
    config = seal('migrator')
    assert_equal 'bundle/index.js', config.fetch('main')
    assert_empty config.fetch('containers', [])
    assert_empty config.dig('env', 'staging').fetch('containers', [])
    assert_empty config.dig('env', 'production').fetch('containers', [])
    refute config.key?('build')
    assert_equal true, config['no_bundle']
    assert_equal true, config['find_additional_modules']
    assert_equal true, config['preserve_file_names']
    assert_equal 'bundle', config['base_dir']
    assert config.fetch('rules').any? { |rule| rule['type'] == 'Text' && rule['globs'].include?('migrations/**/*') }
  end

  # #1605 deleted the edge's container and #1606 its image: the sealed ring carries no
  # [[containers]] block, so there is no image reference to seal — and an image the unit
  # cannot carry is refused rather than silently dropped.
  def test_edge_seals_container_free_and_refuses_an_image_it_cannot_carry
    config = seal('edge')
    assert_equal 'bundle/entry.js', config.fetch('main')
    refute config.key?('containers')
    refute config.dig('env', 'staging').key?('containers')
    refute config.dig('env', 'production').key?('containers')
    _output, error, status = seal_status('edge', "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}")
    refute status.success?
    assert_includes error, 'edge declares no container'
  end

  def test_a_unit_that_still_declares_a_container_needs_an_immutable_digest
    digest = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}"
    original = { 'name' => 'animichi', 'main' => 'src/entry.ts',
                 'env' => { 'staging' => { 'containers' => [{ 'class_name' => 'RuntimeContainer' }] } } }
    _output, error, status = seal_status('edge', 'animichi-runtimecontainer:build-1', original)
    refute status.success?
    assert_includes error, 'immutable container image required'
    output, error, status = seal_status('edge', digest, original)
    assert status.success?, error
    assert_equal digest, JSON.parse(output).dig('env', 'staging', 'containers', 0, 'image')
  end

  def test_catalog_keeps_native_environment_bindings
    config = seal('catalog')
    assert_equal 'catalog-staging', config.dig('env', 'staging', 'name')
    assert_equal 'catalog', config.dig('env', 'production', 'name')
    assert_equal 'bundle/index.js', config.fetch('main')
  end

  def test_web_keeps_sealed_assets_and_runtime_configuration
    config = seal('web')
    assert_equal '.output/server/index.mjs', config.fetch('main')
    assert_equal '.output/public', config.dig('assets', 'directory')
    assert_equal 'animichi-web-staging', config.dig('env', 'staging', 'name')
    assert config.dig('env', 'production', 'vars', 'RUNTIME_CONFIG')
  end
end
