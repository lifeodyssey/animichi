# SUT: the agreed upstream rate ceiling (#1792) and the Worker's caps
# converted into the ceiling's unit.
#
# The two numbers are in DIFFERENT UNITS and the conversion is written down
# here rather than assumed one-to-one: `cron-config.ts`'s caps count WORKS, the
# ceiling counts REQUESTS, and one work can cost more than one request. A
# change that raised a work cap to the ceiling's own number would silently
# double the real rate and hit our own wall, so the conversion is asserted
# instead of remembered.
#
# THIS CONTRACT POOLS BY CLOCK HOUR: the callers that can land in one hour are
# ONE pool and their caps SUM (#1809), so the daily run's 06:00 hour holds it
# and both hourly passes. Before #1809 the daily run could spend that hour's
# whole budget by itself and the others raced for what remained; the service
# refused the losers (`egress_refused`), but the budget was raced for, not
# allocated, and this contract is what allocates it.
#
# The egress enforces the ceiling over ANY 60 minutes, which is stricter. In
# this contract's unit the worst 60 minutes, 05:17 to 06:17, hold two
# production hourly passes, staging's drain and the daily run: 60 works, 120
# requests. Scheduled ingest sends one request per work, so that span is about
# 60 requests in practice, before retries. Whether this guard should pool any
# 60 minutes and count that real cost is the owner's to decide; until then it
# keeps the clock-hour pool and the two-requests-per-work unit, and is not
# loosened.
require "minitest/autorun"
require "json"

class AnitabiEgressCeilingTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CAPTURE = "apps/anitabi-egress/anitabi-api-surface.json"
  FLY_CONFIG = "apps/anitabi-egress/fly.toml"
  CRON_CONFIG = "workers/catalog/src/cron-config.ts"
  SEED_LIST = "workers/catalog/src/ingest/seed-works.ts"

  # The ceiling is read from the environment at boot; the environment is set
  # here, and this is the only place in the repository that states the number.
  CEILING_VAR = "UPSTREAM_REQUEST_CEILING_PER_HOUR"

  # Every scheduled caller that spends from the ceiling, as the cron constant
  # that runs it and the `cron-config.ts` caps whose sum bounds the works one run
  # of it may ingest. The cron is IN the row because the hour pools callers, and
  # `test_every_declared_work_cap_bounds_a_scheduled_caller` refuses a cap left
  # out of this list. The seed pass's bound is the checked-in list's length.
  #
  # The rows are the deployed layout (`workers/catalog/wrangler.toml`).
  # Production's hourly event at :17 drains parked work and then refreshes stale
  # work on one shared budget (`runProductionHourlyJob`, `hourlyIngestBudget`),
  # so its row holds both caps. Staging drains its own parked work at :37 and
  # signs into the SAME egress — one Fly app serves both environments — so its
  # works spend this ceiling too.
  SCHEDULED_CALLERS = [
    { cron: "SEED_CRON", bound: :seed_list },
    { cron: "DAILY_DISCOVER_CRON", bound: %w[DAILY_WORK_CAP] },
    { cron: "TTL_REFRESH_CRON", bound: %w[PENDING_DRAIN_BATCH_CAP TTL_BATCH_CAP] },
    { cron: "PENDING_DRAIN_CRON", bound: %w[PENDING_DRAIN_BATCH_CAP] },
  ].freeze

  def test_the_service_reads_the_agreed_rate_from_configuration
    assert_equal agreed_rate.to_s, configured_ceiling,
                 "#{FLY_CONFIG} must set #{CEILING_VAR} to the agreed rate; the service reads it at boot"
    assert_equal "100", configured_ceiling,
                 "changing the ceiling means changing the agreement with the upstream, not a config edit"
  end

  def test_no_clock_hour_s_scheduled_works_exceed_the_ceiling_in_requests
    demand = hour_demand
    refute_empty demand, "no scheduled caller resolved to an hour — this contract would pass vacuously"
    demand.each do |hour, works|
      requests = works * requests_per_work
      assert_operator requests, :<=, agreed_rate, conversion_message(hour, works, requests)
    end
  end

  # A cap declared in `cron-config.ts` and not placed in the list above is a
  # caller spending an hour nothing counts, which is the shape #1809 found on
  # the daily run. The list is compared against the file rather than restated,
  # so a new cap fails here until it is placed.
  def test_every_declared_work_cap_bounds_a_scheduled_caller
    assert_equal declared_caps.sort, placed_caps.sort,
                 "#{CRON_CONFIG} declares a work cap this contract does not convert: a caller whose cap is not " \
                 "in SCHEDULED_CALLERS spends an hour nothing checks. Place it there, or delete the constant."
  end

  def test_the_conversion_is_not_one_to_one
    assert_operator requests_per_work, :>, 1,
                    "one work costs more than one upstream request (a points fetch, plus a lite preview when " \
                    "one is wanted) — a 1:1 conversion would understate the real rate"
  end

  private

  # The works each clock hour's callers may spend, keyed by the hour the fixed
  # callers run in. The hourly passes run in EVERY hour, so they are in each of
  # them; two fixed callers in one hour are summed, not overwritten.
  def hour_demand
    hourly = hourly_callers.sum { |row| works_of(row[:bound]) }
    demand = Hash.new(0)
    fixed_callers.each { |row| demand[hour_of(row[:cron])] += works_of(row[:bound]) }
    demand.transform_values { |works| works + hourly }
  end

  def hourly_callers
    SCHEDULED_CALLERS.select { |row| hour_of(row[:cron]) == :every }
  end

  def fixed_callers
    SCHEDULED_CALLERS.reject { |row| hour_of(row[:cron]) == :every }
  end

  # The clock hour a cron constant runs at, or :every when it runs hourly. The
  # hour is the cron's second field: `"0 6 * * *"` is 06:00, `"17 * * * *"` is
  # every hour at :17.
  def hour_of(name)
    match = read(CRON_CONFIG).match(/^export const #{name} = "\d+ (\d+|\*) /)
    refute_nil match, "#{CRON_CONFIG} no longer declares #{name}; point this contract at its successor"
    match[1] == "*" ? :every : Integer(match[1], 10)
  end

  # The works one run of a caller may spend: the sum of its caps, or the seed
  # pass's own list — the one caller that has no cap to read.
  def works_of(bound)
    bound == :seed_list ? seed_list_works : bound.sum { |name| cap_of(name) }
  end

  def seed_list_works
    works = read(SEED_LIST).scan(/bangumiId: "\d+"/).length
    assert_operator works, :>, 0,
                    "#{SEED_LIST} no longer declares seed works; the seed pass's bound is this list, so what " \
                    "this contract counts has to be there"
    works
  end

  # Every work cap the Worker declares, found in its source rather than listed
  # a second time: the completeness check is against the file.
  def declared_caps
    read(CRON_CONFIG).scan(/^export const (\w*CAP\w*) = \d+;/).flatten
  end

  # The caps this contract places, each once, in the same spelling `declared_caps` finds.
  def placed_caps
    SCHEDULED_CALLERS.flat_map { |row| row[:bound] == :seed_list ? [] : row[:bound] }.uniq
  end

  # The most requests one work can cost: every operation the surface permits.
  # A work's ingest fetches `points`; points-by-bangumi-id adds `lite` for its
  # preview of an unpublished work. The capture is the authority for how many
  # operations exist.
  def requests_per_work
    capture["operations"].length
  end

  def agreed_rate
    capture["agreedUpstreamRequestsPerHour"]
  end

  def configured_ceiling
    match = read(FLY_CONFIG).match(/^\s*#{CEILING_VAR}\s*=\s*"([^"]+)"/)
    refute_nil match, "#{FLY_CONFIG} does not set #{CEILING_VAR} — the service would refuse everything at boot"
    match[1]
  end

  def cap_of(name)
    match = read(CRON_CONFIG).match(/^export const #{name} = (\d+);/)
    refute_nil match, "#{CRON_CONFIG} no longer declares #{name}; point this contract at its successor"
    Integer(match[1], 10)
  end

  # Both numbers, named: what that hour's callers may ask for, and what the
  # agreement allows.
  def conversion_message(hour, works, requests)
    "the callers that can spend the #{format('%02d', hour)}:00 hour (#{caller_caps(hour)}) may ingest #{works} works " \
      "in it, and one work can cost #{requests_per_work} upstream requests: #{works} x #{requests_per_work} = " \
      "#{requests} requests in that hour, which is over the agreed ceiling of #{agreed_rate} requests per hour " \
      "(#{CAPTURE} / #{FLY_CONFIG}). Lower a cap, or renegotiate the agreement."
  end

  # The callers that hour's pool is made of: the fixed-hour one, plus the hourly
  # passes, which run in every hour.
  def callers_in(hour)
    SCHEDULED_CALLERS.select do |row|
      at = hour_of(row[:cron])
      at == :every || at == hour
    end
  end

  # That hour's callers and their bounds, named with their values: the list an
  # operator lowers when this contract refuses.
  def caller_caps(hour)
    callers_in(hour).map { |row| "#{row[:cron]}=#{works_of(row[:bound])}" }.join(" + ")
  end

  def capture
    JSON.parse(read(CAPTURE))
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
