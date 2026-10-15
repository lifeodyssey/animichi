# SUT: pr-verification.yml's draft gate — the pull_request activity types that
# re-run the lanes when a draft is converted to ready, and the per-lane
# condition that keeps every lane off a draft PR so review happens before CI
# starts (Linear spec ZDEV-48: the review happens on the draft PR, and CI
# starts when it turns ready).
#
# A draft PR is the review phase: the controller opens it, reviewers leave
# threads, and no lane has a verdict worth spending a runner on. The one gate
# that keeps a lane off a draft reads "not a pull_request, or the pull_request
# is not a draft". `github.event.pull_request` is absent on a push and a
# merge_group, so a gate that read `github.event.pull_request.draft == false`
# alone would be false there and would silently disable the merged-commit lane
# (#1715). The `github.event_name != 'pull_request'` disjunct is what keeps
# push and merge_group open; asserting the two halves joined by `||` means a
# later edit cannot turn the disjunction into a conjunction, flip a comparison,
# or drop the event guard without failing here.
#
# A lane skips a draft only if its whole `if:` is false there, and text that
# merely contains the gate does not promise that: `<gate> || true` and
# `always() || (<gate>)` keep the gate and still run on a draft. So the gate is
# read as a term of the `if:`, not as text in it: the `if:` is the gate alone,
# or a conjunction with the gate as a parenthesised term, and no `||` is left
# at the top level for anything else to open the lane on a draft.
require "minitest/autorun"
require "psych"

class PrVerificationDraftTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOW = File.join(ROOT, ".github/workflows/pr-verification.yml")
  # The gate in one piece: "not a pull_request" (keeps push and merge_group
  # open, where github.event.pull_request is absent) OR "the pull_request is
  # not a draft" (closes only a draft pull_request).
  DRAFT_GATE = "github.event_name != 'pull_request' || github.event.pull_request.draft == false".freeze
  # While an `if:` is read, the gate is one token. It counts as the whole `if:`
  # or as a parenthesised `&&` term: bare inside a conjunction it would bind as
  # `(a && <event guard>) || <draft check>`, which a ready PR satisfies whatever
  # `a` says.
  GATE_MARK = "DRAFT_GATE_MARK".freeze
  WHOLE_GATE = /\A#{Regexp.escape(DRAFT_GATE)}\z/
  # How a parenthesis changes the number of open ones.
  OPENED = { "(" => 1, ")" => -1 }.freeze
  # The alert-failure lane gates itself to the push event (failure-alert.test.rb
  # pins that), so it is the one job the draft gate does not apply to. Every
  # other job is a lane whose verdict a draft PR must not spend a runner on.
  ALERT = "alert-failure".freeze
  # The two required status checks the ruleset names (strict_required_status_checks_policy):
  # the aggregate named "PR Verification" and the security aggregate named "Security".
  REQUIRED_CONTEXTS = { "aggregate" => "PR Verification", "security" => "Security" }.freeze

  def workflow
    @workflow ||= Psych.safe_load(File.read(WORKFLOW), aliases: true)
  end

  def jobs
    workflow.fetch("jobs")
  end

  def pull_request_types
    ((workflow["on"] || workflow[true]).fetch("pull_request") || {}).fetch("types", [])
  end

  def condition(id)
    jobs.fetch(id, {}).fetch("if", "").to_s
  end

  # Each quoted string, emptied to `''` so the words around it stay apart. Every
  # quote toggles into or out of a string, so the even-numbered pieces are the
  # ones outside; a doubled quote inside a string toggles twice around an empty
  # piece. An unterminated quote swallows the rest; actionlint rejects such an
  # expression anyway.
  def without_strings(text)
    text.split("'", -1).each_slice(2).map(&:first).join("''")
  end

  # The number of parentheses open before each character, as a running sum.
  def depth_before(text)
    text.each_char.inject([0]) { |depths, char| depths << depths.last + OPENED.fetch(char, 0) }
  end

  # The text with every parenthesised group dropped but its opening `(`. One
  # pass over the characters, not a recursive regex: nesting needs recursion
  # there, and it backtracks badly on a long run of `(` (CodeQL rb/redos).
  def outside_parentheses(text)
    text.each_char.zip(depth_before(text)).select { |_char, depth| depth.zero? }.map(&:first).join
  end

  # The `if:` without its `${{ }}` wrapper, seen from its top level: the gate is
  # one token, and with strings and groups gone every `&&` and `||` that remains
  # is the expression's own. `&&` binds tighter than `||`, so one `||` left over
  # makes the whole expression a disjunction, which its other side can open on
  # a draft. Text outside the wrapper stays in, so it cannot pass for the gate.
  def top_level(id)
    expression = condition(id).sub(/\A\$\{\{\s*(.*?)\s*\}\}\z/, '\1')
    marked = expression.gsub("(#{DRAFT_GATE})", GATE_MARK).sub(WHOLE_GATE, GATE_MARK)
    outside_parentheses(without_strings(marked))
  end

  def assert_skips_a_draft(id)
    top = top_level(id)
    refute_includes top, "||",
                    "pr-verification.yml:#{id}: a top-level `||` outside a parenthesised gate can run this lane " \
                    "on a draft PR: #{condition(id)}"
    assert_includes top.split("&&").map(&:strip), GATE_MARK,
                    "pr-verification.yml:#{id}: a draft PR must not run this lane; its `if:` must be the gate, or " \
                    "`&&` it as a parenthesised term: #{condition(id)}"
  end

  def test_a_draft_to_ready_conversion_wakes_the_lanes
    types = pull_request_types
    refute_empty types, "pr-verification.yml: the pull_request trigger has no activity types to pin"
    assert_includes types, "ready_for_review",
                    "pr-verification.yml: a draft converted to ready must re-run the lanes that skipped on the " \
                    "draft; without ready_for_review the first ready run never happens"
    assert_includes types, "converted_to_draft",
                    "pr-verification.yml: a ready PR converted back to draft must re-evaluate the gate and skip " \
                    "the lanes again"
  end

  def test_every_lane_skips_a_draft_pull_request
    gated = jobs.keys - [ALERT]
    refute_empty gated, "pr-verification.yml: no lanes to gate; this test would pass with its subject deleted"
    gated.each { |id| assert_skips_a_draft(id) }
  end

  def test_the_required_contexts_skip_a_draft_and_keep_their_aggregate_guard
    REQUIRED_CONTEXTS.each do |id, name|
      refute_nil jobs[id], "pr-verification.yml: no #{id} job carries the required context #{name}"
      assert_equal name, jobs[id]["name"], "pr-verification.yml:#{id}: the required context #{name} moved"
      assert_includes condition(id), "always()",
                      "pr-verification.yml:#{id}: must still run always() to fail on a failed or cancelled dependency"
      assert_skips_a_draft(id)
    end
  end
end
