# SUT: the release units — every list the release toolchain keeps of the Workers it bundles
# (`release-build.yml`, `config.mjs`), seals (`snapshot.rb`), publishes (`publish-services.sh`),
# verifies (`verify-config.mjs`), observes (`record-receipt.mjs`, `receipt.rb`) and retires a
# container for (`scripts/delivery/retire-*-container.sh`).
#
# A release unit is the name of a Worker's directory under `workers/`: `build-worker.mjs <unit>`
# reads `workers/<unit>/wrangler.toml` and writes `release/<unit>/`. So each list must name
# exactly those directories, plus the web app where the list covers it. The edge Worker's code
# moved to `workers/api` (#1928) while its live script names stayed; a list still naming the old
# unit leaves the Worker out of the snapshot, or CD publishes and observes nothing for it.
require "minitest/autorun"
require_relative "repository-yaml"

class ReleaseUnitsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # The staging script of the product's public API; #1928 renames code, never a live name.
  LIVE_API_SCRIPT = /^name = "animichi-staging"$/
  WEB = "web"
  # cd.yml publishes the migrator in a step of its own, before the schema calls that need it.
  PUBLISHED_ALONE = %w[migrator].freeze

  def read(path)
    File.read(File.join(ROOT, path))
  end

  def worker_units
    Dir.glob(File.join(ROOT, "workers/*/wrangler.toml")).map { |path| File.basename(File.dirname(path)) }.sort
  end

  def quoted_list(path, pattern)
    read(path)[pattern, 1].to_s.scan(/'([\w-]+)'/).flatten.sort
  end

  def bundled_by_the_build
    steps = RepositoryYaml.load_file(File.join(ROOT, ".github/workflows/release-build.yml")).dig("jobs", "snapshot", "steps")
    steps.map { |step| step["run"].to_s }.join("\n").scan(/build-worker\.mjs (\S+)/).flatten.sort
  end

  def entry_units
    read(".github/lib/release/config.mjs")[/ENTRIES = \{([^}]*)\}/, 1].to_s.scan(/([\w-]+):/).flatten.sort
  end

  def sealed_units
    files = read(".github/lib/release/snapshot.rb")[/REQUIRED_FILES = %w\[(.*?)\]/m, 1].to_s.split
    files.filter_map { |file| file[%r{\A([\w-]+)/wrangler\.json\z}, 1] }.sort
  end

  def receipt_units
    read(".github/lib/release/receipt.rb")[/\.sort == %w\[([^\]]*)\]/, 1].to_s.split
  end

  def published_units
    read(".github/scripts/release/publish-services.sh")[/for unit in ([^;]+);/, 1].to_s.split.sort
  end

  def retirement_units
    Dir.glob(File.join(ROOT, "scripts/delivery/retire-*-container.sh"))
       .map { |path| File.read(path)[%r{config="\$\{2:-release/([\w-]+)/wrangler\.json\}"}, 1] }
  end

  def test_the_unit_that_ships_the_live_api_script_is_api
    shipping = worker_units.select { |unit| read("workers/#{unit}/wrangler.toml").match?(LIVE_API_SCRIPT) }
    assert_equal ["api"], shipping,
                 "the Worker behind the live API script ships as the release unit `api` (#1928); " \
                 "its directory under workers/ is the unit every list below must name"
  end

  def test_the_build_bundles_every_worker_unit
    assert_equal worker_units, bundled_by_the_build, "release-build.yml: a Worker it does not bundle is absent from the snapshot"
    assert_equal worker_units, entry_units, "config.mjs ENTRIES: a unit with no entry cannot be bundled"
  end

  def test_the_snapshot_requires_every_unit
    assert_equal (worker_units + [WEB]).sort, sealed_units,
                 "snapshot.rb REQUIRED_FILES: a snapshot without a unit's sealed config verifies anyway"
  end

  def test_cd_verifies_and_observes_every_unit
    units = (worker_units + [WEB]).sort
    assert_equal units, quoted_list(".github/scripts/release/verify-config.mjs", /for \(const unit of \[([^\]]*)\]/)
    assert_equal units, quoted_list(".github/scripts/release/record-receipt.mjs", /const workers = \[([^\]]*)\]/)
    assert_equal units, receipt_units, "receipt.rb: the receipt must observe exactly the units CD published"
  end

  def test_publish_services_deploys_every_unit_but_the_migrator
    assert_equal (worker_units + [WEB] - PUBLISHED_ALONE).sort, published_units,
                 "publish-services.sh: a unit it skips is never deployed by CD"
  end

  def test_every_container_retirement_reads_a_sealed_unit_config
    retirements = retirement_units
    refute_empty retirements
    assert_empty retirements - worker_units,
                 "scripts/delivery/retire-*-container.sh: a default config outside the snapshot fails the CD step"
  end
end
