# Secrets inventory (GitHub repo + environment)

What every GitHub secret (repository-level and environment-level) and every credential-shaped
container env var is for, who consumes it, and what breaks if it is rotated. Started
2026-07-29 after setting `ANON_ID_SECRET` blind — the value went in with no record anywhere
of what it does.

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
[`apps/agent/agent/tests/unit/test_secrets_docs_consistency.py`](../../apps/agent/agent/tests/unit/test_secrets_docs_consistency.py)
does it with zero credentials, by grepping source instead of asking GitHub:

- **A** = every name used as `${{ secrets.X }}` anywhere under `.github/workflows/**`, plus
  every credential-shaped name in `worker/containerEnv.ts`'s `CONTAINER_ENV_KEYS`
  (`_API_KEY` / `_TOKEN` / `_SECRET` suffix, plus `SUPABASE_DB_URL`) — the rest of that list
  is plain runtime config with no GitHub secret behind it, and stays out of scope here (see
  `deployment.md`).
- **B** = every name in this file's two tables (Live + Referenced by nothing).
- `test_every_workflow_secret_and_credential_container_key_is_documented`: **A ⊆ B**. Code
  reaches for a secret this file has never heard of → red.
- `test_live_table_entries_are_still_actually_referenced`: every name in the **Live** table is
  still in A. A secret's last reference gets deleted and the row doesn't move to
  "Referenced by nothing" → red, not a silent stale claim.

Follows the shape of `apps/agent/agent/tests/unit/test_anonymous_docs_consistency.py`, which
does the same job for `ARCHITECTURE.md` against `worker/auth.ts`.

## Same-name override rule

`_deploy-component.yml`'s `deploy` job runs `environment: ${{ inputs.environment }}`, and
`ci.yml`/`deploy.yml` always call it with `environment: staging` or `environment: production`.
GitHub resolves an environment secret over a same-named repository secret for any job that
declares that environment — **so when a name exists at both scopes, only the environment-level
value is ever live for a staging/production deploy; rotating the repository-level one there
does nothing.** The table below marks scope explicitly per name instead of assuming repo-level.

One further wrinkle this surfaced: **`preview.yml` (PR preview deploys) never sets
`environment:`**, so `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are the one pair where the
repository-level value is *not* dead weight — it is the only credential PR previews use. Every
other name that exists at both scopes (`LOGFIRE_TOKEN`, `NEON_DATABASE_URL`,
`PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)
has no non-environment-scoped caller at all — the repository-level copy is unreachable in any
current workflow.

## Three consumption chains

A secret reaching production takes one of three distinct shapes. Picking the wrong one to
imitate when adding a new secret produces exactly the wrong number of touchpoints:

1. **Container secret chain** (the one most new secrets need) — a GitHub secret forwarded into
   the Python agent as an env var. Reference implementation: `MIMO_API_KEY`.
   1. `gh secret set <NAME>`
   2. `.github/workflows/_deploy-component.yml` — declare under `secrets:` **and** pass it in
      the `env:` of the "Deploy Worker" step. Callers (`ci.yml`, `deploy.yml`) must forward it
      too; a reusable workflow does not inherit secrets unless told to.
   3. `worker/containerEnv.ts` — add the name to `CONTAINER_ENV_KEYS`, or the worker drops it
      even when wrangler has it.
   4. This file, plus `deployment.md` if it is not secret-shaped.
2. **Cloudflare Worker secret chain** — a GitHub secret pushed straight to the Worker's own
   Cloudflare secret store, read by `worker/*.ts` directly; never forwarded into the container.
   Reference implementation: `ANON_ID_SECRET` / `TURNSTILE_SECRET` — as of the same-day
   `_deploy-component.yml` change that wired them in (2026-07-29), the push itself now runs
   inside CI's "Push post-deploy secrets to Worker" step (`wrangler secret put`, driven by the
   `post_deploy_secrets` input), not by a human running `wrangler secret put` locally.
   1. `gh secret set <NAME>`
   2. `.github/workflows/_deploy-component.yml` — declare under `secrets:`, add the name to the
      calling job's `post_deploy_secrets` list, and add one line to the "Push post-deploy
      secrets" step's `env:` (GitHub Actions has no dynamic `secrets.<computed-name>` lookup,
      so that map needs one line per name).
   3. This file.
3. **Plain var chain** — never a GitHub secret at all; a literal value checked into
   `wrangler.toml`'s `[vars]` (or `[env.<name>.vars]`), forwarded to the container the same way
   as (1) via `CONTAINER_ENV_KEYS`. Reference implementation: `ANON_DAILY_COST_BUDGET_USD`.
   1. `wrangler.toml` — add the literal value under the relevant `[vars]` section(s).
   2. `worker/containerEnv.ts` — add the name to `CONTAINER_ENV_KEYS`.
   3. `deployment.md`'s environment tables (not this file — nothing secret-shaped happened).

`CORS_ALLOWED_ORIGIN` is presently mid-migration from chain 1 to chain 3 (#528): today it is a
`production`-environment-only GitHub secret (see the Live table below — note staging has no
counterpart, secret or var, so staging deploys currently carry an empty value for it). Once
#528 lands it moves to a `wrangler.toml` literal and this file loses the row; written as three
chains instead of one, that move is a one-line edit here, not a section rewrite.

## Live secrets

| Secret | Scope | What it is | Value lives in / read by | Rotation |
|---|---|---|---|---|
| `ANON_ID_SECRET` | repo (no env override) | HMAC-SHA-256 key signing anonymous visitor IDs | GitHub repo secret → pushed to both Cloudflare Worker secret stores via CI's post-deploy-secrets step → read by `worker/auth.ts` | **Invalidates every existing `aid` cookie**, and since #514 `aid` also backs anonymous→signed-in session-ownership migration, so every unmigrated anonymous session's history is permanently orphaned, not just rate-limit counters reset. Set once. Breaks silently: `verifyAnonymousToken` (`worker/auth.ts`) just returns `null` on a signature mismatch — no error, the edge mints a fresh anonymous identity and session-migration reports "nothing to migrate" for visitors who actually had history |
| `TURNSTILE_SECRET` | repo (no env override) | Cloudflare Turnstile siteverify key. Must be the **Secret Key** (~35 chars), not the Site Key (~24) | GitHub repo secret → pushed to both Cloudflare Worker secret stores via CI's post-deploy-secrets step → read by `worker/turnstile.ts` | Safe. Missing or wrong → `guardTurnstile` fails closed and every anonymous request gets 403 `turnstile_required` — loud, not silent |
| `CLOUDFLARE_API_TOKEN` | repo + `staging` + `production` (env wins for staging/prod deploys; repo-level is the *only* one `preview.yml` uses, since PR previews run without an `environment:`) | Deploys Workers; needs `Workers Scripts:Edit` | All deploy jobs (`_deploy-component.yml`, `preview.yml`) | Rotating the environment-level value breaks staging/production deploys; rotating the repo-level value breaks PR-preview deploys only. Create the replacement first, update the secret, then revoke the old one |
| `CLOUDFLARE_ACCOUNT_ID` | repo + `staging` + `production` (same override rule as above) | Account identifier (not a credential, stored as a secret for convenience) | All deploy jobs | n/a |
| `CORS_ALLOWED_ORIGIN` | `production` only (no repo-level, no `staging` value at either scope) | Backend CORS allowlist | `_deploy-component.yml` → `CONTAINER_ENV_KEYS` → agent CORS middleware | Wrong value → the frontend origin gets CORS-blocked (browser console `blocked by CORS policy`, not a backend error). Staging currently deploys with this empty — pre-existing gap, not something #528 introduces |
| `MIMO_API_KEY` | repo (no env override) | **Production LLM.** MiMo `mimo-v2.5` is the only live model | Agent container, `agent-eval-nightly.yml` | Breaks every chat turn: the provider call 401/403s and the user sees the agent's generic failure response, never the raw provider error (SD-19 forbids surfacing upstream text). Note the key prefix rotates `tp-` → `sk-` on top-up |
| `DEEPSEEK_API_KEY` | repo (no env override) | Fallback model — **wired but disabled** (no balance) | Agent container | No live impact today; would surface the same way as `MIMO_API_KEY` once re-enabled |
| `GEMINI_API_KEY` | repo (no env override) | Gemini access via `settings.py`, required by the always-mounted `GeminiVisionProvider` | Agent container | Missing/empty → every photo-search request silently degrades to a clarify miss instead of recognizing anything (#502) — no error surfaces |
| `GOOGLE_MAPS_API_KEY` | repo (no env override) | Geocoding (`apps/agent/agent/infrastructure/gateways/geocoding.py`) | Agent container | Breaks geocoding — surfaces as a place-resolution failure, not a raw API error |
| `NEON_DATABASE_URL` | repo (**unreachable** — see "Same-name override rule"; no non-environment-scoped caller exists today) + `staging` + `production` | Catalog data plane | `_deploy-component.yml`'s Atlas-migrate step and the same job's `DATABASE_URL` env for the web deploy step. **Not** `purge-anon-quota-counts.yml` — that workflow reads `SUPABASE_DB_URL` and its own inline comment warns against this exact mix-up (issue #508 review) | Wrong value → Atlas migrate fails closed (`atlas migrate apply` errors) or the web deploy's `DATABASE_URL` points at the wrong branch; either way the deploy job fails loudly, it does not silently write to the wrong database |
| `NEON_API_KEY` | repo (no env override) | Neon branch management in CI | `ci.yml`, `neon-test-base.yml`, `preview.yml` | Breaks Neon test lanes and PR-preview branch creation, not production |
| `NEON_AUTH_JWKS_URL` | `staging` + `production` only (no repo-level fallback) | Neon Auth (Better Auth) JWKS endpoint for the dual-issuer JWT path | Worker edge (`worker/auth.ts`), gated by `NEON_AUTH_ENABLED` | Currently low-blast-radius: Neon Auth is provisioned but not yet the active issuer (SD-31), and tokens route by `alg`/`iss`, so a wrong JWKS URL would only affect a Neon-issued token if one ever arrives — unverified in production today since no live flow mints one yet |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_DB_URL` | repo (no env override) | Auth today; **migrating to Neon Auth (SD-31)** | Edge worker, agent container, web build | Breaks login — `SUPABASE_URL`/`SERVICE_ROLE_KEY` wrong → JWT/API-key verification 401s everything; `SUPABASE_DB_URL` wrong → the container fails its required-env check at boot (`buildContainerEnvVars` throws). `SUPABASE_ANON_KEY` is publishable by design |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | repo (no env override) | Map tiles, **build-time and public** — it ships in the client bundle | Web build | Restrict by URL in the Mapbox console, not by secrecy. Wrong value → map tiles 401 in the browser, visible immediately |
| `PULUMI_BACKEND_URL` · `PULUMI_CONFIG_PASSPHRASE` | repo (**unreachable** — no non-environment-scoped caller) + `staging` + `production` | Pulumi state on R2 and its encryption passphrase | `pulumi up` in the catalog deploy job | **Losing the passphrase makes existing state undecryptable.** Back it up outside this repo. This is the loudest possible failure: `pulumi up` refuses to proceed |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | repo (**unreachable** — no non-environment-scoped caller) + `staging` + `production` | R2 credentials for the Pulumi state bucket | Catalog deploy job | Wrong value → Pulumi's R2-backed state backend fails to authenticate, loud failure on the next `pulumi` invocation |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_BASE_URL` | repo (no env override) | Powers `dependabot-agent.yml` | That workflow only | No production impact |
| `LOGFIRE_TOKEN` | repo (**unreachable** — no non-environment-scoped caller) + `staging` + `production`, each a **different** Logfire project (`animichi-staging` / `animichi-prod`) as of 2026-07-29, replacing one shared `LOGFIRE_TOKEN_PROD`/`LOGFIRE_TOKEN_STAGING` pair that lived less than eight hours (wiring was #498) | Write token for the environment's Logfire project | Agent container | Traces stop for that environment only; nothing else breaks. The repo-level value (old `lifeodyssey/seichijunrei` project) cannot currently be reached by any deploy — see "Same-name override rule" |
| `GITLEAKS_LICENSE` | repo (referenced, **not currently set** — absent from `gh secret list`) | Gitleaks Pro license key | `_security.yml`, `ci.yml` | Per that workflow's own comment, only required once this becomes a GitHub organization repo (rate-limit workaround); this repo is personal-owned, so leaving it unset is intentional, not an oversight |

## Referenced by nothing

Found by grepping every secret name across `.github/workflows/` and `CONTAINER_ENV_KEYS`
against every source tree in the repo. **These are not one kind of finding** — read the action
column before batching a decision:

| Secret | Finding | Owner action |
|---|---|---|
| `GCP_SA_KEY` | A GCP service-account private key, added 2025-12, referenced nowhere in code or workflows — the only one of these five with a real blast radius if it leaked (a live cloud credential, not an inert config name) | Check GCP IAM for any usage of this SA outside this repo; if none, revoke it in GCP first, then `gh secret delete GCP_SA_KEY`. Open an issue to track — do not batch with the two below |
| `GCP_PROJECT_ID` | Companion to `GCP_SA_KEY`, same 2025-12 origin, referenced nowhere | Delete once `GCP_SA_KEY` is confirmed dead and revoked |
| `CLAUDE_CODE_OAUTH_TOKEN` | Added 2026-05, referenced nowhere | `gh secret delete CLAUDE_CODE_OAUTH_TOKEN` — no dependency to check first |
| `ZETA_API_KEY` | Listed in `CONTAINER_ENV_KEYS` (`worker/containerEnv.ts`) but **no workflow passes it**, so the container never receives a value even though the forwarding allowlist expects one. This is a broken chain, not dead config | Decide whether Zeta is still a wanted provider. If yes: wire it through the container-secret chain (see above) and move this row to Live. If no: remove it from `CONTAINER_ENV_KEYS` and `apps/agent/agent/config/model_aliases.py` / `apps/agent/agent/config/settings.py`'s references, and delete the GitHub secret |
| `OPENAI_COMPAT_API_KEY` | Read by `apps/agent/agent/config/settings.py` and `apps/agent/agent/config/model_aliases.py`, listed in `CONTAINER_ENV_KEYS`, but again **no workflow passes it** — same broken-chain shape as `ZETA_API_KEY` | Same decision as `ZETA_API_KEY`: wire it through or retire the references, don't just delete the secret and leave the code reading for it |

Deleting is a per-row decision, not a batch one: `GCP_SA_KEY` needs an external check before
deletion, the two broken chains need a keep-or-retire decision (not a delete), and only
`CLAUDE_CODE_OAUTH_TOKEN` is safe to delete immediately.

## Adding a new secret

Pick the matching chain from "Three consumption chains" above and follow its numbered steps —
using the wrong one silently under- or over-wires it. `MIMO_API_KEY` is the reference
implementation for the container-secret chain (all four touchpoints in place); `ANON_ID_SECRET`
/ `TURNSTILE_SECRET` for the Cloudflare-Worker-secret chain; `ANON_DAILY_COST_BUDGET_USD` for
the plain-var chain. Write a test asserting the key is present in whichever forwarding list
applies (`CONTAINER_ENV_KEYS`, `post_deploy_secrets`, or both).

## Handling

- Never paste a value into chat, a PR body, an issue, or a commit message. This repository
  has burned two secrets that way (a Turnstile secret on 2026-07-26, a Logfire read token
  on 2026-07-29) — in both cases the leak happened while *reporting* a rotation.
- Prefer flows where the value never surfaces: `gh secret set <NAME> --body "$(openssl rand -hex 32)"`,
  `wrangler secret put` fed from stdin, and interactive OAuth (`claude mcp add --transport http`,
  `logfire auth`) over a pasted token.
- When a value must be identified, quote a prefix and a length (`pylf_v…[55 chars]`), never
  the whole thing.
- `wrangler secret put` in a non-TTY answers "yes" to "Worker does not exist, create it?"
  and silently creates a stray Worker. Only run it **after** a confirmed deploy.
