# Secrets inventory (GitHub repo + environment)

What every GitHub secret (repository-level and environment-level) and every credential-shaped
container env var is for, who consumes it, and what breaks if it is rotated. Started
2026-07-29 after setting `ANON_ID_SECRET` blind — the value went in with no record anywhere
of what it does.

The scope snapshot was checked read-only on 2026-08-01 with `gh secret list` for the repository,
`staging`, and `production` environments. Only secret names were requested; no secret value was
read. Re-run those three commands before any rotation because GitHub secret presence and scope
are provisioning state, while the source-consistency test below only sees names used by this
repository.

Companion to [`deployment.md`](./deployment.md), which covers non-secret runtime config
(`LOG_LEVEL`, `CACHE_TTL_SECONDS`, and the rest of `CONTAINER_ENV_KEYS` that never touch a
GitHub secret). **Values never appear here, in commit messages, in PR bodies, or in chat** —
see the "Handling" section at the bottom.

## This file rots by default — the test that keeps it honest

A one-time inventory snapshot goes stale the moment a secret is added, renamed, or
re-scoped, and nothing else notices. `gh secret list` cannot be the enforcement mechanism:
it needs a repo-admin PAT to run in CI (the default `GITHUB_TOKEN` cannot list repo
secrets), and minting a standing admin token just to keep a doc honest is a net-negative
trade. Instead,
[`apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py`](../../apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py)
does it with zero credentials, by grepping source instead of asking GitHub:

- **A** = every name used as `${{ secrets.X }}` anywhere under `.github/workflows/**`, plus
  every credential-shaped name in `workers/edge/src/container/container-env.ts`'s `CONTAINER_ENV_KEYS`
  (`_API_KEY` / `_TOKEN` / `_SECRET` suffix) — the rest of that list
  is plain runtime config with no GitHub secret behind it, and stays out of scope here (see
  `deployment.md`).
- **B** = every name in this file's two tables (Live + Referenced by nothing).
- `test_every_workflow_secret_and_credential_container_key_is_documented`: **A ⊆ B**. Code
  reaches for a secret this file has never heard of → red.
- `test_live_table_entries_are_still_actually_referenced`: every name in the **Live** table is
  still in A. A secret's last reference gets deleted and the row doesn't move to
  "Referenced by nothing" → red, not a silent stale claim.

Follows the shape of `apps/agent/src/animichi/tests/unit/test_anonymous_docs_consistency.py`, which
does the same job for `ARCHITECTURE.md` against `workers/edge/src/identity/auth.ts`.

## Same-name override rule

`reusable-deploy-component.yml`'s `deploy` job and `reusable-post-deploy-test.yml`'s test job run
`environment: ${{ inputs.environment }}`. The manual `deploy.yml` job runs
`environment: production` and its direct Wrangler steps also select `environment: production`.
GitHub resolves an environment secret over a same-named repository secret for any job that
declares that environment — **so when a name exists at both scopes, only the environment-level
value is ever live for a staging/production deploy; rotating the repository-level one there
does nothing.** The table below marks scope explicitly per name instead of assuming repo-level.

There is no `preview.yml` or other PR-preview deploy workflow in the current tree. Consequently,
the repository-level copies of `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`NEON_DATABASE_URL`, `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `LOGFIRE_TOKEN` are passed by caller expressions but are overridden
by the matching staging/production environment value inside the called job. The current caller
maps still pass the repository-level names explicitly, but that does not make those values the
deploy inputs; they are not a separate deploy path. Removing a caller mapping is a separate
workflow change that must be tested against the environment override behavior.

## Three consumption chains

A secret reaching production takes one of three distinct shapes. Picking the wrong one to
imitate when adding a new secret produces exactly the wrong number of touchpoints:

1. **Container secret chain** (the one most new secrets need) — a GitHub secret forwarded into
   the Python agent as an env var. Reference implementation: `MIMO_API_KEY`.
   1. Provision the GitHub repository/environment secret through the approved CI/CD
      administration path; a developer workstation must not mutate shared-environment secrets.
   2. Reusable CI path: `.github/workflows/reusable-deploy-component.yml` — declare under
      `workflow_call.secrets`, add the name to the calling `ci.yml` job's `secrets:` map and
      `worker_secrets` list, and pass it in the `env:` map of the "Deploy Worker" step. A
      reusable workflow does not inherit secrets unless the caller forwards them.
   3. Manual path: `.github/workflows/deploy.yml` uses direct `cloudflare/wrangler-action`
      steps, so add the name to that action's `secrets:` block and its `env:` map separately;
      changing `reusable-deploy-component.yml` does not update this workflow.
   4. `workers/edge/src/container/container-env.ts` — add the name to `CONTAINER_ENV_KEYS`, or the worker drops it
      even when Wrangler has it.
   5. This file, plus `deployment.md` if it is not secret-shaped.
2. **Cloudflare Worker secret chain** — a GitHub secret pushed straight to the Worker's own
   Cloudflare secret store, read by `workers/edge/src/**` directly; never forwarded into the container.
   Reference implementation: `ANON_ID_SECRET` / `TURNSTILE_SECRET` — as of the same-day
   `reusable-deploy-component.yml` change that wired them in (2026-07-29), the push itself now runs
   inside CI's "Push post-deploy secrets to Worker" step (driven by the `post_deploy_secrets`
   input), not by a human running a secret mutation command locally.
   1. Provision the GitHub repository/environment secret through the approved CI/CD
      administration path; a developer workstation must not mutate shared-environment secrets.
   2. `.github/workflows/reusable-deploy-component.yml` — declare under `secrets:`, add the name to the
      calling job's `post_deploy_secrets` list, and add one line to the "Push post-deploy
      secrets" step's `env:` (GitHub Actions has no dynamic `secrets.<computed-name>` lookup,
      so that map needs one line per name).
   3. This file.
3. **Plain var chain** — never a GitHub secret at all; a literal value checked into
   `wrangler.toml`'s `[vars]` (or `[env.<name>.vars]`), forwarded to the container the same way
   as (1) via `CONTAINER_ENV_KEYS`. Reference implementation: `ANON_DAILY_COST_BUDGET_USD`.
   1. `wrangler.toml` — add the literal value under the relevant `[vars]` section(s).
   2. `workers/edge/src/container/container-env.ts` — add the name to `CONTAINER_ENV_KEYS`.
   3. `deployment.md`'s environment tables (not this file — nothing secret-shaped happened).

`CORS_ALLOWED_ORIGIN` has completed the chain-1 → chain-3 migration for both environments
(#1047): the value is a checked-in `[env.*.vars]` wrangler var (staging and production alike),
so it no longer has a Live row here — see its "Referenced by nothing" row below.

## Live secrets

| Secret | Scope | What it is | Value lives in / read by | Rotation |
|---|---|---|---|---|
| `ANON_ID_SECRET` | repo (no env override) | HMAC-SHA-256 key signing anonymous visitor IDs | GitHub repo secret → pushed to both Cloudflare Worker secret stores via CI's post-deploy-secrets step → read by `workers/edge/src/identity/auth.ts` | **Invalidates every existing `aid` cookie**, and since #514 `aid` also backs anonymous→signed-in session-ownership migration, so every unmigrated anonymous session's history is permanently orphaned, not just rate-limit counters reset. Set once. Breaks silently: `verifyAnonymousToken` (`workers/edge/src/identity/auth.ts`) just returns `null` on a signature mismatch — no error, the edge mints a fresh anonymous identity and session-migration reports "nothing to migrate" for visitors who actually had history |
| `TURNSTILE_SECRET` | repo (no env override) | Cloudflare Turnstile siteverify key. Must be the **Secret Key** (~35 chars), not the Site Key (~24) | GitHub repo secret → pushed to both Cloudflare Worker secret stores via CI's post-deploy-secrets step → read by `workers/edge/src/protect/turnstile.ts` | Safe. Missing or wrong → `guardTurnstile` fails closed and every anonymous request gets 403 `turnstile_required` — loud, not silent |
| `CLOUDFLARE_API_TOKEN` | repo + `staging` + `production` (environment value wins for every current staging/production deploy; no PR-preview workflow exists) | Deploys Workers; needs `Workers Scripts:Edit` | `reusable-deploy-component.yml`, `reusable-post-deploy-test.yml`, and direct production `deploy.yml` steps | Rotating the environment-level value breaks staging/production deploys; the repo-level copy has no current deploy consumer but remains required in caller secret maps. Create the replacement first, update the intended scope, then revoke the old one |
| `CLOUDFLARE_PULUMI_API_TOKEN` | `staging` + `production` environments | Pulumi 专用最小权限 token(R2:Edit + Zone DNS/Routes/Rulesets:Edit,zone 限 animichi.com;不含 Workers Scripts/Containers)— #674 最小权限分离 | `reusable-deploy-infra.yml` 与 `reusable-deploy-neon-secrets.yml` 的 Pulumi state-backup 与 `pulumi up` 两步 | 与 wrangler token 分离即为轮换/爆炸半径隔离;轮换在 CF dashboard 原地 Edit 权限或 Roll 后更新两环境 secret |
| `CLOUDFLARE_ACCOUNT_ID` | repo + `staging` + `production` (same override rule as above) | Account identifier (not a credential, stored as a secret for convenience) | All current deploy and post-deploy workflows | Rotating an environment value breaks that environment's URL resolution/deploy; the repo-level copy is only a caller mapping today |
| `ZEN_GO_API_KEY` | repo (no env override) | **Production LLM gateway.** MiMo `mimo-v2.5` is routed through the zen/go gateway (`https://opencode.ai/zen/go/v1`) | Staging root Worker secret (`ci.yml` `deploy-root-staging` `worker_secrets`) → `CONTAINER_ENV_KEYS` → agent settings; also `ci.yml` eval smoke and `agent-eval-nightly.yml`. Production root upload stays frozen. | Missing in the container → Python `validate_required_env` fails before bind 8080 (staging `/healthz` 500). Eval lanes 401/403 the provider and the user sees the agent's generic failure response, never the raw provider error (SD-19) |
| `MIMO_API_KEY` | repo (no env override) | Retired gateway credential — kept for rollback to api.xiaomimimo.com direct routing | Agent container (rollback only) | No live impact while the zen/go gateway is the default; would surface the same way as `ZEN_GO_API_KEY` if re-enabled |
| `DEEPSEEK_API_KEY` | repo (no env override) | Fallback model — **wired but disabled** (no balance) | Agent container | No live impact today; would surface the same way as `MIMO_API_KEY` once re-enabled |
| `GOOGLE_MAPS_API_KEY` | repo (no env override) | Geocoding (`apps/agent/src/animichi/infrastructure/gateways/geocoding.py`) | Agent container | Breaks geocoding — surfaces as a place-resolution failure, not a raw API error |
| `NEON_DATABASE_URL` | repo (**unreachable** — see "Same-name override rule"; no non-environment-scoped caller exists today) + `staging` + `production` | Catalog data plane | `reusable-deploy-component.yml`'s Atlas-migrate step; production catalog/users Worker deploys still upload it as the `DATABASE_URL` worker secret until the #912 Secrets Store cutover (staging reads its DSN from the Secrets Store binding instead) | Wrong value → Atlas migrate fails closed (`atlas migrate apply` errors) or a production catalog/users deploy points at the wrong branch; either way the deploy job fails loudly, it does not silently write to the wrong database |
| `AGENT_DATABASE_URL` | `production` environment secret only | Agent-domain Neon DSN for the SAFE-1-pinned production maintenance Worker | **Production:** still uploaded to the maintenance Worker from the GH secret (`reusable-deploy-component.yml`/`ci.yml`/`deploy.yml`) until the #912 cutover. Read at runtime by the pinned jobs Worker source. The **staging** environment secret of the same name was orphaned by RETENTION-1 (#940, the staging jobs Worker/store secret/deploy job are gone) — delete it once this change is live | Missing/empty → the scheduled invocation throws `Missing required binding: AGENT_DATABASE_URL` before connecting, so rows are retained, not deleted elsewhere. A wrong-but-valid DSN is **not** caught: the Worker performs no runtime database-identity check, so whether it fails depends entirely on whether that DSN is reachable. Rotate one environment at a time and verify its next Cron Trigger Past Event. Staging cleanup: `gh secret delete AGENT_DATABASE_URL --env staging`; do **not** touch the `production` environment secret |
| `NEON_API_KEY` | repo (no env override) | Neon data-plane control-plane key for **first-run Pulumi adoption imports** in the neon-secrets role/DSN provisioning (#926, ADR 0003); no longer a test-infra credential since #1053 | `reusable-deploy-neon-secrets.yml` (+ its callers `ci.yml`/`deploy.yml`), consumed only by `.github/scripts/neon-secrets-adopt.sh` | Removing it would force deleting/rotating the Neon service roles it provisions; the retired test lanes that used it are gone |
| `SUPABASE_DB_URL` | repo (no env override) | **Transitional container-DSN name** — the Agent runtime's data-plane DSN is `AGENT_SVC_DATABASE_URL` (Neon agent_svc role) only (#995); the agent settings no longer read `SUPABASE_DB_URL`, so it is not a data-plane dependency. It remains a forwarded/required container env key (the edge `CONTAINER_ENV_KEYS`/`CONTAINER_REQUIRED_KEYS` still name it) because production still provisions the container DSN under that name pending the #855 prod cutover; a given value is a plain asyncpg DSN to Neon | Forwarded to the agent container (which ignores it); a real consumer remains only as the prod container-DSN provisioning name | **Once #855 lands** — remove from `container-env.ts`'s required/forward lists, the deploy secret lists, and the release manifest; delete the GitHub secret after that |
| `PULUMI_BACKEND_URL` · `PULUMI_CONFIG_PASSPHRASE` | repo (**unreachable** — no non-environment-scoped caller) + `staging` + `production` | Pulumi state on R2 and its encryption passphrase | `pulumi up` in `reusable-deploy-infra.yml` / `reusable-deploy-neon-secrets.yml` | **Losing the passphrase makes existing state undecryptable.** Back it up outside this repo. This is the loudest possible failure: `pulumi up` refuses to proceed |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | repo (**unreachable** — no non-environment-scoped caller) + `staging` + `production` | R2 credentials for the Pulumi state bucket | `reusable-deploy-infra.yml` / `reusable-deploy-neon-secrets.yml` | Wrong value → Pulumi's R2-backed state backend fails to authenticate, loud failure on the next `pulumi` invocation |
| `LOGFIRE_TOKEN` | repo (**unreachable** — no non-environment-scoped caller) + `staging` + `production`, each a **different** Logfire project (`animichi-staging` / `animichi-prod`) as of 2026-07-29, replacing one shared `LOGFIRE_TOKEN_PROD`/`LOGFIRE_TOKEN_STAGING` pair that lived less than eight hours (wiring was #498) | Write token for the environment's Logfire project | Agent container | Traces stop for that environment only; nothing else breaks. The repo-level value (old `lifeodyssey/seichijunrei` project) cannot currently be reached by any deploy — see "Same-name override rule" |
| `GITLEAKS_LICENSE` | repo (referenced, **not currently set** — absent from `gh secret list`) | Gitleaks Pro license key | `reusable-security.yml`, `ci.yml` | Per that workflow's own comment, only required once this becomes a GitHub organization repo (rate-limit workaround); this repo is personal-owned, so leaving it unset is intentional, not an oversight |
| `STAGING_GATE_TOKEN` | `staging` environment secret only (no repo-level copy; the workflow_call no longer declares it — consumed only at job level from the `staging` environment) | Pass credential for the staging WAF gate (#529/#559/#541): CI smoke/E2E requests send it as the `x-staging-key` header | GitHub `staging` environment secret → resolved by `post-deploy-assert.sh` (via `reusable-post-deploy-test.yml` and `reusable-deploy-component.yml`'s Smoke step, which resolve it from their job-level `environment:`, never from a caller pass-through) → matched by the gate ruleset expression in `infra/index.ts` against the same value as the encrypted `stagingGateToken` in `infra/Pulumi.staging.yaml` | **Mismatch locks CI out of staging with no useful symptom** (the WAF 403s the smoke). `bash scripts/setup-staging-gate.sh --rotate` replaces the GitHub secret and the Pulumi config together; rotates into the `staging` environment via `gh secret set --env staging` |

## Referenced by nothing

Found by grepping every secret name across `.github/workflows/` and `CONTAINER_ENV_KEYS`
against every source tree in the repo, plus the read-only GitHub name snapshot above. **These are
not one kind of finding** — read the action column before batching a decision:

| Secret | Finding | Owner action |
|---|---|---|
| `GCP_SA_KEY` | A GCP service-account private key, added 2025-12, referenced nowhere in code or workflows — the only row here with a real blast radius if it leaked (a live cloud credential, not an inert config name) | Check GCP IAM for any usage of this SA outside this repo; if none, revoke it in GCP first, then `gh secret delete GCP_SA_KEY`. Open an issue to track — do not batch with the rows below |
| `GCP_PROJECT_ID` | Companion to `GCP_SA_KEY`, same 2025-12 origin, referenced nowhere | Delete once `GCP_SA_KEY` is confirmed dead and revoked |
| `CLAUDE_CODE_OAUTH_TOKEN` | Added 2026-05, referenced nowhere | `gh secret delete CLAUDE_CODE_OAUTH_TOKEN` — no dependency to check first |
| `ZETA_API_KEY` | Model-provider key for Z.AI — was listed in `CONTAINER_ENV_KEYS` (`workers/edge/src/container/container-env.ts`) but **no workflow ever passed it** and no source reads it, a broken chain. Retired under the MiMo-only key convergence (#684): removed from the forwarding allowlist, with the policy decision (Zeta is not a wanted provider) recorded in the `workers/edge/wrangler.toml` comment block | `gh secret delete ZETA_API_KEY` — no dependency to check first |
| `OPENAI_COMPAT_API_KEY` | Read by `apps/agent/src/animichi/config/settings.py` and `apps/agent/src/animichi/config/model_aliases.py`, listed in `CONTAINER_ENV_KEYS`, but again **no workflow passes it** — broken chain: the allowlist expects a value no workflow ever forwards | Keep-or-retire decision, not a delete: code still reads this credential, so retiring it means first removing its references from `settings.py` / `model_aliases.py`, then the `CONTAINER_ENV_KEYS` entry and this row |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_BASE_URL` | Repository secrets present in the 2026-08-01 snapshot, but no workflow or source file references either name; the old Dependabot/Claude path was retired | Confirm no external automation still uses them, then delete both repository secrets |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Repository secret present in the 2026-08-01 name snapshot, but no workflow, `apps/web` source, or `CONTAINER_ENV_KEYS` entry references it. The current map stack is MapLibre GL + Protomaps PMTiles and the Mapbox ADR is explicitly retired/banned. If a future Mapbox integration is approved, this `NEXT_PUBLIC_` token would be a **public browser client token**, not a container secret; it would need URL restrictions and a public build variable instead of secret forwarding. | Confirm no external deployment still consumes it, revoke the token in the Mapbox console, then `gh secret delete NEXT_PUBLIC_MAPBOX_TOKEN`. Do not move it to Live or add it to `CONTAINER_ENV_KEYS` |
| `GEMINI_API_KEY` | Was Live (this table, above) until #656 (2026-08-04): photo-search recognition now rides the main agent's multimodal input (`apps/agent/src/animichi/agents/photo_vision.py`) instead of the standalone `GeminiVisionProvider`, so nothing in `CONTAINER_ENV_KEYS`, `wrangler.toml`, or any workflow reads this name anymore | `gh secret delete GEMINI_API_KEY` once the deploy carrying #656 is confirmed live in production — no dependency to check first, the code path it fed no longer exists |
| `CORS_ALLOWED_ORIGIN` | Was Live (this table, above) until #1047 (2026-08-15): demoted to a checked-in **wrangler var** — `[env.*.vars].CORS_ALLOWED_ORIGIN` in `workers/edge/wrangler.toml` (asserted by `workers/edge/test/auth-config.test.ts`); no workflow forwards `${{ secrets.CORS_ALLOWED_ORIGIN }}` anymore, so any residual GitHub secret (repo-level or `production` environment) is a dead binding | `gh secret delete CORS_ALLOWED_ORIGIN` (repo) and `--env production` if present — the value now lives in the checked-in wrangler vars |
| `NEON_AUTH_JWKS_URL` | Was Live (this table, above) until #1047: the edge's only identity source is now provisioned as a Cloudflare Secrets Store entry (name constant `NEON_AUTH_JWKS_VAR` in `infra/src/neon-auth.ts`, value written by the infra/neon-secrets stack `index.ts`) with the checked-in wrangler var as the dev/placeholder path — no workflow references `${{ secrets.NEON_AUTH_JWKS_URL }}` anymore | `gh secret delete NEON_AUTH_JWKS_URL --env staging` and `--env production` if present — the value now lives in the Cloudflare Secrets Store / wrangler vars |
| `CATALOG_DATABASE_URL` | Migrated to the Cloudflare Secrets Store (#912 PR2): the catalog Worker's staging DSN now arrives via the `[[env.staging.secrets_store_secrets]]` binding in `workers/catalog/wrangler.toml`, so no workflow or GH secret reference remains. The staging GH secret still exists only until the binding swap is verified live | After the first post-PR2 staging deploy passes its post-deploy suite, `gh secret delete CATALOG_DATABASE_URL --env staging` |
| `USERS_DATABASE_URL` | Migrated to the Cloudflare Secrets Store (#912 PR2): the users Worker's staging DSN now arrives via the `[[env.staging.secrets_store_secrets]]` binding in `workers/users/wrangler.toml`, so no workflow or GH secret reference remains. The staging GH secret still exists only until the binding swap is verified live | After the first post-PR2 staging deploy passes its post-deploy suite, `gh secret delete USERS_DATABASE_URL --env staging` |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` | Legacy Supabase auth-plane credentials — nothing has read these since the AUTH-2 #950 hard cut (edge verifies Neon JWKS only; web logs in via Better Auth). Issue #1000 removed them from every CI workflow and `.env.example`; the release-manifest surface (`production-pre-campaign.json` `worker_secrets` + validation expectations) is **deferred to closeout** per owner decision (issue #1037), so those secret names may still appear there until then. No source or workflow references either name at runtime | `gh secret delete SUPABASE_URL` then `gh secret delete SUPABASE_ANON_KEY` — one command per secret; no dependency to check first. (`SUPABASE_DB_URL`, in the Live table above, is a separate transitional container-DSN name despite the shared prefix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy Supabase service-role credential — nothing has read it since AUTH-1 (#945) removed the `sk_*`/api_keys edge path. Issue #1000 removed it from every CI workflow and `.env.example`; the release-manifest surface (`production-pre-campaign.json` `worker_secrets` + validation expectations) is **deferred to closeout** per owner decision (issue #1037), so this secret name may still appear there until then. No source or workflow references it at runtime | `gh secret delete SUPABASE_SERVICE_ROLE_KEY` — no dependency to check first |

Deleting is a per-row decision, not a batch one: `GCP_SA_KEY` needs an external check before
deletion, the one remaining broken chain (`OPENAI_COMPAT_API_KEY`) needs a keep-or-retire
decision (not a delete) — `ZETA_API_KEY`'s retirement was already decided in #684 (MiMo-only) —
Mapbox needs a provider-side revocation check, and only `CLAUDE_CODE_OAUTH_TOKEN` is safe to
delete immediately.

## Cloudflare Secrets Store (not GitHub secrets)

#912 PR2 moved the per-component Neon DSNs out of GitHub secrets and into the **Cloudflare
Secrets Store** (the account's default store, id `66c9bb0faef644b4a0671bb7d90d98bd`; a second
store is refused by the account plan, `maximum_stores_exceeded`). Values are managed by the
`infra/neon-secrets` Pulumi stack (staging branch roles + composed DSNs; see its `index.ts` for
the role→secret mapping and the bootstrap/rotation runbook). This file only covers GitHub
secrets, so store secrets are listed here for the reader, not enforced by
`test_secrets_docs_consistency.py`:

| Store secret | Worker binding | Consumed by |
|---|---|---|
| `CATALOG_DATABASE_URL` | `DATABASE_URL` | `workers/catalog/wrangler.toml` `[[env.staging.secrets_store_secrets]]` → `workers/catalog/src/index.ts` (`await env.DATABASE_URL.get()`) |
| `USERS_DATABASE_URL` | `DATABASE_URL` | `workers/users/wrangler.toml` `[[env.staging.secrets_store_secrets]]` → `workers/users/src/index.ts` |
| `AGENT_SVC_DATABASE_URL` | `AGENT_SVC_DATABASE_URL` | `workers/edge/wrangler.toml` `[[env.staging.secrets_store_secrets]]` → `workers/edge/src/container/container-env.ts` (forwarded into the agent container) |

Bindings are declared per environment in `wrangler.toml` (`secrets_store_secrets` is
non-inheritable) and are applied automatically by `wrangler deploy` — no CI secret upload step
exists for them. The fail-closed guard is the binding itself: a missing store id/secret fails
the deploy API call, and `env.<binding>.get()` throws at runtime if the secret is ever deleted.
Note that `secrets.required` must NOT list a name that is also a Secrets Store binding —
wrangler rejects a name assigned to both binding types.

**Staging only, deliberately.** The store secrets hold staging-role DSNs; production bindings
would silently point prod at the staging database. Production workers keep the GitHub-secret
`wrangler secret put` chain (`NEON_DATABASE_URL` as `DATABASE_URL`; `AGENT_DATABASE_URL`) until
the production-role cutover phase of #912. Local dev is unchanged (`.dev.vars`).

## Adding a new secret

Pick the matching chain from "Three consumption chains" above and follow its numbered steps —
using the wrong one silently under- or over-wires it. `MIMO_API_KEY` is the reference
implementation for the container-secret chain (all four touchpoints in place); `ANON_ID_SECRET`
/ `TURNSTILE_SECRET` for the Cloudflare-Worker-secret chain. For non-secret Wrangler vars, use
`ANON_DAILY_COST_BUDGET_USD` or the staging `CORS_ALLOWED_ORIGIN` entry as examples — do not
copy that plain-var chain when adding a secret. Write a test asserting the key is present in
whichever forwarding list applies (`CONTAINER_ENV_KEYS`, `post_deploy_secrets`, or both).

## Handling

- Never paste a value into chat, a PR body, an issue, or a commit message. This repository
  has burned two secrets that way (a Turnstile secret on 2026-07-26, a Logfire read token
  on 2026-07-29) — in both cases the leak happened while *reporting* a rotation.
- Shared-environment deploys and secret writes are **CI-only**. Developers must not run
  deployment or secret-mutation commands from a workstation; the reviewed `reusable-deploy-component.yml`
  and `deploy.yml` workflows are the supported write paths. The `wrangler secret put` shape below
  is an implementation sketch inside those workflows, not a local runbook:
  `printf '%s' "$value" | pnpm exec wrangler secret put "$name" --env "$TARGET_ENVIRONMENT"`.
- Keep values out of process arguments in every approved provisioning path. A GitHub secret
  body-file/stdin interface (for example, `openssl rand -hex 32 | gh secret set <NAME>
  --body-file -`) avoids placing the value in argv; this is CI/admin automation guidance, not a
  command for developer workstations. A `--body "..."` value can be exposed through process
  listings, `/proc`, shell tracing, or persisted command history. Stdin avoids argv exposure but
  does not make the value public-proof, so never echo it or write it to a shared file.
- When a value must be identified, quote a prefix and a length (`pylf_v…[55 chars]`), never
  the whole thing.
- In the CI workflow's non-TTY `wrangler secret put`, Wrangler answers "yes" to "Worker does
  not exist, create it?" and can silently create a stray Worker. The workflow must run this only
  **after** a confirmed deploy; developers must not run it locally.
