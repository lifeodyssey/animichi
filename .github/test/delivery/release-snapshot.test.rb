# SUT: .github/lib/release/snapshot.rb — snapshot validation requires every deploy
# unit and verifies every sealed byte.
# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require_relative '../../lib/release/snapshot'

class ReleaseSnapshotTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir
    ReleaseSnapshot::REQUIRED_FILES.each do |path|
      FileUtils.mkdir_p(File.dirname(File.join(@root, path)))
      File.write(File.join(@root, path), path)
    end
    FileUtils.mkdir_p(File.join(@root, 'web/.output/public'))
    File.write(File.join(@root, 'web/.output/public/app.js'), 'built B with catalog A')
    FileUtils.mkdir_p(File.join(@root, 'migrator/bundle/migrations/app/20260901000000_a'))
    File.write(File.join(@root, 'migrator/bundle/migrations/app/20260901000000_a/ops.json'), 'catalog A')
    @metadata = snapshot_metadata
  end

  # #1606: no release unit carries a container any more (#1589 the migrator, #1605 the
  # edge), so a new snapshot names no image at all.
  def snapshot_metadata
    { 'source_sha' => 'b' * 40, 'run_id' => '9', 'run_attempt' => '1',
                  'repository' => 'lifeodyssey/animichi', 'kind' => 'full-snapshot', 'format' => 1,
                  'images' => {} }
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def manifest
    @metadata.merge('files' => ReleaseSnapshot.hashes(@root))
  end

  def test_b_contains_cumulative_a_catalog_and_schema
    assert ReleaseSnapshot.validate(@root, manifest, @metadata)
    assert_equal 'catalog A', File.read(File.join(@root, 'migrator/bundle/migrations/app/20260901000000_a/ops.json'))
  end

  def test_refuses_missing_catalog_even_when_manifest_is_resealed
    File.delete(File.join(@root, 'catalog/bundle/index.js'))
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_missing_generated_provider
    File.delete(File.join(@root, 'foundation/infra/database-access/sdks/neon/bin/index.js'))
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_mutated_file_after_sealing
    sealed = manifest
    File.write(File.join(@root, 'web/.output/public/app.js'), 'substituted C')
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, sealed, @metadata) }
  end

  def test_refuses_source_substitution
    selection = @metadata.merge('source_sha' => 'c' * 40)
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, selection) }
  end

  # #1606: the agent image left the release with the edge container it belonged to, so a
  # snapshot that still names it is refused rather than deployed against a receipt shape
  # that no longer observes it.
  def test_refuses_the_retired_agent_image
    @metadata['images']['agent'] = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}"
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_accepts_a_snapshot_that_names_no_image
    assert ReleaseSnapshot.validate(@root, manifest, @metadata)
  end

  # #1606: no build has named a migrator image since that container was retired (#1589), so
  # the migrator key is refused like every other image rather than carried as a historical shape.
  def test_refuses_the_retired_migrator_image
    @metadata['images']['migrator'] = "registry.cloudflare.com/#{'a' * 32}/animichi-migrator@sha256:#{'e' * 64}"
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_an_unknown_image_unit
    @metadata['images']['unknown'] = "registry.cloudflare.com/#{'a' * 32}/animichi-unknown@sha256:#{'e' * 64}"
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_empty_public_output
    File.delete(File.join(@root, 'web/.output/public/app.js'))
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end
end
