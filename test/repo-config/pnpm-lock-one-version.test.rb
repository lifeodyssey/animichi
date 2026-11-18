# SUT: the root pnpm-lock.yaml, for the packages it must resolve to exactly one version.
#
# The catalog declares ranges, so the lockfile is what pins, and pnpm resolves a second copy of a
# package without complaint wherever two parents ask for different versions. For the packages
# below a second copy is a break that only the build or the typecheck reports, so this reads the
# lockfile and names the package first. Each entry says what a second copy broke.
require "minitest/autorun"
require "psych"

class PnpmLockOneVersionTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  LOCKFILE = "pnpm-lock.yaml"
  ONE_VERSION = {
    "@tanstack/router-core" =>
      "the router/start family pins its members to each other exactly, so two router-cores come from two " \
      "release events, a mix that broke the web build (`makeSerovalPlugin` missing from router-core's " \
      "ssr/client.js); move the family together, as the TanStack comment in pnpm-workspace.yaml says"
  }.freeze

  # pnpm 12 writes two YAML documents and both have `importers`: its own environment lock, whose one
  # importer `.` holds pnpm itself, then the workspace lock, which lists every workspace package.
  # Psych 3.1, under the macOS system Ruby the pre-push gate can run, has no `safe_load_stream`, so
  # the documents are split on their `---` markers and loaded one at a time.
  def documents
    File.read(File.join(ROOT, LOCKFILE)).split(/^---\n/).reject { |part| part.strip.empty? }
        .map { |part| Psych.safe_load(part) }
  end

  def workspace_lock
    locks = documents.select { |document| document.fetch("importers", {}).length > 1 }
    assert_equal 1, locks.length, "#{LOCKFILE} holds #{locks.length} documents that list the workspace's importers"
    locks.first
  end

  # `packages` holds one key per resolved version, `name@version`; `snapshots` holds one per peer
  # set, so a single version can appear there more than once.
  def versions_of(name, packages)
    prefix = "#{name}@"
    packages.keys.select { |key| key.start_with?(prefix) }.map { |key| key.delete_prefix(prefix) }
  end

  def test_each_listed_package_resolves_to_exactly_one_version
    packages = workspace_lock.fetch("packages")
    offenders = ONE_VERSION.map { |name, reason| [name, versions_of(name, packages), reason] }
                           .reject { |_, versions, _| versions.length == 1 }
                           .map do |name, versions, reason|
                             "#{LOCKFILE} resolves #{versions.length} versions of #{name} #{versions.inspect}: #{reason}"
                           end
    assert_empty offenders, offenders.join("\n")
  end
end
