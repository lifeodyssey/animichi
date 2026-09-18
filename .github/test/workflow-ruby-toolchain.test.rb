# SUT: every workflow job that runs Ruby, and the interpreter it runs (#1774).
# A job reaches `ruby` — directly or through a local action — only after a SHA-pinned
# ruby/setup-ruby step, and every such step resolves the version `.ruby-version` pins and
# `Gemfile.lock` records, so CI runs the interpreter a developer's `bundle exec` runs rather
# than whichever one the runner image ships.
require "minitest/autorun"
require "psych"

class WorkflowRubyToolchainTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOWS = Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort
  SETUP_RUBY = %r{\Aruby/setup-ruby@[0-9a-f]{40}\z}
  RUBY_COMMAND = /^\s*(?:bundle\s+exec\s+)?ruby\s/
  # setup-ruby's documented resolution: with no `ruby-version` input it reads `.ruby-version`.
  READS_VERSION_FILE = [nil, "default", ".ruby-version"].freeze

  def jobs
    WORKFLOWS.flat_map do |path|
      Psych.safe_load(File.read(path), aliases: true).fetch("jobs").map do |id, job|
        ["#{File.basename(path)}:#{id}", job.fetch("steps", [])]
      end
    end
  end

  def local_action_steps(step)
    ref = step["uses"].to_s
    return [] unless ref.start_with?("./", "$/")
    manifest = %w[action.yml action.yaml].map { |name| File.join(ROOT, ref.delete_prefix("$/"), name) }.find { |path| File.file?(path) }
    Psych.safe_load(File.read(manifest), aliases: true).dig("runs", "steps").to_a
  end

  def runs_ruby?(step, ancestors = [])
    ref = step["uses"].to_s
    raise "recursive local action: #{ref}" if ancestors.include?(ref)
    step["run"].to_s.match?(RUBY_COMMAND) ||
      local_action_steps(step).any? { |child| runs_ruby?(child, ancestors + [ref]) }
  end

  def ruby_jobs
    jobs.map { |where, steps| [where, steps, steps.index { |step| runs_ruby?(step) }] }
        .reject { |_where, _steps, first| first.nil? }
  end

  def setup_steps
    jobs.flat_map { |where, steps| steps.map { |step| [where, step] } }
        .select { |_where, step| step["uses"].to_s.start_with?("ruby/setup-ruby@") }
  end

  def version_file
    File.read(File.join(ROOT, ".ruby-version")).strip
  end

  def resolved_version(step)
    requested = step.fetch("with", {})["ruby-version"]
    READS_VERSION_FILE.include?(requested) ? version_file : requested.to_s
  end

  def test_every_job_that_runs_ruby_sets_up_the_pinned_interpreter_first
    refute_empty ruby_jobs, "no workflow job runs ruby; this guard would pass with its subject deleted"
    ruby_jobs.each do |where, steps, first|
      pinned = steps.first(first).any? { |step| step["uses"].to_s.match?(SETUP_RUBY) }
      assert pinned, "#{where}: step #{first + 1} runs ruby with no SHA-pinned ruby/setup-ruby step before it"
    end
  end

  def test_the_lockfile_records_the_version_ruby_version_pins
    locked = File.read(File.join(ROOT, "Gemfile.lock"))[/^RUBY VERSION\n\s+ruby (\S+)$/, 1]
    assert_equal version_file, locked, "Gemfile.lock's RUBY VERSION must be .ruby-version's; run `bundle lock`"
  end

  def test_every_setup_ruby_step_resolves_the_version_ruby_version_pins
    refute_empty setup_steps, "no workflow sets up ruby; this guard would pass with its subject deleted"
    setup_steps.each do |where, step|
      assert_equal version_file, resolved_version(step), "#{where}: ruby/setup-ruby must resolve .ruby-version's interpreter"
    end
  end
end
