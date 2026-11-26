# Apply production topology without a full promotion

Status: accepted — the owner chose a topology-only production path on 2026-11-25; the design recorded here was accepted with its pull request.
This amends [ADR 0007](0007-selected-release-artifacts.md): the full promotion stays the only path
that deploys production Workers, migrates and publishes, and a second production path now applies
the topology program alone. ADR 0007's selection, admission and receipt rules otherwise stand.

## Context

Until now the prod stack's topology was applied only inside `cd.yml`'s `promote-production` job,
between database access and the migration chain, so the domain could not move without the whole
production upgrade. No run of that job has succeeded: the GitHub `production` environment holds 251
deployments since 2026-08-24, none successful, and no production job has run since 2026-09-23. A
failed run may still have applied the stack, because its topology apply and its service publication
come before the smoke, and the smoke probes an apex that has no DNS record. Nobody knows what the
prod stack's last apply left, so the first topology run may change far more than the domain.

On 2026-11-25 the owner chose to add a production job that runs only the domain changes. The rest
of this record is the design for it.

## Decision

`.github/workflows/production-topology.yml` applies the selected snapshot's
`release/foundation/infra` program to the prod stack and nothing else. It never deploys a Worker,
runs a migration, applies database access, publishes services, writes a production receipt or
touches the migration baseline and ledger the promotion's migrator checks.

- **Dispatch.** `workflow_dispatch` on `main` with an existing `artifact_id`, the
  `staging_receipt_id` of the staging receipt that snapshot's own CD run published, `apply` and
  `show_diff` (both default `false`). Only the owner dispatches it; agents never dispatch a production
  workflow.
- **`select`**, with no environment: refuse while a full promotion is running, resolve and
  verify the snapshot as `cd.yml` does, and accept the staging receipt (below). A bad dispatch fails
  before any approval prompt.
- **`apply-topology`**, under `environment: production`, so the owner approves every run: repeat the
  verification bound to the digests `select` saw, log into Pulumi Cloud and open the prod ESC
  environment as the full promotion does, install the sealed foundation, and preview the topology
  program on `lifeodyssey/prod` into the job summary. With `apply: true` it checks for a promotion
  again and then runs `pulumi up`.

### The staging receipt of an earlier run

`verify-receipt.rb` binds a receipt to the controller run that verifies it, and the receipt's
selection includes that controller's SHA, which moves with every main push. A topology run reads a
receipt an earlier CD run published, so `.github/scripts/release/verify-staged-receipt.rb` accepts
one only when it:

1. was produced by a `cd.yml` run attempt on `main` in this repository;
2. is named `staging-receipt-<run>-<attempt>` for that run, and the receipt records that attempt;
3. is unexpired; the artifact is kept 14 days;
4. carries a digest that the official download checks (`digest-mismatch: error`) and that has not
   changed between `select` and `apply-topology`;
5. passes `ReleaseReceipt.validate` for that run and attempt;
6. records the same selection except `controller_sha`, and that controller SHA is in this
   controller's history.

### Run 0 and the preview

Run 0 is preview only. The owner dispatches with `apply` left `false`, reads the preview in the job
summary, and only then dispatches a run with `apply: true`. A preview that shows any deletion stops
the work until it is decided separately: nobody knows what the prod stack holds. The preview diffs
the program against the stack's recorded state, as the full promotion's apply does; it does not
refresh it from Cloudflare.

No saved plan binds the apply to the preview. Pulumi documents update plans as an experimental
feature that is opt-in ([update plans](https://www.pulumi.com/docs/iac/operations/stack-management/update-plans/)),
and `pulumi up --plan` is marked experimental
([`pulumi up`](https://www.pulumi.com/docs/iac/cli/commands/pulumi_up/)). Revisit this later; in a
run with `apply: true` the preview and the apply are seconds apart in one job.

### Concurrency

The topology job holds its own group, `production-topology`, not `cd-production`. This deviates from
the first design, which shared the full promotion's group. Sharing it made the owner reject a pending
full promotion before every topology run: a `CD / production` job parked at its approval prompt
holds the group (`docs/agents/delivery-flow.md`), so a topology job would queue behind it, and GitHub
keeps one pending job per group, so the next merge's promotion would replace the queued topology run.

A refusal keeps the two apart instead: the topology run refuses while a full promotion is running.
`.github/scripts/release/refuse-during-promotion.rb` lists every unfinished `cd.yml` run and fails
the topology run, naming the run, while a `CD / production` job is `in_progress`, `queued` or
`requested`. It runs in `select` and again immediately before `pulumi up`. It skips `waiting` and
`pending`, which cannot run without the owner's approval. Checked against the API on 2026-11-25, there
is usually one of each: a `waiting` job, the promotion parked at the approval prompt and holding the
`cd-production` group (run 44466402255, from 2026-11-19), and a `pending` job, the latest merge's
promotion queued behind that group, which each new merge replaces (run 45573231290's was cancelled
that way). A pending job, once the group frees, stops at the approval prompt first. So the owner no
longer rejects a parked promotion to run the topology, the reason for the separate group. Waiting and
pending runs are still listed, because a listed status is a snapshot: a promotion approved after the
listing is caught when its jobs are read. They are listed before the running statuses, so a run an
approval moves during the check is in the waiting listing, already read, or in a running listing
read after it, never between the two.

The residual risk is that the owner approves a waiting promotion while a topology run is in
progress. Four things stand against it:

- the two prompts have different names, "Production topology / apply" and "CD / production";
- the runbook and the owner packet say plainly: don't approve a `CD / production` while a topology
  run is in progress;
- Pulumi Cloud lets only one update hold a stack at a time
  ([update conflicts](https://www.pulumi.com/docs/support/troubleshooting/common-issues/update-conflicts/)),
  so the later of the two topology updates on `lifeodyssey/prod` fails rather than interleaving,
  although the promotion's steps before its topology apply would run;
- today a promotion stops at its first step, because the production migrator URL is absent
  (`cd.yml`'s "Require the production migrator URL").

The reverse direction is not enforced: `cd.yml` is unchanged, and its production job does not look
for a topology run.

### Why `cd.yml` is untouched

A topology job inside `cd.yml` would get a same-run receipt only by running `stage` again, which
redeploys staging, and rolls staging back when the selected snapshot is older than the one it runs.
It would also gate the full promotion's jobs on a new input and rewrite the contracts that pin
`cd.yml`'s job graph and credential holders. A separate workflow leaves the full promotion as it is.

## Consequences and limits

- **Staged configuration.** Each step is one pull request to `infra/Pulumi.prod.yaml`, then the
  snapshot its merge builds, the staging receipt that snapshot's CD run publishes, and one dispatch:
  step 1 `cloudflareZoneId` (DNSSEC, the `/v1/*` rate limit and HSTS, zone-wide); step 2 `webDomain`
  with `wwwDomain` (the four apex CAA records; `wwwDomain` is read only once the next step flips the
  flag); step 3 `webRoutesEnabled`, the launch.
- **Accepted risk: a red staging leaves no rollback path.** Going back is a revert, which needs a new
  snapshot and its staging receipt, or a dispatch of an older snapshot that still has an unexpired
  staging receipt. Both need a snapshot with a staging receipt, and both artifacts expire after 14
  days.
- **The rate limit covers staging's zone hostname.** Step 1's `/v1/*` rule has no host match, so it
  also covers the staging hostname, which lives in the same zone. CD's staging smoke and probes use the
  workers.dev origins, which are outside the zone.
- **Step 3 publishes the apex onto Worker scripts this workflow never deploys.** The Custom Domain and
  routes bind production's `animichi-web` and `animichi` by name. No promotion has succeeded, but a
  failed one may have published them before its smoke. Whether they exist and what they serve can be
  checked only with the owner's Cloudflare access, before step 3.
- **The default preview prints no values.** The run's log and job summary sit in a public
  repository, which any signed-in GitHub account can read
  ([workflow run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)).
  Without `--diff`, the preview lists each resource's operation and, for an update, only the names
  of the changed top-level properties ([pulumi/pulumi#5079](https://github.com/pulumi/pulumi/issues/5079)),
  so a deletion still shows and still stops the work. Both Pulumi steps set `suppress-outputs`,
  which hides stack outputs and nothing else
  ([`pulumi preview`](https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/)). The
  `show_diff` input turns on the full property diff, values included: values marked secret print
  masked, but a value stored unmarked prints in the clear (`infra/AGENTS.md`). So `show_diff: true`
  is set only after confirming that every sensitive value in the prod stack's config and in its ESC
  environment is marked secret.
- **The owner checks before run 0** that "Prevent self-review" is off on the `production` environment:
  with it on, the owner cannot approve a run the owner dispatched, and nobody else dispatches it.
- The workflow uses the `$/` hydration action, so `.github/actionlint.yaml` carries one more ignore
  entry, approved through the pull request that adds the workflow.
