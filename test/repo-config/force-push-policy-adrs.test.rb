# SUT: the force-push policy ADRs. ADR 0005 stands as untouched history under its amendment
# note; ADR 0009 is the standing policy and quotes the controller's 2026-10-09 `gh api` read
# of the one branch ruleset (`protect main`). Both files are pinned byte-for-byte: DOCS_POLICY
# amends an ADR via a new one, so the recorded text itself is the contract — a policy record
# that drifts from what the platform enforces, or a history that is quietly rewritten, sends
# the next reader to push a way the platform refuses (review 2: paraphrases survived scans).
require "json"
require "minitest/autorun"

class ForcePushPolicyAdrsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  ADR_0005 = File.join(ROOT, "docs/adr/0005-repo-force-push-policy.md")
  ADR_0009 = File.join(ROOT, "docs/adr/0009-branch-updates-merge-only.md")

  # The controller's `gh api` read of ruleset `protect main`, 2026-10-09 — the key fields,
  # with the rules list and the pull_request / required_status_checks parameters flattened
  # one level. ADR 0009 quotes this block; when the platform's shape changes, this literal
  # and the quote move together, on purpose.
  READ = {
    "name" => "protect main",
    "target" => "branch",
    "enforcement" => "active",
    "conditions" => {"ref_name" => {"include" => ["~DEFAULT_BRANCH"], "exclude" => []}},
    "rules" => ["deletion", "non_fast_forward", "required_linear_history"],
    "allowed_merge_methods" => ["squash"],
    "required_status_checks" => {"checks" => ["PR Verification", "Security"], "strict" => true},
    "bypass_actors" => [{"actor_id" => 25764181, "actor_type" => "User",
                         "bypass_mode" => "pull_request"}],
  }.freeze

  def test_adr_0005_stands_as_untouched_history
    assert_equal EXPECTED_0005, File.read(ADR_0005),
                 "ADR 0005 was edited in place; DOCS_POLICY amends via a new ADR, so the first " \
                 "version's text stays byte-for-byte under its amendment note"
  end

  def test_adr_0009_quotes_the_ruleset_read
    quote = File.read(ADR_0009)[/```json\n(.*?)```/m, 1]
    assert quote, "ADR 0009 carries no ruleset-read quote to answer to"
    assert_equal READ, JSON.parse(quote),
                 "ADR 0009's ruleset quote drifted from the 2026-10-09 read"
  end

  def test_adr_0009_is_the_standing_record_verbatim
    assert_equal EXPECTED_0009, File.read(ADR_0009),
                 "ADR 0009 drifted from its accepted text; the read quote, the Decision and " \
                 "their prose are one record and stand or fall together"
  end

  # The two ADR files as accepted, byte for byte — ADR 0005's first version with its
  # amendment note in front, ADR 0009 as written. The heredocs are the base text.
  EXPECTED_0005 = <<~ADR
    # Repository force-push policy: all branches protected, owner-authorized rewrites only

    > **Status**: amended 2026-10-09 by [ADR 0009](0009-branch-updates-merge-only.md) — the scope this ADR claims is wider than the ruleset carries; the original text below stands as history, ADR 0009 is the standing policy.

    The skeleton-refactor campaign force-pushed feature branches continuously (`rebase + push --force-with-lease`), and the history-rewrite wave (restructure W6 + GOAL W8) will force-push `main`. The GitHub ruleset `protect main` already blocks force-push on the default branch; feature branches were unprotected.

    ## Decision

    - The `non_fast_forward` and `deletion` rules extend to **all branches** (ruleset pattern `*`), with **bypass actors = owner only** (`lifeodyssey`).
    - Daily workflow no longer uses local force-push: updating a feature branch against `main` is `git merge origin/main` + a normal push; PRs merge via GitHub **squash** merge (one commit per PR; the ruleset `pull_request.allowed_merge_methods = ["squash"]` — amended from rebase on 2026-08-08 — and `required_linear_history` keeps the log linear).
    - A rewrite (W8 daily-squash, restructure W6 binary strip, or any forced update) is executed only inside the approved **history-rewrite window**: freeze declaration → double backup (git bundle + private archive repo) → rewrite → force-push as owner bypass → CI green + staging re-deploy evidence → `main-legacy` retained ≥30 days. The runbook is `docs/ops/git-daily-squash-runbook.md`.
    - `--no-verify` pushes are not technically blockable server-side; CI remains the terminal gate (it runs the same checks the local hooks run), and the policy is documented here and in the runbook.

    ## Why

    - Force-push races and rebase churn cost real time during the campaign; a protected-by-default posture is the industry baseline.
    - The rewrite window needs a single, documented, auditable exception path instead of ad-hoc force-pushes.

    ## Consequences

    - All future branch updates use merge (or `gh pr update-branch`); `git push --force-with-lease` is only valid with explicit owner approval (recorded in the runbook checklist).
    - The ruleset gains bypass actors; org-level rulesets are not required.
    - Hooks: pre-push continues to run local gates; CI (`required_status_checks`) is unchanged.
  ADR

  EXPECTED_0009 = <<~ADR
    # Branch updates merge `main` in; `non_fast_forward` and `deletion` protect `main` only; agents and controllers never force-push

    > **Status**: accepted 2026-10-09 (ZDEV-51). Amends
    > [ADR 0005](0005-repo-force-push-policy.md), whose first version claims a wider ruleset scope
    > than the platform carries; that text stands as history under an amendment note, this ADR is
    > the standing policy.

    The 2026-10-09 API read of the repository's one branch ruleset settles what the platform
    enforces. ADR 0005's first version recorded a scope the ruleset does not carry (a `*` ref
    pattern the read does not show); the owner's decision the same day adds the
    rule the platform leaves open: stacked PRs are retired, and nobody force-pushes — the repository's
    own word is what protects a feature branch.

    ## The read (2026-10-09, `gh api`, key fields)

    ```json
    {
      "name": "protect main",
      "target": "branch",
      "enforcement": "active",
      "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
      "rules": ["deletion", "non_fast_forward", "required_linear_history"],
      "allowed_merge_methods": ["squash"],
      "required_status_checks": {"checks": ["PR Verification", "Security"], "strict": true},
      "bypass_actors": [{"actor_id": 25764181, "actor_type": "User", "bypass_mode": "pull_request"}]
    }
    ```

    ## Decision

    - **`non_fast_forward` and `deletion` protect `main` only.** The read's ref condition is
      `~DEFAULT_BRANCH`; the ruleset does not reach a feature branch — the never-rule below is what
      binds one.
    - **Agents and controllers never force-push — not to `main`, not to a feature branch, and not with `--force-with-lease`.** Updating a branch is `git merge origin/main` + a normal push, or
      `gh pr update-branch`.
    - **No stacked PRs** (owner, 2026-10-09): a story that depends on an in-flight story waits for
      that story's PR to land on `main`, then takes the same merge against the fresh head. One story
      stays one PR (`docs/agents/delivery-flow.md`).
    - PRs merge by GitHub **squash** (`allowed_merge_methods = ["squash"]`,
      `required_linear_history`) behind the read's required checks (`PR Verification`, `Security`,
      strict). The owner's approved history-rewrite window (ADR 0005) remains the one sanctioned
      rewrite of `main`, run by the owner alone.

    ## Why

    - The platform's scope is what the API returns, not what a campaign draft aimed at. ADR 0005's
      first version recorded the aim; the 2026-10-09 read settles the fact — and policy that
      misstates the platform sends the next reader to push a way the platform refuses.
    - Merge-based updates keep the log linear without history rewrites; a blocked story waits for
      its blocker to land, which is cheaper than a stack that costs a restack per merge.

    ## Consequences

    - A forced update of any kind happens only inside the owner's window; the runbook checklist and
      `main-legacy` retention (`docs/ops/git-daily-squash-runbook.md`) are unchanged.
    - The read's one bypass actor is the owner, and `bypass_mode: "pull_request"` means a bypass
      rides an approved PR, not a direct push.
    - Feature branches stay outside the ruleset's reach; this ADR's never-rule is the protection
      they have.
  ADR
end
