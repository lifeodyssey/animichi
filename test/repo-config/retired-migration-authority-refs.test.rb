# SUT: every live surface of the repository after the migration authority moved to Prisma.
# A live file must not name a request field, marker or gate that no side of the release
# handshake sends, reads or runs any more — a receiver still branching on a field nobody sends
# reads as live policy (#1621, #1635). Dated records keep the history they recorded.
require "minitest/autorun"
require "open3"

class RetiredMigrationAuthorityRefsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # Two retirements, one authority. The staging-only baseline: the owner deleted the gate rather
  # than rehousing it (#1621), so the field, the marker and the guard script are unreachable by
  # name. The Atlas chain (#1636): its directory, its checksum file, its ledger table, its CLI and
  # a chain head derived from filenames. A live file that still names one is either a gate reading
  # a directory that no longer exists, or a reader being pointed at a second authority.
  RETIRED = [/stagingOnlyBaseline/, /STAGING_ONLY_BASELINE/, /staging_only_baseline/,
             %r{production-baseline-guard},
             %r{migrations/neon}, /atlas\.sum/, /atlas_schema_revisions/,
             /\batlas\s+migrate\b/, /ariga\/setup-atlas/, /ATLAS_BIN/, /ATLAS_VERSION/].freeze
  # Those patterns are all artefact names, so they catch a reference to the retired chain's
  # directory, checksum, ledger, CLI and environment variables. They cannot catch the claim that
  # misleads an operator more: that the retired authority is what applies migrations TODAY
  # (#1871, found on `workers/migrator/wrangler.toml`). That claim is prose — an apply verb and
  # the authority's name inside ONE sentence. A record of the retirement separates the two with a
  # sentence boundary, or uses no apply verb at all, which is why the boundary is the rule.
  STILL_APPLYING = /
    \bapplies\b [^.]* \batlas\b                                # "applies the committed Atlas chain"
  | \batlas\b [^.]* \b(?:is|are)\s+(?:still\s+)?applied\b      # "Atlas is still applied by"
  /xi

  # History, not live surfaces — exempt by path family, one stated reason each:
  HISTORY = {
    %r{\Adocs/archive/} => "read-only history (DOCS_POLICY)",
    %r{\Adocs/specs/\d{4}-\d{2}-\d{2}-} => "a dated spec (and its subfolder) records the design of its day",
    %r{\Adocs/iterations/} => "dated iteration plans and their execution records",
    %r{\Adocs/adr/} => "accepted decision records are immutable; a new ADR supersedes",
    %r{\Adocs/naming-audit-} => "a dated audit snapshot",
    %r{\Asupabase/} => "the archived Supabase tree records what it replaced (issue #1000)",
  }.freeze
  # Files that must spell a retired name out to do their own job:
  SPELLERS = {
    "test/repo-config/retired-migration-authority-refs.test.rb" => "this contract names what it forbids",
    "workers/migrator/test/preflight.worker.metadata.test.ts" =>
      "one case sends the retired body verbatim, so the deleted branch is proved gone rather than unreachable",
    "workers/migrator/test/atlas-engine-retired.test.ts" => "that contract names the modules it forbids",
    "packages/test-postgres/test/prisma-chain.test.ts" => "that contract names the Atlas surface it forbids",
    "packages/test-postgres/test/integration/prisma-chain.test.ts" =>
      "its falsifier runs the whole apply with a broken Atlas binary on PATH, so the name is the probe",
    "packages/test-postgres/sql/drizzle-era-catalog.sql" =>
      "a verbatim freeze of the shape the retired chain built; its comments are that chain's own",
    "scripts/check-skeleton-w0-docs.sh" => "it asserts that a dated iteration record still says what it said",
    "docs/ops/migrations.md" => "the runbook states which authority was retired and why",
    "infra/database-access/reset-staging-baseline.sh" => "the staging rebuild finds and drops the ledger it names (#1625)",
    "infra/database-access/reset-staging-baseline.test.sh" => "its cutover fixture builds the ledger the rebuild must drop",
    "workers/migrator/src/atlas-leftovers.ts" => "the migrator refuses a database by the ledger it names (#1625)",
    "workers/migrator/test/integration/prisma.integration.ts" => "one case builds the ledger the migrator must refuse",
  }.freeze

  def test_no_live_surface_names_a_retired_migration_authority
    offenders = live_files.flat_map { |path| offending_lines(path, RETIRED) }
    assert_empty(offenders,
                 "these live surfaces still name a deleted migration authority — the staging-only " \
                 "baseline gate (#1621, #1635) or the Atlas chain (#1636). Delete the reference, " \
                 "or move a dated record under docs/archive/:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  # The rule, not the tree: once every live surface is fixed the sweep below is empty either
  # way, so this is what deleting STILL_APPLYING turns red.
  def test_the_still_applying_rule_reads_a_claim_and_leaves_a_record
    assert_match(STILL_APPLYING, "POST /migrate applies the committed Atlas chain")
    assert_match(STILL_APPLYING, "Atlas is still applied by the catalog spike")
    refute_match(STILL_APPLYING, "the Atlas chain was retired in #1636")
    refute_match(STILL_APPLYING, "src/atlas-leftovers.ts — a cleanup of Atlas leftovers")
  end

  def test_no_live_surface_claims_a_retired_authority_still_applies
    offenders = live_files.flat_map { |path| offending_lines(path, [STILL_APPLYING]) }
    assert_empty(offenders,
                 "these live surfaces read as though a deleted migration authority still " \
                 "applies migrations (#1636, #1871). Say what applies now, or put the " \
                 "retirement in a sentence of its own so it reads as history:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  private

  def live_files
    repository_files.reject { |path| SPELLERS.key?(path) || HISTORY.keys.any? { |family| path.match?(family) } }
  end

  def repository_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", chdir: ROOT)
    assert_predicate(status, :success?, "git ls-files failed: #{err}")
    out.split("\0").select { |path| File.file?(File.join(ROOT, path)) }
  end

  def offending_lines(path, patterns)
    text = File.binread(File.join(ROOT, path))
    return [] if text.include?("\0")

    text.force_encoding(Encoding::UTF_8).scrub.each_line.with_index(1)
        .select { |line, _| patterns.any? { |pattern| line.match?(pattern) } }
        .map { |line, number| "#{path}:#{number}: #{line.strip}" }
  end
end
