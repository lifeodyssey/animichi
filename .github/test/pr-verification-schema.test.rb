# SUT: pr-verification.yml's db job checks the migration chain's integrity and applies it fresh.
require "minitest/autorun"
require "psych"

class PrVerificationSchemaTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  SCHEMA_JOB = "db"
  SCHEMA_FILTERS = %w[migrations deps].freeze
  # Two questions, two steps, in this order: the graph is internally consistent (static), then
  # it still applies from zero to a pristine database (a throwaway container).
  SCHEMA_SEGMENTS = [
    "prisma migration check",
    "bash scripts/local-gates/db-fresh-schema.sh"
  ].freeze
  # A migration applies in exactly one place — the migrator Worker, in CD. Any of these in a PR
  # job would be a second apply path, with a database credential this workflow must never hold.
  SCHEMA_FORBIDDEN = ["prisma db migrate", "supabase db push", "psql "].freeze

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def test_schema_job_is_paths_filtered
    condition = @ci.dig("jobs", SCHEMA_JOB, "if").to_s
    SCHEMA_FILTERS.each do |filter|
      assert(condition.include?("needs.plan.outputs.#{filter} == 'true'"),
                       "pr-verification.yml:#{SCHEMA_JOB}: must run when the `#{filter}` filter is true")
    end
  end

  def schema_step_commands
    @ci.dig("jobs", SCHEMA_JOB, "steps").to_a.map { |step| step["run"].to_s }
  end

  def schema_segment_position(segment)
    schema_step_commands.index { |command| command.include?(segment) }
  end

  def test_schema_segments_are_separate_ordered_steps
    positions = SCHEMA_SEGMENTS.map { |segment| [segment, schema_segment_position(segment)] }
    positions.each do |segment, at|
      assert(at, "pr-verification.yml:#{SCHEMA_JOB}: `#{segment}` must be a step of its own")
    end
    found = positions.map(&:last).compact
    assert(found == found.uniq && found == found.sort,
                     "pr-verification.yml:#{SCHEMA_JOB}: the segments must be separate steps in the order " \
                     "#{SCHEMA_SEGMENTS.join(' -> ')}")
  end

  def job_commands
    @ci.fetch("jobs").each_key.flat_map { |job| @ci.dig("jobs", job, "steps").to_a.map { |step| [job, step["run"].to_s] } }
  end

  def test_no_job_applies_a_migration
    job_commands.product(SCHEMA_FORBIDDEN).each do |(job, command), forbidden|
      assert(!command.include?(forbidden),
                       "pr-verification.yml:#{job}: must never run `#{forbidden}`")
    end
  end
end
