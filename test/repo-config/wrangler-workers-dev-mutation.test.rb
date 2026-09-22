# SUT: test/repo-config/wrangler-workers-dev.test.rb. Every probe copies the contract and the
# configs it reads into a throwaway tree, mutates the copy, and runs the copied contract; the
# committed files are never written to.
#
# The mutation is the whole declaration's removal — the exact hazard #1524 closed: a production
# block that "carries no explicit workers_dev" is precisely the state whose default (unset
# resolves to `routes.length === 0`, ON for a route-less block) the contract exists to forbid.
#
# #1836 extends this mutation suite to workers/users and workers/migrator, and adds an SUT
# header mutation that proves the coverage-claim guard fires.
require "fileutils"
require "minitest/autorun"
require "open3"
require "tmpdir"

class WranglerWorkersDevMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/wrangler-workers-dev.test.rb"
  EDGE_TOML = "workers/edge/wrangler.toml"
  WEB_JSONC = "apps/web/wrangler.jsonc"
  USERS_TOML = "workers/users/wrangler.toml"
  MIGRATOR_TOML = "workers/migrator/wrangler.toml"

  def with_tree
    Dir.mktmpdir("wrangler-workers-dev-mutation-") do |root|
      [CONTRACT, EDGE_TOML, WEB_JSONC, USERS_TOML, MIGRATOR_TOML].each do |relative|
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

  # --- edge ---

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

  # --- web ---

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

  # --- users (#1836) ---

  def test_rejects_users_production_workers_dev_deleted
    with_tree do |root|
      path = File.join(root, USERS_TOML)
      source = File.read(path)
      # Anchor: the unique combination of "name = \"users\"\nworkers_dev" only
      # appears in [env.production] (staging has "name = \"users-staging\"\n").
      changed = source.sub(/(name = "users"\n)workers_dev = false\n/, '\1')
      refute_equal source, changed, "mutation needle missing: users production workers_dev"
      File.write(path, changed)
      reject_tree(root, "users [env.production] workers_dev deleted", "workers_dev = false explicitly")
    end
  end

  def test_rejects_users_production_preview_urls_deleted
    with_tree do |root|
      path = File.join(root, USERS_TOML)
      source = File.read(path)
      # Anchor: "workers_dev = false\npreview_urls = false\n\n# #1048" only appears
      # in [env.production] (staging has no preview_urls and no #1048 comment).
      changed = source.sub(/workers_dev = false\npreview_urls = false\n\n# #1048/,
                           "workers_dev = false\n\n# #1048")
      refute_equal source, changed, "mutation needle missing: users production preview_urls"
      File.write(path, changed)
      reject_tree(root, "users [env.production] preview_urls deleted", "preview_urls = false explicitly")
    end
  end

  # --- migrator (#1836) ---

  def test_rejects_migrator_production_workers_dev_flipped_off
    with_tree do |root|
      path = File.join(root, MIGRATOR_TOML)
      source = File.read(path)
      # Anchor: "name = \"migrator-production\"\nworkers_dev = true" only appears
      # in [env.production] (staging has "name = \"migrator-staging\"\n").
      changed = source.sub(/(name = "migrator-production"\n)workers_dev = true\n/,
                           '\1workers_dev = false\n')
      refute_equal source, changed, "mutation needle missing: migrator production workers_dev"
      File.write(path, changed)
      reject_tree(root, "migrator [env.production] workers_dev flipped to false",
                  "workers_dev = true intentionally")
    end
  end

  def test_rejects_migrator_production_preview_urls_deleted
    with_tree do |root|
      path = File.join(root, MIGRATOR_TOML)
      source = File.read(path)
      # Anchor: "workers_dev = true\npreview_urls = false\n\n# #1050" only appears
      # in [env.production] (staging has a different comment after preview_urls).
      changed = source.sub(/workers_dev = true\npreview_urls = false\n\n# #1050/,
                           "workers_dev = true\n\n# #1050")
      refute_equal source, changed, "mutation needle missing: migrator production preview_urls"
      File.write(path, changed)
      reject_tree(root, "migrator [env.production] preview_urls deleted", "preview_urls = false explicitly")
    end
  end

  # --- SUT header (#1836 AC3) ---

  def test_rejects_sut_header_with_added_unit_not_in_expected
    with_tree do |root|
      path = File.join(root, CONTRACT)
      source = File.read(path)
      # Add "catalog" to sut_production_units without touching the expected list.
      changed = source.sub(
        "    %w[edge web users migrator]\n  end\n\n  # Shared TOML section parser",
        "    %w[edge web users migrator catalog]\n  end\n\n  # Shared TOML section parser"
      )
      refute_equal source, changed, "mutation needle missing: sut_production_units"
      File.write(path, changed)
      reject_tree(root, "SUT header: production unit added without updating expected",
                  "adding a unit to publish-services.sh without adding")
    end
  end
end
