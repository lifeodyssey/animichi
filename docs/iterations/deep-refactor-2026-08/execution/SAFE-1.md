# SAFE-1 execution playbook

> Issue: [#937](https://github.com/lifeodyssey/animichi/issues/937)
> Worktree: `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/safe-1-promotion-guard`
> Branch: `codex/safe-1-promotion-guard`
> Current HEAD: `50be86d5`
> Base: `b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf`

## 1. Result

SAFE-1 makes every deep-refactor revision technically unable to mutate production. Automatic
`ci.yml`, manual `deploy.yml`, and `rollback.yml` must reject a campaign source before checkout,
Atlas, Pulumi, Wrangler, or rollback. The only representable production source is one immutable
pre-campaign release manifest.

This is a production freeze, not the future CI/CD redesign. It does not centralize pipelines, build
artifacts once, rename `deploy.yml` to `cd.yml`, remove duplicated Atlas application, or alter staging
deployment behavior.

## 2. Pinned production surface

The immutable manifest must describe the whole pre-campaign production release, not only code SHA:

| Component | Working directory | Worker | Required preserved input |
|---|---|---|---|
| `catalog` | `workers/catalog` | `catalog` | Atlas target and Pulumi `prod` mapping |
| `web` | `apps/web` | `animichi-web` | web build/deploy mapping |
| `users` | `workers/users` | `users` | Atlas target and user Worker mapping |
| `maintenance` | `workers/jobs` | `jobs` | `AGENT_DATABASE_URL`, `jobs_svc` grants, both Cron definitions |
| `root` | `.` | `animichi` | `workers/edge/wrangler.toml`, Agent container mapping |

The source pin is `b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf`. The Atlas pin is directory
`migrations/neon`, target `20260809000031`, and `atlas.sum` SHA-256
`e0428e7a9b25745a8d1f22f8fbcec5c915a8e18d56a7a45f5fe3554158b6ab80`.

The production Jobs entry preserves the old deployable configuration while campaign source deletes
Jobs from staging. It does not prove that a live production Jobs Worker currently exists and must
never create one during a campaign-triggered run.

## 3. Live inventory boundary

A read-only Cloudflare inventory on 2026-08-10 found only the root production Worker `animichi`:

- current 100% version: `f8558714-90da-4c18-8bdc-335435482d57`;
- previous uploaded version: `6c27712a-2678-4742-80da-fc296a346805`;
- production `catalog`, `users`, `jobs`, and `animichi-web`: absent;
- all corresponding staging components: present.

This is an observation, not the manifest authority. Re-read live inventory before final review. Keep
deployment eligibility and rollback eligibility separate:

- a pinned component may remain describable for an explicitly approved old-source deployment;
- an absent Worker has no rollback version and must fail closed;
- no observed version becomes an approved rollback target merely because it exists;
- campaign `push main` never creates, redeploys, or rolls back a production Worker.

If production rollback activation is later requested, owner approval of the exact component/version
pair is a production decision. Until then, the manifest represents rollback as ineligible while
preserving the component/config mapping.

## 4. Resume sequence

### Phase A: characterization (complete)

Commit `50be86d5` adds `.github/scripts/test_safe1_production_contract.rb`. It records:

1. the five production component/directory mappings in `ci.yml` and `deploy.yml`;
2. root Wrangler config placement;
3. the production Jobs credential, role grants, Worker name, and two Cron expressions;
4. Atlas head and `atlas.sum` digest;
5. the current unsafe behavior: implicit caller-SHA checkout, `github.sha` smoke expectation, and
   caller-supplied rollback `version_id`.

The following were green after the commit:

```bash
ruby .github/scripts/test_safe1_production_contract.rb
ruby .github/scripts/test_ci_contract.rb
ruby .github/scripts/assert-workflow-invariants.rb
ruby .github/scripts/assert-workflow-invariants.test.rb
```

The worktree is clean and OpenCode is stopped. Do not recreate Phase A or amend its commit.

### Phase B1: immutable manifest and resolver

Use the content-addressed Git blob design unless a red test demonstrates it cannot satisfy the
contract. The implementation should have these responsibilities:

1. Add `.github/release-manifests/production-pre-campaign.json` with a versioned closed schema.
2. Include full source revision; Atlas directory, target, and digest; complete component mapping;
   component dependency; exact Wrangler config; Pulumi/build flags; secret **names**; and separate
   deploy/rollback eligibility. Never include a secret value or DSN.
3. Calculate and pin both the manifest Git blob object ID and its SHA-256. A squash merge may replace
   commit identities, but the referenced blob remains content-addressed.
4. Add a narrow resolver that reads the pinned blob, validates every field, rejects unknown fields,
   validates full SHAs/digests, rejects unknown components, and returns typed public outputs.
5. Add target behavior tests before implementation. They must be red on the current unsafe workflow
   and green only when mutation cannot begin before eligibility.
6. Update the Phase A characterization assertions from “unsafe behavior exists” to the target
   invariant only after the target tests exist.

Resolver outputs must include manifest digest, source revision, Atlas directory/target/digest,
component key, working directory, Wrangler config, environment, dependency, eligibility verdict, and
a non-sensitive reason. Callers cannot override these values.

Complete B1 when manifest validation and resolver tests are green, altering any manifest field while
keeping the pinned identities fails, unknown components fail, and the diff contains no workflow
mutation path yet. Commit B1 separately.

### Phase B2: wire all production entry points

Add one thin reusable eligibility workflow and route all three entry points through it:

1. Eligibility reads the pinned blob without checking out campaign source.
2. `ci.yml` evaluates the campaign candidate and records an ineligible no-op before every production
   job. A normal campaign `push main` may deploy staging but cannot mutate production.
3. `deploy.yml` cannot turn its dispatch ref into a production source. Only an explicit approved
   pre-campaign invocation may resolve the manifest, and the GitHub `production` environment approval
   remains mandatory.
4. `rollback.yml` removes caller-supplied `version_id`. Component/config/version must resolve from
   the manifest; rollback-ineligible or absent components stop before checkout or Wrangler.
5. `reusable-deploy-component.yml` requires manifest-derived production source and Atlas values,
   checks out `source_revision`, verifies `HEAD`, verifies `atlas.sum`, and applies Atlas with the
   pinned target before any production deployment.
6. Build metadata, `/healthz` checks, and post-production smoke expect the resolved source revision,
   never the campaign `github.sha`.
7. Staging retains caller-SHA behavior and its current DAG. Production secrets remain job-scoped,
   third-party actions remain full-SHA pinned, checkout keeps `persist-credentials: false`, and
   cancellation cannot interrupt production work.

Every production job must depend directly or transitively on eligibility in a way GitHub Actions can
represent with `needs`; comments or cross-workflow timing are not dependencies.

Complete B2 when all production entry points fail closed before source checkout or mutation for a
campaign SHA, staging behavior is unchanged, and production smoke expectations use the manifest SHA.
Commit B2 separately.

### Phase B3: documentation and invariant closure

1. Correct `docs/ops/deployment.md`: current manual catalog/users calls do run the reusable Atlas
   path; do not preserve the stale claim that manual deploy skips migration.
2. Document the freeze and operator-visible ineligibility reason without publishing credentials.
3. Add the new contract tests to the unfiltered `Quality / invariants` lane.
4. Keep the old global invariant suite; SAFE-1 adds a focused production contract instead of hiding
   the rule inside unrelated workflow-shape checks.

Complete B3 when the runbook matches executable workflows and every production guard test runs on
all PRs/merge-group candidates that could change release code.

## 5. Required proof

Run the smallest focused tests after each edit, then the full SAFE-1 set from repository root:

```bash
ruby .github/scripts/test_safe1_production_contract.rb
ruby .github/scripts/test_ci_contract.rb
ruby .github/scripts/assert-workflow-invariants.test.rb
ruby .github/scripts/assert-workflow-invariants.rb
uv run --script --locked --no-build .github/scripts/test_config_read_sets.py
cd apps/agent && uv run pytest src/animichi/tests/unit/test_deploy_model_env_consistency.py -q --no-cov
pnpm --filter jobs run test:worker
actionlint -color
git diff --check
```

If new manifest/resolver tests use different filenames, add their exact commands to the card brief
and PR evidence. Do not replace sanctioned repository commands with an ad hoc parser.

The mutation record must prove red for each class below, restoring green after every probe:

- change source SHA, Atlas target, directory, or digest;
- change manifest content without changing its pinned identity;
- remove eligibility from any production entry or move it after checkout/mutation;
- restore caller workflow ref or `github.sha` as production source;
- remove Atlas `--to-version` or pre-apply digest verification;
- restore caller-supplied rollback version;
- change root config placement;
- remove maintenance mapping, `AGENT_DATABASE_URL`, any pinned `jobs_svc` grant, or either Cron;
- make an absent or rollback-ineligible component proceed;
- make post-production smoke expect campaign SHA.

## 6. Review and landing

Before push, the orchestrator must:

1. inspect every workflow expression and permission line against the brief;
2. confirm no production secret value, account identifier, token, or DSN entered Git or logs;
3. confirm third-party action pins, least privilege, environment approval, and non-cancellable
   production concurrency remain intact;
4. obtain independent code review plus Codex Sol `xhigh` adversarial review;
5. verify the exact head has green local gates, mutation evidence, required PR checks, and patch
   coverage at least 95%;
6. inspect both review threads and top-level bot summaries before squash merge.

SAFE-1 is complete only when its squash commit is on `main`, all campaign production mutations are
provably blocked, the old manifest remains resolvable, no production operation was executed during
verification, and Wave 1 cards can branch from the merged guard.
