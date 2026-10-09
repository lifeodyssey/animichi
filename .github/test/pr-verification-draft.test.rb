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
require "minitest/autorun"
require "psych"

class PrVerificationDraftTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOW = File.join(ROOT, ".github/workflows/pr-verification.yml")
  # The gate in one piece: "not a pull_request" (keeps push and merge_group
  # open, where github.event.pull_request is absent) OR "the pull_request is
  # not a draft" (closes only a draft pull_request).
  DRAFT_GATE = "github.event_name != 'pull_request' || github.event.pull_request.draft == false".freeze
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
    gated.each do |id|
      assert_includes condition(id), DRAFT_GATE,
                      "pr-verification.yml:#{id}: a draft PR must not run this lane; its `if:` needs `#{DRAFT_GATE}`"
    end
  end

  def test_the_required_contexts_skip_a_draft_and_keep_their_aggregate_guard
    REQUIRED_CONTEXTS.each do |id, name|
      refute_nil jobs[id], "pr-verification.yml: no #{id} job carries the required context #{name}"
      assert_equal name, jobs[id]["name"], "pr-verification.yml:#{id}: the required context #{name} moved"
      assert_includes condition(id), "always()",
                      "pr-verification.yml:#{id}: must still run always() to fail on a failed or cancelled dependency"
      assert_includes condition(id), DRAFT_GATE,
                      "pr-verification.yml:#{id}: the required context #{name} must skip on a draft PR"
    end
  end
end
