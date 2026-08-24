# Required-check ruleset cutover

The target ruleset requires exactly `CI / verify` and the classic commit status
`Review Gate`. The same atomic `PUT` removes GitHub native `code_quality` and
`code_coverage`: native Code Quality is unavailable for this repository, so
retaining those rules would preserve a hidden merge blocker. Every other
effective protection rule, enforcement mode, bypass actor, and branch condition
is preserved except the existing pull-request rule is atomically strengthened
to require review-thread resolution. `Review Gate` is source-bound to the
GitHub Actions App integration (`integration_id=15368`).

This procedure does not change Actions subscriptions, bypass the ruleset, use
`--admin`, or deploy application code.

## 1. Capture the recovery snapshot

```bash
mkdir -p /tmp/animichi-ruleset-cutover
gh api repos/lifeodyssey/animichi/rulesets/19974534 \
  > /tmp/animichi-ruleset-cutover/ruleset-live.json
ruby .github/scripts/ruleset_cutover.rb snapshot \
  /tmp/animichi-ruleset-cutover/ruleset-live.json \
  /tmp/animichi-ruleset-cutover/ruleset-before.json \
  repos/lifeodyssey/animichi/rulesets/19974534
```

Retain the printed snapshot SHA-256. Apply re-reads the live ruleset and refuses
the PUT if this digest no longer matches. The snapshot contains the complete
pre-change rule array and recovery metadata.

## 2. Capture one content-addressed canary

Do not compose `canary.json` by hand. After the final producer workflows have
run successfully, identify an open PR number and the successful merge-group CI
run id, then capture the evidence through GitHub APIs:

```bash
ruby .github/scripts/ruleset_cutover.rb capture \
  /tmp/animichi-ruleset-cutover/canary.json \
  lifeodyssey/animichi 19974534 PR_NUMBER MERGE_GROUP_CI_RUN_ID
```

Retain the printed digest. Capture resolves the PR's current head and the
merge-group SHA from GitHub, then requires on each SHA:

- exactly one successful GitHub Actions `CI / verify` check-run;
- a successful classic `Review Gate` commit status;
- a `Review Gate` status created by `github-actions[bot]`, with its target URL
  resolving to the trusted producer run;
- a producer Actions run identified by the check/status URL;
- `.github/workflows/pr-verification.yml` with the corresponding
  `pull_request` or `merge_group` event for CI;
- `.github/workflows/review-gate.yml` running from the repository default
  branch for Review Gate; merge-group evidence accepts only its trusted
  `workflow_run` bridge, while PR evidence permits the PR-class refresh events.

The artifact records the check/status ids, producer run ids, workflow paths,
events, branches, and SHAs. `apply` checks its content digest and then repeats
all API observations immediately before PUT, including the PR's current head
and the supplied merge-group run identity. A hand-written internally
consistent artifact cannot authorize a mutation.

## 3. Perform the single guarded PUT

```bash
export RULESET_CUTOVER_APPLY=1
export RULESET_CUTOVER_CONFIRM=REPLACE_REQUIRED_CHECKS_ONCE
ruby .github/scripts/ruleset_cutover.rb apply \
  lifeodyssey/animichi 19974534 \
  /tmp/animichi-ruleset-cutover \
  SNAPSHOT_SHA256 \
  /tmp/animichi-ruleset-cutover/canary.json \
  CANARY_SHA256
```

`apply` cannot run without both content digests. It validates the artifact,
re-validates the live snapshot, prepares the exact payload, re-captures and
matches GitHub evidence, performs one PUT, then reads the ruleset back. The after-read must contain exactly the two
contexts, source-bind `Review Gate` to integration 15368, require native review
thread resolution, contain neither native quality rule, and preserve all other
protections. A failed after-read removes any earlier green `ruleset-after.json`.

Retain `ruleset-before.json`, `ruleset-canary.json`, `ruleset-payload.json`, and
`ruleset-after.json`. The final artifact records both the recovery snapshot
digest and canary digest. If any preflight check fails, capture new evidence;
never hand-edit a failed artifact into a green one.

The machine-readable target is
[ruleset-cutover-target.json](../iterations/s0v2/ruleset-cutover-target.json).
