# SUT: test/repo-config/dev-local-port.test.rb. Every probe copies the contract, the Makefile
# and apps/web/vite.config.ts into a throwaway tree, mutates the copy, and runs the copied
# contract; the committed files are never written to.
#
# The mutations are the ways ANI-19 happened and can come back: the dev server declares no
# port (Vite's default :5173 wins), the port or the announcement moves to another number, or
# strictPort disappears so Vite silently hops to the next free port while the announcement
# still says :3000.
require "fileutils"
require "minitest/autorun"
require "open3"
require "tmpdir"

class DevLocalPortMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/dev-local-port.test.rb"
  MAKEFILE = "Makefile"
  VITE_CONFIG = "apps/web/vite.config.ts"

  def with_tree
    Dir.mktmpdir("dev-local-port-mutation-") do |root|
      [CONTRACT, MAKEFILE, VITE_CONFIG].each do |relative|
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

  def rewrite(root, relative, needle, replacement, label)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    File.write(path, changed)
  end

  def reject_tree(root, label, consequence)
    status, output = run_contract(root)
    refute status.success?, "mutation survived: #{label}"
    assert_includes output, consequence, "mutation must name its consequence: #{label}"
  end

  def test_accepts_an_unmutated_copy
    with_tree do |root|
      status, output = run_contract(root)
      assert status.success?, "an unmutated copy must pass\n#{output}"
    end
  end

  def test_rejects_dev_server_port_deleted
    with_tree do |root|
      rewrite(root, VITE_CONFIG, "server: { port: 3000, strictPort: true },", "server: { strictPort: true },",
              "dev-server port deleted")
      reject_tree(root, "dev-server port deleted", "declares no dev-server port")
    end
  end

  def test_rejects_dev_server_port_moved_to_vite_default
    with_tree do |root|
      rewrite(root, VITE_CONFIG, "port: 3000", "port: 5173", "dev-server port moved to 5173")
      reject_tree(root, "dev-server port moved to 5173", "must bind the port every local entry point assumes")
    end
  end

  def test_rejects_dev_local_announcement_moved_to_another_port
    with_tree do |root|
      rewrite(root, MAKEFILE, "Web app:   http://localhost:3000", "Web app:   http://localhost:5173",
              "dev-local announcement moved to 5173")
      reject_tree(root, "dev-local announcement moved to 5173", "must announce http://localhost:3000")
    end
  end

  def test_rejects_strict_port_deleted
    with_tree do |root|
      rewrite(root, VITE_CONFIG, ", strictPort: true", "", "strictPort deleted")
      reject_tree(root, "strictPort deleted", "the dev-local announcement lies again")
    end
  end
end
