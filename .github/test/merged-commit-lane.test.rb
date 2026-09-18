# SUT: the merged-commit lane — the `push` trigger #1715 gave `pr-verification.yml`,
# the jobs that run against a merged commit, and the one event gate that keeps the
# pull-request-only job off it.
#
# A merged commit cannot be amended. The ruleset's strict required status checks
# make a normal squash merge produce the tree its pull_request run already gated,
# so this lane covers what can still diverge — an owner-bypass merge, a direct push,
# a verdict that changes with time, a run cut short — and runs the whole matrix
# except `commits`: the whole-repository lanes, the lanes `plan` selects from the
# merged diff, and the two aggregates. Those `if:` expressions ARE the selection, so
# they are read here rather than described — and the tables below must cover every
# job in the file, so a job added later cannot reach a merged commit by default.
require "minitest/autorun"
require "psych"

class MergedCommitLaneTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOW = "pr-verification.yml"
  ALERT = "alert-failure"
  # The lanes whose subject is the committed text of the repository rather than a
  # diff: repository contracts, documentation hygiene, the six security jobs, and
  # the two aggregates that carry the required contexts.
  WHOLE_TREE = %w[aggregate contracts docs gitleaks osv security semgrep trufflehog zizmor].freeze
  # The lanes `plan` routes, by the merged diff itself: `github.event.before` is the
  # trunk tip the merge landed on and `github.sha` is the squash commit, so a merge
  # whose bytes differ from the pull request's still selects every package it
  # changed. Gated off the push, one of them going red would leave no verdict and no
  # alert — the hole #1715's review found in the first cut of this lane.
  DIFF_SELECTED = %w[affected db e2e foundation-install plan].freeze
  # The one lane whose subject is the pull request itself: the commits and the PR
  # title the merge consumes.
  PULL_REQUEST_ONLY = %w[commits].freeze
  PR_ONLY_GATE = "github.event_name != 'push'"
  # The refs a push run reads. `github.event.pull_request` and
  # `github.event.merge_group` are both absent on a push, so an expression drawing a
  # ref from either resolves to the empty string there, and the shell that consumes it
  # runs `git merge-base HEAD ""` — exit 128, a red lane on a correct `main`.
  # `CONTRACT_BASE_REF` shipped that way past this file (M2b); `plan`'s routing had
  # already been fixed, which is why the rule here is the class and not the variable.
  # `github.event.before` is the trunk tip a push landed on — its merge base with
  # `github.sha` is itself, so it is the document the merged commit is judged
  # against — and the head refs' fallback is `github.sha`, the merged commit.
  PUSH_BEFORE = "b170d05ea64796dfe811c62b12c7de4006643530"
  PUSH_SHA = "50ef4135dd4d9ef1b8c1745f0901fbd0af84fbc2"
  PUSH_PAYLOAD = { "github" => { "sha" => PUSH_SHA, "event" => { "before" => PUSH_BEFORE } } }.freeze
  BASE_REF = /github\.event\.(?:pull_request\.base\.sha|merge_group\.base_sha)/
  HEAD_REF = /github\.event\.(?:pull_request\.head\.sha|merge_group\.head_sha)/

  def workflow
    @workflow ||= Psych.safe_load(File.read(File.join(ROOT, ".github/workflows", WORKFLOW)), aliases: true)
  end

  def jobs
    workflow.fetch("jobs")
  end

  def events
    (workflow["on"] || workflow[true]).to_h
  end

  def condition(id)
    jobs.fetch(id, {})["if"].to_s
  end

  # GitHub resolves a property of an absent object to null and `||` to the first
  # operand that is neither null nor the empty string.
  def resolve(expression)
    operands = expression[/\$\{\{\s*(.+?)\s*\}\}/m, 1].split("||")
    operands.map { |operand| property(operand.strip) }.find { |value| !value.nil? && value != "" }
  end

  def property(path)
    path.split(".").reduce(PUSH_PAYLOAD) { |node, key| node.is_a?(Hash) ? node[key] : nil }
  end

  # The name and expression of every `env:`/`with:` value in a job that is not
  # gated off the push — the map a failing variable is named from.
  def named_expressions(job)
    scopes = [job["env"], *job.fetch("steps", []).flat_map { |step| [step["env"], step["with"]] }]
    scopes.compact.flat_map(&:to_a).select { |_name, value| value.is_a?(String) && value.include?("${{") }
  end

  def push_refs(pattern)
    jobs.reject { |_id, job| job["if"].to_s.include?(PR_ONLY_GATE) }
        .flat_map { |id, job| named_expressions(job).map { |name, value| [id, name, value] } }
        .select { |_id, _name, value| value.match?(pattern) }
  end

  def assert_push_refs(pattern, expected, fallback)
    refs = push_refs(pattern)
    refute_empty refs, "#{WORKFLOW}: nothing reads a pushed ref any more, so this test would pass vacuously"
    refs.each do |job, name, expression|
      assert_equal expected, resolve(expression),
                   "#{WORKFLOW}:#{job}: #{name} resolves to nothing on a push — both of its PR-only operands " \
                   "are absent — and the shell that reads it runs `git merge-base HEAD \"\"`; it needs the " \
                   "`#{fallback}` fallback"
    end
  end

  def test_the_merged_commit_lane_triggers_on_a_push_to_main
    push = events["push"]
    refute_nil push, "#{WORKFLOW}: nothing runs the suite against a merged commit without a push trigger (#1715)"
    assert_equal %w[main], push["branches"],
                 "#{WORKFLOW}: the merged-commit lane is the push to main, not a wider ref set"
  end

  def test_every_whole_tree_lane_runs_on_the_merged_commit
    WHOLE_TREE.each do |id|
      refute_nil jobs[id], "#{WORKFLOW}: #{id} is not a job"
      refute_includes condition(id), PR_ONLY_GATE,
                      "#{WORKFLOW}: #{id} asserts a property of the whole repository, so a merged commit must run it"
    end
  end

  def test_every_diff_selected_lane_runs_on_the_merged_commit
    DIFF_SELECTED.each do |id|
      refute_nil jobs[id], "#{WORKFLOW}: #{id} is not a job"
      refute_includes condition(id), PR_ONLY_GATE,
                      "#{WORKFLOW}: #{id} is selected by the merged diff, which a bypass merge or a direct push changes"
    end
  end

  def test_the_pull_request_only_lane_refuses_the_merged_commit
    PULL_REQUEST_ONLY.each do |id|
      refute_nil jobs[id], "#{WORKFLOW}: #{id} is not a job"
      assert_includes condition(id), PR_ONLY_GATE,
                      "#{WORKFLOW}: #{id} is not a verdict on a merged commit and must be gated off it"
    end
  end

  def test_every_base_ref_a_push_run_reads_falls_back_to_the_previous_tip
    assert_push_refs(BASE_REF, PUSH_BEFORE, "github.event.before")
  end

  def test_every_head_ref_a_push_run_reads_falls_back_to_the_merged_commit
    assert_push_refs(HEAD_REF, PUSH_SHA, "github.sha")
  end

  # The tables above are the selection. A job in none of them would land on a
  # merged commit by default and be omitted from the alerter's `needs`, which is
  # exactly how a lane goes red with nothing saying so.
  def test_the_selection_accounts_for_every_lane
    declared = WHOLE_TREE + DIFF_SELECTED + PULL_REQUEST_ONLY + [ALERT]
    assert_equal jobs.keys.sort, declared.sort,
                 "#{WORKFLOW}: a job whose event routing is undeclared lands on a merged commit by default"
  end
end
