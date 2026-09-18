# SUT: the coupled `zod` / `@orpc/*` version set `packages/contract/AGENTS.md` states, read against
# the catalog that owns it (`pnpm-workspace.yaml`).
#
# The guide tells the next implementer which two pins move together, and nothing reads the guide: a
# dependency refresh that lands in the catalog alone leaves it naming a set the workspace has not
# installed for months (#1794), and a reader has no way to tell. `catalogMode: strict` keeps the
# importers on the catalog; this keeps the sentence describing that catalog true.
require "minitest/autorun"
require "psych"

class ContractPinSetTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  GUIDE = "packages/contract/AGENTS.md"
  WORKSPACE_MANIFEST = "pnpm-workspace.yaml"
  # The sentence states each version as `zod@<version>` / `@orpc/*@<version>`. Reading it by shape
  # rather than by line number lets the sentence be reworded, and a deleted claim fails by name
  # instead of passing vacuously.
  ZOD_CLAIM = /`zod@([^`]+)`/
  ORPC_CLAIM = %r{`@orpc/\*@([^`]+)`}

  def guide
    File.read(File.join(ROOT, GUIDE))
  end

  def catalog
    Psych.safe_load(File.read(File.join(ROOT, WORKSPACE_MANIFEST))).fetch("catalog")
  end

  def orpc_versions
    catalog.select { |name, _| name.start_with?("@orpc/") }.map { |_, version| version }.uniq
  end

  def claimed(pattern)
    claim = guide[pattern, 1]
    refute_nil claim, "#{GUIDE} no longer states a #{pattern.inspect} version; restore the claim or delete this pin"
    claim
  end

  def assert_pin(claim, expected, what)
    assert_equal expected, claim,
                 "#{GUIDE} states #{what} #{claim}, but #{WORKSPACE_MANIFEST}'s catalog says " \
                 "#{expected}; the two pins move together, so refresh both in one change"
  end

  def test_the_guide_states_the_catalog_zod_version
    assert_pin claimed(ZOD_CLAIM), catalog.fetch("zod"), "zod"
  end

  def test_the_guide_states_the_one_orpc_version_the_catalog_holds
    versions = orpc_versions
    assert_equal 1, versions.length,
                 "#{WORKSPACE_MANIFEST} holds #{versions.length} @orpc/* versions " \
                 "(#{versions.join(', ')}); the guide's one coupled set assumes they are one version"
    assert_pin claimed(ORPC_CLAIM), versions.first, "@orpc/*"
  end
end
