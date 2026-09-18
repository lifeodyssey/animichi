# SUT: the agreed upstream rate ceiling (#1792) and the Worker's caps
# converted into the ceiling's unit.
#
# The two numbers are in DIFFERENT UNITS and the conversion is written down
# here rather than assumed one-to-one: `cron-config.ts`'s caps count WORKS, the
# ceiling counts REQUESTS, and one work can cost more than one request. A
# change that raised a work cap to the ceiling's own number would silently
# double the real rate and hit our own wall, so the conversion is asserted
# instead of remembered.
require "minitest/autorun"
require "json"

class AnitabiEgressCeilingTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CAPTURE = "apps/anitabi-egress/anitabi-api-surface.json"
  FLY_CONFIG = "apps/anitabi-egress/fly.toml"
  CRON_CONFIG = "workers/catalog/src/cron-config.ts"

  # The ceiling is read from the environment at boot; the environment is set
  # here, and this is the only place in the repository that states the number.
  CEILING_VAR = "UPSTREAM_REQUEST_CEILING_PER_HOUR"

  # The hourly production cron runs these two capped passes, and both spend
  # from the same hour. A new hourly pass with a cap belongs in this list.
  HOURLY_CAP_CONSTANTS = %w[TTL_BATCH_CAP PENDING_DRAIN_BATCH_CAP].freeze

  def test_the_service_reads_the_agreed_rate_from_configuration
    assert_equal agreed_rate.to_s, configured_ceiling,
                 "#{FLY_CONFIG} must set #{CEILING_VAR} to the agreed rate; the service reads it at boot"
    assert_equal "100", configured_ceiling,
                 "changing the ceiling means changing the agreement with the upstream, not a config edit"
  end

  def test_the_work_caps_converted_into_requests_stay_under_the_ceiling
    works = HOURLY_CAP_CONSTANTS.sum { |name| cap_of(name) }
    requests = works * requests_per_work
    assert_operator requests, :<=, agreed_rate, conversion_message(works, requests)
  end

  def test_the_conversion_is_not_one_to_one
    assert_operator requests_per_work, :>, 1,
                    "one work costs more than one upstream request (a points fetch, plus a lite preview when " \
                    "one is wanted) — a 1:1 conversion would understate the real rate"
  end

  private

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

  def conversion_message(works, requests)
    caps = HOURLY_CAP_CONSTANTS.map { |name| "#{name}=#{cap_of(name)}" }.join(" + ")
    "the hourly work caps (#{caps} = #{works} works) cost #{works} works x #{requests_per_work} requests per " \
      "work = #{requests} upstream requests per hour, which is over the agreed ceiling of #{agreed_rate} " \
      "requests per hour (#{CAPTURE} / #{FLY_CONFIG}). Lower a cap, or renegotiate the agreement."
  end

  def capture
    JSON.parse(read(CAPTURE))
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
