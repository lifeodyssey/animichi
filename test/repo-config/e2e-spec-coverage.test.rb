# SUT: e2e/*.spec.ts against the scripts the gate runs; a committed spec that no
# runnable script names is a guard that never executes (#1702).
require "minitest/autorun"
require "json"
require "psych"
require_relative "e2e_lane_exclusions"

class E2eSpecCoverageTest < Minitest::Test
  include E2eLaneExclusions

  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  E2E = File.join(ROOT, "e2e")
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  # The gate's own invocation of this package, and the shell list feeding it.
  # Reading both keeps "the lane" the repository's answer rather than this
  # file's. An invocation starts a command — the head of a `run:` line, or
  # after the `&&` or `;` joining a package.json script body — because #1701's
  # job step PRINTS `pnpm --filter animichi-e2e run test:login` inside an `echo`
  # to say where the credential-only proof lives: prose is not a lane, and
  # reading it would put that spec back into the run the step says it is not
  # part of.
  GATE_INVOCATION = /(?:^|&&|;)\s*pnpm --filter animichi-e2e run (\S+)/
  GREP_INVERT = /--grep-invert\s+(\S+)/
  FOR_LIST = /for script in ([^;]+); do/
  SPEC_TOKEN = %r{[\w./*?\[\]-]+\.spec\.ts}
  # A script body is a command list, and the lane is what its commands run — not
  # what any text in it mentions. A Playwright invocation is a command head (after
  # environment assignments, and optionally `pnpm exec` or `npx`, or a path) plus
  # everything it receives; pasting the same words into an `echo`, lint or
  # typecheck command makes no lane (#1702).
  SEGMENT = /&&|\|\||;|\n/
  PLAYWRIGHT_TEST = /\A(?:\w+=\S+\s+)*(?:(?:pnpm\s+exec|npx)\s+)?(?:\S*\/)?playwright\s+test(?:\s|\z)/
  # Matched as the owner clause, not as any `#N`: every reason also cites the card
  # whose cases fail, so a bare-number match cannot tell that card from the one that
  # owns the repair (#1702 round-2 M-2).
  REPAIR_OWNER = /#\d+ owns the repair/
  MAX_DEPTH = 3
  # Not case sources: `generated/` and `agent-discovered/` are the promotion
  # gate's working dirs (`check-e2e-promotion.sh` refuses a committed spec there,
  # `playwright.config.ts` testIgnore skips them), and node_modules is never one.
  NOT_CASE_SOURCES = %w[generated agent-discovered node_modules].freeze

  def test_every_spec_is_in_a_lane_or_named_with_a_reason
    orphans = specs_on_disk - lane_specs - outside_lane_specs
    assert_empty orphans, <<~MESSAGE
      e2e specs that no runnable script names — their assertions have never run:
      #{orphans.map { |spec| "  #{spec}" }.join("\n")}
      Add each to the e2e `test` script (e2e/package.json), or name it in
      test/repo-config/e2e_lane_exclusions.rb with the lane that runs it, or the
      failure that keeps it out.
    MESSAGE
  end

  def test_no_reason_names_a_spec_that_is_not_committed
    stale = outside_lane_specs - specs_on_disk
    assert_empty stale, "EXEMPT/KNOWN_FAILING entries with no such spec on disk: #{stale.join(', ')}"
  end

  def test_no_reason_hides_a_spec_the_lane_already_runs
    redundant = outside_lane_specs & lane_specs
    assert_empty redundant, "specs both lane-run and named as outside it: #{redundant.join(', ')}"
  end

  def test_a_spec_is_either_deliberately_out_or_known_failing
    both = EXEMPT.keys & KNOWN_FAILING.keys
    assert_empty both, "specs claiming both a deliberate exemption and a known failure: #{both.join(', ')}"
  end

  def test_every_known_failing_reason_names_a_repair_owner
    unowned = KNOWN_FAILING.reject { |_spec, reason| reason.match?(REPAIR_OWNER) }.keys
    assert_empty unowned,
                 "KNOWN_FAILING entries naming no repair owner (`#N owns the repair`): " \
                 "#{unowned.join(', ')}"
  end

  def test_every_spec_a_lane_names_exists
    missing = lane_specs - specs_on_disk
    assert_empty missing, "lane scripts name specs that are not on disk: #{missing.join(', ')}"
  end

  def test_the_lane_excludes_only_the_declared_cases
    assert_equal LANE_EXCLUDED_CASES.keys.sort, lane_excluded_cases,
                 "e2e/package.json: the lane's --grep-invert patterns must be exactly the ones " \
                 "declared in LANE_EXCLUDED_CASES (test/repo-config/e2e_lane_exclusions.rb); " \
                 "got #{lane_excluded_cases.join(', ')})"
  end

  # A declared exclusion is a claim about a case some spec declares: once the tag
  # it greps is gone, `--grep-invert` matches nothing, the cases run in the
  # always-run lane, and the declaration still reads as enforced (#1702).
  def test_every_declared_case_exclusion_matches_a_string_a_spec_declares
    declared = declared_case_texts
    unmatched = LANE_EXCLUDED_CASES.keys.reject { |pattern| declared.any? { |text| text.match?(pattern) } }
    assert_empty unmatched, "LANE_EXCLUDED_CASES patterns no committed spec declares: #{unmatched.join(', ')}"
  end

  def test_the_lane_comes_from_the_gate_not_from_this_file
    assert_includes gate_script_names, "test", "#{CI_FILE}: the e2e job must run `test`"
    assert_operator lane_specs.length, :>=, 10, "the lane derivation found almost no specs"
  end

  private

  def outside_lane_specs
    EXEMPT.keys + KNOWN_FAILING.keys
  end

  def specs_on_disk
    Dir.glob(File.join(E2E, "**", "*.spec.ts"))
       .map { |path| path.delete_prefix("#{E2E}/") }
       .reject { |relative| NOT_CASE_SOURCES.include?(relative.split("/").first) }
       .sort
  end

  # An approximation of what a case filter matches: Playwright tests the project
  # name, file name, describe and test titles and tags, and those titles and
  # `tag:` values are quoted strings in the spec. Every quoted string is read,
  # including one inside a comment.
  def declared_case_texts
    specs_on_disk.flat_map { |spec| File.read(File.join(E2E, spec)).scan(/"[^"\n]*"|'[^'\n]*'/) }
  end

  # What the gate runs (workflow → script names) and what those scripts run
  # (script bodies → spec tokens → files): both sides derived, neither listed.
  def lane_specs
    gate_script_names.flat_map { |name| script_bodies(name).flat_map { |body| spec_files(body) } }.uniq.sort
  end

  def gate_script_names
    listed = e2e_job_source[FOR_LIST, 1].to_s.split
    names = invoked_scripts(e2e_job_source).flat_map { |name| name.start_with?("$") ? listed : [name] }
    raise "#{CI_FILE}: no `pnpm --filter animichi-e2e run <script>` to derive the lane from" if names.empty?
    names.uniq
  end

  def invoked_scripts(source)
    source.scan(GATE_INVOCATION).flatten.map { |token| token.delete("\"'") }
  end

  def lane_excluded_cases
    lane_playwright_segments.flat_map { |segment| segment.scan(GREP_INVERT).flatten }.uniq.sort
  end

  def e2e_job_source
    jobs = Psych.safe_load(File.read(CI_FILE), aliases: true).fetch("jobs")
    jobs.fetch("e2e").fetch("steps").map { |step| step["run"] }.compact.join("\n")
  end

  def scripts
    JSON.parse(File.read(File.join(E2E, "package.json"))).fetch("scripts")
  end

  # A lane script that delegates to another of this package's scripts runs both
  # bodies; specs are credited to whichever one spells their path.
  def script_bodies(name, depth = 0)
    raise "e2e/package.json: no #{name} script to run" unless scripts.key?(name)
    raise "e2e/package.json: script indirection deeper than #{MAX_DEPTH} at #{name}" if depth > MAX_DEPTH
    body = scripts.fetch(name)
    nested = invoked_scripts(body).reject { |child| child.start_with?("$") }
    [body] + nested.flat_map { |child| script_bodies(child, depth + 1) }
  end

  # A token expands through the filesystem so a glob covers what it matches; a
  # literal that matches nothing stays visible and fails `test_every_spec_a_lane_names_exists`.
  # Only an argument of a `playwright test` command is a token at all.
  def spec_files(body)
    playwright_segments(body).flat_map { |segment| segment.scan(SPEC_TOKEN) }.flat_map do |token|
      matches = Dir.glob(File.join(E2E, token)).map { |path| path.delete_prefix("#{E2E}/") }
      matches.empty? ? [token] : matches
    end.uniq
  end

  # Every Playwright invocation the gate's scripts reach, in a spelling
  # `PLAYWRIGHT_TEST` recognizes (any other leaves its specs uncredited, so the
  # contract refuses rather than passes): the lane's specs and its case filters
  # are both read from these segments, so neither can be credited to a command
  # that only prints them.
  def lane_playwright_segments
    gate_script_names.flat_map { |name| script_bodies(name).flat_map { |body| playwright_segments(body) } }
  end

  # The command heads in a script body that run Playwright, with their arguments.
  def playwright_segments(body)
    body.split(SEGMENT).map(&:strip).select { |segment| segment.match?(PLAYWRIGHT_TEST) }
  end
end
