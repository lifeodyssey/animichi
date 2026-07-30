# Neon Test Infrastructure Runbook

This runbook covers the agent's three database-test arms, agent-only Neon Local development,
`test-base` maintenance, branch quota, and cleanup. The catalog and users Workers use a standing
cloud dev branch through neon-http; they do not use the agent's local postgres-wire proxy.

## Test arm selection

The pytest fixture selects exactly one arm per session:

| Selector | Arm | Mutation and lifecycle |
|---|---|---|
| `TEST_DATABASE_URL` | BYO | No container; read-verify first, then mutation gate |
| `TEST_DB=docker` | Offline | Testcontainers + cached derived PostGIS/pgvector image |
| `TEST_DB=neon` | Neon | Neon Local creates a child of `test-base`; tests use its direct cloud DSN |
| No selector | Offline default | Same as explicit `TEST_DB=docker` |

`TEST_DATABASE_URL` and `TEST_DB` together are an error. `TEST_DB=neon` requires
`NEON_API_KEY` and `NEON_PROJECT_ID`; credentials alone do not opt into live testing.

```bash
# One-time image build; this step needs network.
docker build -f docker/test-postgres/Dockerfile \
  -t animichi-test-postgres:16-3.4-pgvector-0.8.5 .

# Offline after the image and Atlas 0.30.0 are cached. Typical: 30-45 seconds.
ATLAS_VERSION=0.30.0 TEST_DB=docker make test-integration

# Live Neon arm. Typical: 6-7 minutes and one temporary branch.
ATLAS_VERSION=0.30.0 TEST_DB=neon \
  NEON_API_KEY="$NEON_API_KEY" NEON_PROJECT_ID="$NEON_PROJECT_ID" \
  make test-integration
```

The offline arm does not cover neon-http behavior, and the Neon arm is not offline. Unit tests and
the pre-push unit hook use neither arm and make no database connection.

## Agent-only Neon Local development

`make dev-db` maps the Neon Local postgres-wire endpoint to `localhost:5432`. It passes
`NEON_API_KEY` to Docker by environment name and never prints the secret. Branch selectors are
IDs, not names.

Choose one mode:

- Ephemeral: export the API-verified ID of the exact `test-base` branch as
  `NEON_TEST_BASE_BRANCH_ID`. Stopping the container deletes its child branch.
- Persistent: export a standing developer branch ID as `NEON_DEV_BRANCH_ID`. The wrapper sets
  `DELETE_BRANCH=false`, so stopping the container preserves that branch.

```bash
export NEON_API_KEY='<secret>'
export NEON_PROJECT_ID='<project-id>'

# Ephemeral child of test-base:
export NEON_TEST_BASE_BRANCH_ID='<verified-test-base-branch-id>'
unset NEON_DEV_BRANCH_ID
make dev-db

# Or persistent standing dev branch:
export NEON_DEV_BRANCH_ID='<standing-dev-branch-id>'
make dev-db
```

Point the Python backend at the static local DSN in another shell:

```bash
SUPABASE_DB_URL='postgresql://neon:npg@localhost:5432/neondb?sslmode=require' make serve
```

For `wrangler dev`, create a standing branch once with
`neonctl branches create --name dev/<name> --parent test-base`, then mint/find its real cloud DSN
with `neonctl connection-string dev/<name>`. Put that secret in the Worker's ignored `.dev.vars`.

## Refreshing `test-base`

The refresh path is non-destructive: it verifies the exact branch name, ID, parent project, and
project ID; applies `db/migrations/` with Atlas 0.30.0; reapplies the idempotent seed; and restores
the service-role grants. It never runs the provisioner's database-wipe path.

```bash
export NEON_API_KEY='<secret>'
export NEON_PROJECT_ID='<project-id>'
ATLAS_VERSION=0.30.0 scripts/neon-test-base.sh refresh test-base
```

Phase C's `.github/workflows/neon-test-base.yml` runs the same `refresh test-base` command after a
push to `main` that changes `db/migrations/**` or
`apps/agent/agent/tests/fixtures/seed.sql`. Use `provision test-base` only for an owner-approved
deterministic rebuild; that mode drops and recreates the target database after the same identity
rails pass.

## Twin-migration rule

`db/migrations/` is the integration-test schema source. Any new
`supabase/migrations/*.sql` migration that an integration test touches **must land in the same
change with an auth-stripped Atlas twin under `db/migrations/`**. Remove Supabase-only roles, RLS,
policies, and auth grants from the twin while preserving the data-plane tables, indexes, foreign
keys, backfills, and `agent_svc` grants. Regenerate `db/migrations/atlas.sum`, then refresh
`test-base`.

Never reintroduce Python migration splitting, statement filtering, pgvector neutralization, or
swallowed migration failures. Atlas owns ordering, checksums, transactions, and the revision
ledger (`public.atlas_schema_revisions`).

## BYO mutation gate

Treat `TEST_DATABASE_URL` as a secret and log only its host. The default BYO preflight wakes the
database, verifies Atlas revisions and capabilities, and then refuses before tests can write.

Mutation requires both:

```bash
TEST_DATABASE_URL='<disposable-dsn>' TEST_DB_ALLOW_MUTATION=1 make test-integration
```

For Neon endpoints, the fixture also resolves the endpoint and branch through the Neon API. It
rejects the project default, `main`, `staging`, `test-base`, and any `preview/*` branch or lineage,
even when the mutation flag is set. Non-Neon BYO hosts still require the explicit flag.

## Quota and plan semantics

Budget against 10 concurrent branches in this project:

- Standing: `main` + `staging` + `test-base` + zero or one dev branch.
- Ephemeral: one per live Python integration or catalog-spike session.
- Phase C serializes catalog spikes after Python integration and uses
  `neon-tests-${{ github.ref }}` with cancellation, keeping each PR's peak at one branch.

Two PRs + one local run + four standing branches is 7 (pathological); 4-6 is typical. Check the
Neon Console before a live run. The Free plan has no paid-overage escape hatch, so treat its
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

This mirrors the parent/name ownership pattern in
`apps/agent/agent/tests/neon_api.py::delete_claimed_branch`: list-delta discovery is only a hint;
the deletion authority comes from the per-ID identity re-verification. Neon documents `parent_id`
as the parent branch ID in its [branch API](https://api-docs.neon.tech/reference/listprojectbranches)
and rejects deletion of branches that still have children.
