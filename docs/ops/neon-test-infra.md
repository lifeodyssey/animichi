# Neon Test Infrastructure Runbook

This runbook covers `test-base` maintenance, the Workers' dev branch, branch quota, and cleanup.
No CI lane holds a Neon credential (#1053). The Python agent's pytest database arms (offline Docker,
live Neon, BYO) and its Neon Local proxy (`make dev-db`) were deleted with the agent (#1607); the
TypeScript suites boot their offline database through `packages/test-postgres`. `test-base`'s
refresh workflow and script are retired — the branch itself remains in Neon as data and is refreshed
manually with a personal `NEON_API_KEY`.

## Workers dev branch

The catalog and users Workers use a standing cloud dev branch.
For `wrangler dev`, create a standing branch once with
`neonctl branches create --name dev/<name> --parent test-base`, then mint/find its real cloud DSN
with `neonctl connection-string dev/<name>`. Put that secret in the Worker's ignored `.dev.vars`.

## Refreshing `test-base`

The refresh path is non-destructive: it verifies the exact branch name, ID, parent project, and
project ID; applies the committed migration chain; reapplies the idempotent seeds (gazetteer
seed first, then the fixture seed); and restores the service-role grants. It never runs the
provisioner's database-wipe path.

`.github/workflows/neon-test-base.yml` and `scripts/neon-test-base.sh` were **retired** with the
test-infra retirement (#1053): no CI lane may mint a Neon DSN, so the branch is refreshed
manually whenever its schema/seed moves. The script no longer ships in the tree; recover the
retired script from git history to refresh:
```bash
git show <pre-retirement-sha>:scripts/neon-test-base.sh > /tmp/neon-test-base.sh && chmod +x /tmp/neon-test-base.sh
export NEON_API_KEY='<personal-secret>'
export NEON_PROJECT_ID='<project-id>'
/tmp/neon-test-base.sh refresh test-base
```
Refresh manually after a change to the migration chain or `workers/catalog/data/gazetteer_seed.sql`.
The retired script applied the Atlas chain that #1636 deleted, so recovering it now also means
repointing its apply step at the Prisma chain.
The fixture seed the retired script also reapplied lived in the Python agent's tree and left with it
(#1607); recover it from the same pre-retirement commit when a refresh needs it. Use `provision test-base` only for an owner-approved
deterministic rebuild; that mode drops and recreates the target database after the same identity
rails pass. The branch itself stays in Neon (it is data), but nothing in CI references it.

## Migration source rule

`packages/pi-session-neon/` is the integration-test and Neon data-plane **schema** source. New
catalog/user changes are authored in its contract, and its artifacts are regenerated in the same
change. The
older `supabase/migrations/` files are archived/historical (issue #1000) and are not an apply or
source surface; do not create an auth-stripped twin or copy a new data-plane change into both trees.
The gazetteer seed is **not** a migration — it lives at `workers/catalog/data/gazetteer_seed.sql`
and is loaded idempotently (`make seed-gazetteer`; the retired test-base refresh script also
loaded it) after the schema exists.

Never reintroduce migration splitting, statement filtering, pgvector neutralization, or swallowed
migration failures. Prisma owns ordering, artifact hashes, transactions, its advisory lock and the
marker (`prisma_contract.marker`).

## Quota and plan semantics

Budget against 10 concurrent branches in this project:

- Standing: `main` + `staging` + `test-base` + zero or one dev branch.
- Ephemeral: none. No CI lane (#1053) and no local test arm (#1607) opens a Neon branch.

Check the Neon Console before creating a branch. The Free plan has no paid-overage escape hatch, so treat its
included allowance as a hard operating cap. Launch includes 10 branches and bills
extra concurrent branches by prorated branch-hours; current rates and allowances live on the
[Neon pricing page](https://neon.com/pricing). Phase-0 account-level cap behavior remains an
operator observation: record quota-class failures separately from code failures.

## Stray branch cleanup

Stop the owning local containers and CI jobs first. Resolve `NEON_TEST_BASE_BRANCH_ID` by exact
name, then re-fetch that branch by ID and verify `name == test-base` and
`project_id == NEON_PROJECT_ID`. Audit every child before deletion; a child not named `wt-test-*`
is never a cleanup candidate:

```bash
curl -fsS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?limit=10000" \
  | jq -r --arg parent "$NEON_TEST_BASE_BRANCH_ID" \
    '.branches[] | select(.parent_id == $parent) | [.id, .name, (if (.name | startswith("wt-test-")) then "candidate" else "KEEP" end)] | @tsv'
```

After reviewing that delta, this guarded cleanup pipeline deletes only claimed children whose
compute endpoints are all idle. It re-fetches each candidate by ID and verifies the name and parent
again immediately before DELETE:

```bash
curl -fsS -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?limit=10000" | jq -r --arg parent "$NEON_TEST_BASE_BRANCH_ID" '.branches[] | select(.parent_id == $parent and (.name | startswith("wt-test-"))) | [.id, .name] | @tsv' | while IFS="$(printf '\t')" read -r id name; do detail="$(curl -fsS -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$id")"; endpoints="$(curl -fsS -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$id/endpoints")"; jq -e --arg id "$id" --arg name "$name" --arg parent "$NEON_TEST_BASE_BRANCH_ID" '.branch.id == $id and .branch.name == $name and .branch.parent_id == $parent and (.branch.name | startswith("wt-test-"))' <<<"$detail" >/dev/null && jq -e '.endpoints | all(.current_state == "idle")' <<<"$endpoints" >/dev/null && curl -fsS -X DELETE -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$id" >/dev/null; done
```

This mirrors the parent/name ownership pattern of the retired Python fixture's
`delete_claimed_branch`: list-delta discovery is only a hint;
the deletion authority comes from the per-ID identity re-verification. Neon documents `parent_id`
as the parent branch ID in its [branch API](https://api-docs.neon.tech/reference/listprojectbranches)
and rejects deletion of branches that still have children.
