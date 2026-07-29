# Secrets inventory

What every GitHub repository secret is for, who consumes it, and what breaks if it is
rotated. Written 2026-07-29 after setting `ANON_ID_SECRET` blind — the value went in with
no record anywhere of what it does.

Companion to [`deployment.md`](./deployment.md), which covers non-secret environment
variables. **Values never appear here, in commit messages, in PR bodies, or in chat** —
see the "Handling" section at the bottom.

## Live secrets

| Secret | What it is | Consumed by | Rotation |
|---|---|---|---|
| `ANON_ID_SECRET` | HMAC-SHA-256 key signing anonymous visitor IDs (`worker/auth.ts`) | Edge worker | **Invalidates every existing `aid` cookie.** Visitors get fresh anonymous identities and per-identity rate-limit counters reset to zero. Set once. |
| `TURNSTILE_SECRET` | Cloudflare Turnstile siteverify key. Must be the **Secret Key** (~35 chars), not the Site Key (~24) | Edge worker (`worker/turnstile.ts`) | Safe. Missing or wrong → `guardTurnstile` fails closed and every anonymous request gets 403 `turnstile_required` |
| `CLOUDFLARE_API_TOKEN` | Deploys Workers; needs `Workers Scripts:Edit` | All deploy jobs, `preview.yml` | Breaks all deploys until updated. Create the replacement first, update the secret, then revoke the old one |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier (not a credential, stored as a secret for convenience) | All deploy jobs | n/a |
| `MIMO_API_KEY` | **Production LLM.** MiMo `mimo-v2.5` is the only live model | Agent container, `agent-eval-nightly.yml` | Breaks every chat turn. Note the key prefix rotates `tp-` → `sk-` on top-up |
| `DEEPSEEK_API_KEY` | Fallback model — **wired but disabled** (no balance) | Agent container | No live impact today |
| `GEMINI_API_KEY` | Gemini access via `settings.py` | Agent container | |
| `GOOGLE_MAPS_API_KEY` | Geocoding (`infrastructure/gateways/geocoding.py`) | Agent container | Breaks geocoding |
| `NEON_DATABASE_URL` | Catalog data plane | Catalog worker, `purge-anon-quota-counts.yml` | Breaks catalog reads |
| `NEON_API_KEY` | Neon branch management in CI | `ci.yml`, `neon-test-base.yml`, `preview.yml` | Breaks Neon test lanes, not production |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_DB_URL` | Auth today; **migrating to Neon Auth (SD-31)** | Edge worker, agent container, web build | Breaks login. `SUPABASE_ANON_KEY` is publishable by design |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Map tiles, **build-time and public** — it ships in the client bundle | Web build | Restrict by URL in the Mapbox console, not by secrecy |
| `PULUMI_BACKEND_URL` · `PULUMI_CONFIG_PASSPHRASE` | Pulumi state on R2 and its encryption passphrase | `pulumi up` in the catalog deploy job | **Losing the passphrase makes existing state undecryptable.** Back it up outside this repo |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | R2 credentials for the Pulumi state bucket | Catalog deploy job | |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_BASE_URL` | Powers `dependabot-agent.yml` | That workflow only | No production impact |
| `LOGFIRE_TOKEN` | Write token for the **old** `lifeodyssey/seichijunrei` project | Agent container | Traces stop; nothing else breaks |
| `LOGFIRE_TOKEN_PROD` · `LOGFIRE_TOKEN_STAGING` | Write tokens for `animichi-prod` / `animichi-staging`, created 2026-07-29 | **Nothing yet — wiring is #498** | |

## Referenced by nothing

Found by grepping every secret name across `.github/workflows/`, `worker/`, `apps/`,
`packages/` and `workers/`. Each of these is either dead or a broken chain; none of them
announces itself, which is the point of writing this down.

| Secret | Finding |
|---|---|
| `ZETA_API_KEY` | Listed in `CONTAINER_ENV_KEYS` (`worker/containerEnv.ts`) but **no deploy workflow passes it**, so the container never receives it. Dead config in the exact shape described in the env-var chain rule |
| `OPENAI_COMPAT_API_KEY` | Read by `config/settings.py` and `model_aliases.py`, but again **no workflow passes it** |
| `GCP_PROJECT_ID` · `GCP_SA_KEY` | Added 2025-12, referenced nowhere. Almost certainly left over from a pre-Cloudflare deployment target |
| `CLAUDE_CODE_OAUTH_TOKEN` | Added 2026-05, referenced nowhere |

Deleting the dead ones is a separate decision — verify against workflow history first,
since a secret can be referenced by a workflow that was later deleted and may be restored.

## Adding a new secret

A secret reaching the container has to be threaded through **four** places. Missing any
one is silent: the deploy succeeds and the feature is simply inert.

1. `gh secret set <NAME>` — the GitHub repository secret
2. `.github/workflows/_deploy-component.yml` — declare it under `secrets:` **and** pass it
   in the `env:` of the step that needs it. Callers (`ci.yml`, `deploy.yml`) must forward
   it too; a reusable workflow does not inherit secrets unless told to
3. `worker/containerEnv.ts` — add the name to `CONTAINER_ENV_KEYS`, or the worker drops it
   even when wrangler has it
4. This file, plus the environment tables in `deployment.md` if it is not secret-shaped

Write a test asserting the key is present in the forwarding list. `ANON_DAILY_COST_BUDGET_USD`
is the reference implementation with all four in place.

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
