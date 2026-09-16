# SUT: every `vars.*` read anywhere in the workflows and local actions names a
# repository variable that exists, or refuses an empty value before spending it —
# the gap #1686 found in cd.yml's production migrator URL.
require "minitest/autorun"
require "psych"

class WorkflowVariablesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD = ".github/workflows/cd.yml"
  PRODUCTION_URL = "MIGRATOR_PRODUCTION_URL"
  CHECKOUT = "actions/checkout@"
  STEPS = "steps"

  # Directory-driven, so a workflow or local action joins the surface the moment
  # it lands: there is no file list to remember to extend.
  FILES = Dir.glob(File.join(ROOT, ".github/{workflows,actions}/**/*.{yml,yaml}")).sort
  # Literal reads of the repository-variable context in any scalar, whatever
  # expression surrounds them: `${{ vars.X }}`, `${{ vars.X == 'true' }}`,
  # `format('{0}', vars.X)`, `${{ vars['X'] }}`. Matching the token family instead
  # of an expression shape is what keeps the next shape covered. A *computed* index
  # (`vars[matrix.name]`) names nothing this contract can check, so it is not
  # modeled — it does not appear in the repository.
  DOTTED = /(?<![A-Za-z0-9_.])vars\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/
  INDEXED = /(?<![A-Za-z0-9_.])vars\s*\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/
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
    text = value.to_s
    text.scan(DOTTED).flatten + text.scan(INDEXED).flatten
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

  # Names a step list refuses before anything in that list reads them.
  def first_refusals(steps)
    steps.flat_map { |step| step_reads(step) }.uniq.select { |name| refused_first?(steps, name) }
  end

  # Every scalar of the document, walked recursively — a workflow's job `env`, a
  # step's `with`, a local action's `runs.steps`, a job condition. Each scalar is
  # yielded with the ordered `steps:` list around it, or nil when it sits outside
  # one, so a refusal can be paired with the reads it covers.
  def each_scalar(node, steps = nil, &block)
    case node
    when Hash then node.each { |key, value| each_scalar(value, step_list(key, value, steps), &block) }
    when Array then node.each { |value| each_scalar(value, steps, &block) }
    else block.call(node, steps)
    end
  end

  def step_list(key, value, steps)
    return steps unless key == STEPS && value.is_a?(Array) && value.all? { |step| step.is_a?(Hash) }
    value
  end

  def reads_with_steps(document)
    found = []
    each_scalar(document) { |value, steps| references(value).each { |name| found << [steps, name] } }
    found
  end

  def scalars_of(paths)
    paths.flat_map do |path|
      values = []
      each_scalar(load_document(path.delete_prefix("#{ROOT}/"))) { |value, _steps| values << value }
      values
    end
  end

  def loose_reads_in(relative)
    reads = reads_with_steps(load_document(relative)).reject { |_steps, name| DEFINED.include?(name) }
    reads.reject { |steps, name| steps && first_refusals(steps).include?(name) }.map(&:last).uniq
  end

  def test_every_variable_read_is_defined_or_refused_where_it_is_read
    FILES.each do |path|
      relative = path.delete_prefix("#{ROOT}/")
      loose = loose_reads_in(relative)
      assert_empty loose, "#{relative} reads #{loose.join(', ')}, which the repository does not define: " \
                          "create the variable (owner action), or bind it and refuse when it is empty"
    end
  end

  # The coverage test above would pass vacuously if the glob stopped reaching a
  # surface or the walker stopped seeing reads, which is how this class of guard
  # dies. Pin each surface the SUT sentence names, and one read that exists.
  def test_the_scan_reaches_the_workflow_and_local_action_surfaces
    %w[workflows actions].each do |surface|
      paths = FILES.grep(%r{/\.github/#{surface}/})
      refute_empty paths, ".github/#{surface} is missing from the scanned surface"
      refute_empty scalars_of(paths), "no .github/#{surface} scalar reached the scan"
    end
    assert_includes scalars_of(FILES.grep(%r{/\.github/workflows/})).flat_map { |value| references(value) },
                    PRODUCTION_URL
  end

  def test_the_production_migrator_url_is_refused_before_checkout_and_every_setup_step
    steps = load_document(CD).dig("jobs", "promote-production", "steps").to_a
    refusal = steps.index { |step| refused_by(step).include?(PRODUCTION_URL) }
    assert(refusal, "#{CD}:promote-production must refuse an empty #{PRODUCTION_URL} with an ::error:: naming it")
    assert(!steps[refusal].key?("if"), "#{CD}: the refusal must not be conditional")
    checkout = steps.index { |step| step["uses"].to_s.start_with?(CHECKOUT) }
    assert(checkout && refusal < checkout, "#{CD}:promote-production must refuse before checkout")
    # Every step other than the refusal is deployment setup: the job exists to
    # check out, install, authenticate and deploy. Deriving the set that way keeps
    # this pin covering setup steps nobody has written yet, where a list of step
    # names would not.
    steps.each_index.select { |index| index != refusal }.each do |index|
      assert_operator refusal, :<, index, "#{CD}:promote-production must refuse before `#{step_label(steps[index])}`"
    end
  end

  def step_label(step)
    step["name"] || step["uses"] || step["run"].to_s.lines.first.to_s.strip
  end
end
