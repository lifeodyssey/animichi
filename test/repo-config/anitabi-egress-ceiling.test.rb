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
# THE CEILING IS PER CLOCK HOUR, so the callers that can land in one hour are
# ONE pool and their caps SUM (#1809). The daily run fires at 06:00 and the
# hourly passes at :17 and :37, so all of them spend the daily run's hour; the
# hourly ones alone were converted before #1809, and the daily run could spend
# that hour's whole budget by itself — the other two were left racing for what
# remained. The service refuses the losers correctly (`egress_refused`), which
# is why nothing broke; but the caller-side budget was not allocated, it was
# raced for, and this contract is what allocates it.
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
  # that runs it and the bound on the works one run of it may ingest.
  #
  # The cron is IN the row because the hour is what pools callers: a fixed-hour
  # caller shares its hour with the hourly passes, and their works are summed
  # there. A caller whose bound is a `cron-config.ts` cap is named by that
  # constant, so `test_every_declared_work_cap_bounds_a_scheduled_caller`
  # refuses a cap that is declared there and left out of this list. The seed
  # pass is the one caller with no cap to read: it ingests the undone entries of
  # the checked-in list, so that list's own length is its bound.
  SCHEDULED_CALLERS = [
    { cron: "SEED_CRON", bound: :seed_list },
    { cron: "DAILY_DISCOVER_CRON", bound: "DAILY_WORK_CAP" },
    { cron: "TTL_REFRESH_CRON", bound: "TTL_BATCH_CAP" },
    { cron: "PENDING_DRAIN_CRON", bound: "PENDING_DRAIN_BATCH_CAP" },
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

  # The works one run of a caller may spend: its cap constant, or the seed
  # pass's own list — the one caller that has no cap to read.
  def works_of(bound)
    bound == :seed_list ? seed_list_works : cap_of(bound)
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

  # The caps this contract places, in the same spelling `declared_caps` finds.
  def placed_caps
    SCHEDULED_CALLERS.filter_map { |row| row[:bound].is_a?(String) ? row[:bound] : nil }
  end

  # The most requests one work can cost: every operation the surface permits.
  # A work's ingest fetches `points`; the search-miss path adds `lite` for its
  # preview. The capture is the authority for how many operations exist.
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
