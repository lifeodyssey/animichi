# SUT: test/repo-config/wrangler-workers-dev.test.rb. Every probe copies the contract and the two
# configs it reads into a throwaway tree, mutates the copy, and runs the copied contract; the
# committed files are never written to.
#
# The mutation is the whole declaration's removal — the exact hazard #1524 closed: a production
# block that "carries no explicit workers_dev" is precisely the state whose default (unset
# resolves to `routes.length === 0`, ON for a route-less block) the contract exists to forbid.
require "fileutils"
require "minitest/autorun"
require "open3"
require "tmpdir"

class WranglerWorkersDevMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/wrangler-workers-dev.test.rb"
  EDGE_TOML = "workers/edge/wrangler.toml"
  WEB_JSONC = "apps/web/wrangler.jsonc"

  def with_tree
    Dir.mktmpdir("wrangler-workers-dev-mutation-") do |root|
      [CONTRACT, EDGE_TOML, WEB_JSONC].each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def run_contract(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    [status, out + err]
  end

  def reject_tree(root, label, consequence)
    status, output = run_contract(root)
    refute status.success?, "mutation survived: #{label}"
    assert_includes output, consequence, "mutation must name its consequence: #{label}"
  end

  # Removes `needle` from the slice between the line-anchored `section_header`
  # and `end_header`, so the mutation cannot be satisfied by some other block's
  # identical key — nor by this file's own comments, which quote the section
  # names and the keys in prose. The headers are anchored with leading and
  # trailing newlines for exactly that reason.
  def rewrite_between(root, relative, section_header, end_header, needle, label)
    path = File.join(root, relative)
    source = File.read(path)
    head, rest = source.split(section_header, 2)
    refute_nil rest, "mutation marker missing: #{label}"
    slice, tail = rest.split(end_header, 2)
    changed = slice.sub(needle, "")
    refute_equal slice, changed, "mutation needle missing: #{label}"
    File.write(path, "#{head}#{section_header}#{changed}#{end_header}#{tail}")
  end

  # Same, for a marker with no terminator line (the JSONC production object
  # runs to end-of-file): the slice is everything after the marker.
  def rewrite_after(root, relative, marker, needle, label)
    path = File.join(root, relative)
    source = File.read(path)
    head, tail = source.split(marker, 2)
    refute_nil tail, "mutation marker missing: #{label}"
    changed = tail.sub(needle, "")
    refute_equal tail, changed, "mutation needle missing: #{label}"
    File.write(path, "#{head}#{marker}#{changed}")
  end

  def test_accepts_an_unmutated_copy
    with_tree do |root|
      status, output = run_contract(root)
      assert status.success?, "an unmutated copy must pass\n#{output}"
    end
  end

  def test_rejects_edge_production_workers_dev_deleted
    with_tree do |root|
      rewrite_between(root, EDGE_TOML, "\n[env.production]\n", "\n[env.staging]\n", "workers_dev = false\n",
                      "edge production workers_dev")
      reject_tree(root, "edge [env.production] workers_dev deleted", "workers_dev = false explicitly")
    end
  end

  def test_rejects_edge_production_preview_urls_deleted
    with_tree do |root|
      rewrite_between(root, EDGE_TOML, "\n[env.production]\n", "\n[env.staging]\n", "preview_urls = false\n",
                      "edge production preview_urls")
      reject_tree(root, "edge [env.production] preview_urls deleted", "preview_urls = false explicitly")
    end
  end

  def test_rejects_web_production_workers_dev_deleted
    with_tree do |root|
      rewrite_after(root, WEB_JSONC, '"production": {', "\"workers_dev\": false,\n", "web env.production workers_dev")
      reject_tree(root, "web env.production workers_dev deleted", "workers_dev = false explicitly")
    end
  end

  def test_rejects_web_production_preview_urls_deleted
    with_tree do |root|
      rewrite_after(root, WEB_JSONC, '"production": {', "\"preview_urls\": false,\n", "web env.production preview_urls")
      reject_tree(root, "web env.production preview_urls deleted", "preview_urls = false explicitly")
    end
  end

  def test_rejects_web_top_level_workers_dev_deleted
    with_tree do |root|
      path = File.join(root, WEB_JSONC)
      source = File.read(path)
      head, tail = source.split('"env": {', 2)
      refute_nil tail, "mutation marker missing: web top level"
      changed = head.sub("\"workers_dev\": false,\n", "")
      refute_equal head, changed, "mutation needle missing: web top-level workers_dev"
      File.write(path, "#{changed}\"env\": {#{tail}")
      reject_tree(root, "web top-level workers_dev deleted", "workers_dev = false (#1524)")
    end
  end

  def test_rejects_edge_staging_workers_dev_flipped_off
    with_tree do |root|
      path = File.join(root, EDGE_TOML)
      source = File.read(path)
      changed = source.sub("\nworkers_dev = true\n", "\nworkers_dev = false\n")
      refute_equal source, changed, "mutation needle missing: edge staging workers_dev = true"
      File.write(path, changed)
      reject_tree(root, "edge staging workers_dev flipped off", "keeps workers_dev = true")
    end
  end
end
