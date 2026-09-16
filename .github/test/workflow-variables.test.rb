# SUT: every `vars.*` read in the workflows and local actions names a repository
# variable that exists, or refuses an empty value before spending it — the gap
# #1686 found in cd.yml's production migrator URL.
require "minitest/autorun"
require "psych"

class WorkflowVariablesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD = ".github/workflows/cd.yml"
  PRODUCTION_URL = "MIGRATOR_PRODUCTION_URL"
  FIRST_USE = "Read applied migration compatibility"
  FILES = Dir.glob(File.join(ROOT, ".github/{workflows,actions}/**/*.{yml,yaml}")).sort
  REFERENCE = /\$\{\{\s*vars\.([A-Za-z0-9_]+)\s*\}\}/
  GUARD_LOOP = /for key in ([A-Z0-9_ ]+); do/

  # `gh variable list --repo lifeodyssey/animichi`, 2026-09-16. GitHub's default
  # token cannot list variables and no runner can ask GitHub, so the inventory is
  # pinned here: whoever adds, renames or retires one updates this list in the same
  # commit — the human discipline docs/ops/secrets.md states for the two credential
  # tables. Staging-scoped names (VITE_NEON_AUTH_BASE_URL, VITE_SHOWCASE_MODE,
  # VITE_TURNSTILE_SITE_KEY) are deliberately absent: a job not bound to that
  # `environment:` reads them as empty, which is the failure this check exists for.
  DEFINED = %w[CLOUDFLARE_ACCOUNT_ID DEFAULT_AGENT_MODEL DOORBELL_STAGING_URL
               FALLBACK_AGENT_MODEL MIGRATOR_STAGING_URL OPENAI_COMPAT_BASE_URL].freeze

  def load_document(relative)
    Psych.safe_load(File.read(File.join(ROOT, relative)), aliases: true)
  end

  def references(value)
    value.to_s.scan(REFERENCE).flatten
  end

  def step_reads(step)
    references(step["env"]) + references(step["with"]) + references(step["run"])
  end

  # A refusal is the repository's credential guard, and its loop key is the
  # variable's own name, so `::error::$key is missing` names that variable.
  def refused_by(step)
    run = step["run"].to_s
    return [] unless run.match?(GUARD_LOOP) && run.include?('[ -n "${!key:-}" ]')
    return [] unless run.include?('::error::$key is missing') && run.include?("exit 1")
    keys = run.scan(GUARD_LOOP).flatten.flat_map(&:split)
    step["env"].to_h.select { |key, _value| keys.include?(key) }
                   .flat_map { |_key, value| references(value) }
                   .select { |name| keys.include?(name) }
  end

  def refused_first?(steps, name)
    refusal = steps.index { |step| refused_by(step).include?(name) }
    !refusal.nil? && steps.index { |step| step_reads(step).include?(name) } == refusal
  end

  def loose_reads(job)
    steps = job.fetch("steps", [])
    reads = steps.flat_map { |step| step_reads(step) }.uniq - DEFINED
    reads.reject { |name| refused_first?(steps, name) }
  end

  def loose_reads_in(relative)
    document = load_document(relative)
    per_job = document.fetch("jobs", {}).flat_map { |_id, job| loose_reads(job) + (references(job["env"]) - DEFINED) }
    (per_job + references(document["env"])).uniq - DEFINED
  end

  def test_every_variable_read_is_defined_or_refused_in_its_job
    FILES.each do |path|
      relative = path.delete_prefix("#{ROOT}/")
      loose = loose_reads_in(relative)
      assert_empty loose, "#{relative} reads #{loose.join(', ')}, which the repository does not define: " \
                          "create the variable (owner action), or bind it and refuse when it is empty"
    end
  end

  def test_the_production_migrator_url_is_refused_before_it_is_spent
    steps = load_document(CD).dig("jobs", "promote-production", "steps").to_a
    refusal = steps.index { |step| refused_by(step).include?(PRODUCTION_URL) }
    use = steps.index { |step| step["name"] == FIRST_USE }
    assert(refusal && use && refusal < use,
           "#{CD}:promote-production must refuse an empty #{PRODUCTION_URL} with an ::error:: " \
           "naming it, before `#{FIRST_USE}`")
    assert(refusal && !steps[refusal].key?("if"), "#{CD}: the refusal must not be conditional")
  end
end
