# Required-check ruleset cutover

Issue #1180 owns the one-time transition from the current per-lane ruleset to
three PR-level aggregators:

- `PR Verification`
- `Security`
- `Review Gate`

This runbook is deliberately operator-gated. The repository contract tests are
hermetic and do not change the live ruleset. The live operation is allowed only
after #1176, #1177, and #1178 are merged and their current-head checks have
been observed on `main`.

Until the one-shot PUT, the live ruleset still requires `Quality / invariants`.
`pipeline-quality.yml` therefore emits the target `Review Gate` job and a
`legacy-quality` wrapper that mirrors its result; the wrapper is removed after
the live ruleset requires the three target contexts.

## Dry-run and recovery snapshot

The snapshot is the recovery artifact, not a prose description. Capture the
API response before generating a candidate:

```bash
mkdir -p /tmp/animichi-ruleset-cutover
gh api repos/lifeodyssey/animichi/rulesets/19974534 \
  > /tmp/animichi-ruleset-cutover/ruleset-live.json
ruby .github/scripts/ruleset_cutover.rb snapshot \
  /tmp/animichi-ruleset-cutover/ruleset-live.json \
  /tmp/animichi-ruleset-cutover/ruleset-before.json \
  repos/lifeodyssey/animichi/rulesets/19974534
ruby .github/scripts/ruleset_cutover.rb candidate \
  /tmp/animichi-ruleset-cutover/ruleset-live.json \
  /tmp/animichi-ruleset-cutover/ruleset-payload.json
ruby .github/scripts/ruleset_cutover.rb validate \
  /tmp/animichi-ruleset-cutover/ruleset-payload.json
```

The snapshot records the complete pre-change rules, ruleset id/name, target,
source type, enforcement, bypass actors, branch conditions, and every pre-change
required context. Its
`actions_settings: not_requested` field is an explicit boundary: this process
does not call an Actions settings endpoint or unsubscribe notifications.

The candidate changes only `required_status_checks[*].context`. The payload
allowlist excludes read-only metadata such as `id` and rejects keys that could
represent Actions settings. Other rules, enforcement, bypass actors, and
branch conditions must remain equivalent under the contract; GitHub rule-array
reordering is tolerated, but a changed rule or protected field fails closed.

## One guarded PUT

Compute the snapshot digest from the command output or with the same library
used by the contract. The digest intentionally excludes `captured_at`, so a
fresh preflight snapshot can be compared with the retained recovery artifact.
Then run exactly one guarded operation:

```bash
export RULESET_CUTOVER_APPLY=1
export RULESET_CUTOVER_CONFIRM=REPLACE_REQUIRED_CHECKS_ONCE
ruby .github/scripts/ruleset_cutover.rb apply \
  lifeodyssey/animichi 19974534 \
  /tmp/animichi-ruleset-cutover \
  SNAPSHOT_DIGEST
```

The command re-reads the live ruleset, refuses a changed snapshot, writes the
before artifact and candidate payload, performs one `PUT`, reads the ruleset
again, and verifies the exact three contexts plus preservation invariants. It
writes `ruleset-after.json` only after the after-read passes. Retain
`ruleset-before.json`, `ruleset-payload.json`, and `ruleset-after.json` with the
launch evidence; do not replace a failed after-read with a manually edited
green artifact.

No `--admin` merge, ruleset bypass, branch protection deletion, or Actions
subscription change is part of this operation. If the preflight digest does
not match, stop and capture a new recovery snapshot for review.

## Negative canary and repaired-head evidence

After the PUT, open a deliberately failing, disposable pull request against
`main` and record the exact head SHA and which aggregate was deliberately made
to fail. Confirm that the PR cannot merge and close it without merging. Do not
use a canary as a bypass or merge-queue override.

The repaired-head record must show all three current-head aggregate states as
`success`, and only then may it state `repaired_eligible: true`. Validate the
record before retaining it:

```bash
ruby .github/scripts/ruleset_cutover.rb canary canary.json
```

The accepted evidence shape is:

```json
{
  "pr_number": 1,
  "head_sha": "<failing-canary-head>",
  "failing_context": "PR Verification",
  "blocked": true,
  "merged": false,
  "repaired_head_sha": "<repaired-current-head>",
  "repaired_statuses": {
    "PR Verification": "success",
    "Security": "success",
    "Review Gate": "success"
  },
  "repaired_eligible": true
}
```

The committed target is [ruleset-cutover-target.json](../iterations/s0v2/ruleset-cutover-target.json).
It is a static target and does not claim that the live PUT or canary has run;
those claims require the retained API and GitHub evidence described above.
