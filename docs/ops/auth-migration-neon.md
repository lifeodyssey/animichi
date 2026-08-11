# Auth Migration: Supabase → Neon Auth (SD-31, Slice 1)

Status: executed 2026-07-10. **Cutover state as of AUTH-2 #950 (2026-08-11):** the edge verifies
Neon Auth JWTs only (JWKS-only, no Supabase fallback), `apps/web` logs in through the Better Auth
client, local login + E2E run on Neon, and the staging issuer/JWKS + QA login are declared in IaC.
The remaining Supabase surface is the agent container's legacy data-plane DSN (not auth).
Umbrella epic: #312.

Secret hygiene: this doc uses placeholders only. Real values live in the operator's CLI session,
Neon/Supabase dashboards, and env files (`.env.test`, CI secrets). Never commit project IDs, branch IDs, base/JWKS URLs, connection strings, or tokens.
| Placeholder | Meaning | Where to find it |
|---|---|---|
| `$NEON_PROJECT_ID` | Neon project id | `neonctl projects list --org-id $NEON_ORG_ID` |
| `$NEON_ORG_ID` | Neon org id | `neonctl orgs list` |
| `$NEON_AUTH_BRANCH` | branch id running Neon Auth (default branch) | `neonctl neon-auth status --project-id $NEON_PROJECT_ID` |
| `$NEON_AUTH_BASE_URL` | Better Auth base URL (`…/neondb/auth`) | same `status` output |
| `$NEON_AUTH_JWKS_URL` | `$NEON_AUTH_BASE_URL/.well-known/jwks.json` | same `status` output |
| `$NEON_API_TOKEN` | Neon API bearer (OAuth token or API key) | `~/.config/neonctl/credentials.json` / CI `NEON_API_KEY` |
| `$SUPABASE_PROJECT_REF` | legacy Supabase project ref | `.env.test` `SUPABASE_URL` |

`neonctl` is not on PATH on the dev machine — invoke as `npx --yes neonctl …` (v2.30.1 verified).

## 1. State at migration time

**Supabase (legacy, still serving production login):**
- Project restored from pause; GoTrue v2.192.0, `GET $SUPABASE_URL/auth/v1/health` → 200.
- Magic-link only (no OAuth identities, no passwords in practice). Emails sent by the `send-auth-email` Edge Function (Resend in prod, Mailpit locally) — fully Seichijunrei-branded (subject 「聖地巡礼 — ログインリンク」, sender `noreply@seichijunrei.zhenjia.dev`).
- QA login: `scripts/qa_auth.py` (admin `generate_link`, no email) as `qa-bot@seichijunrei.test`. **Retired at cutover** (AUTH-2 #950) with the Supabase login path.

**Neon Auth (target):**
- Provider `better_auth` on the project's default branch, database `neondb`, schema `neon_auth` (tables: `user`, `account`, `session`, `verification`, `jwks`, `organization`, `member`, `invitation`, `project_config`). JWKS provisioned.
- Every Neon branch gets an isolated auth environment; staging and disposable test branches need
  their own QA user provisioning (§4).

## 2. Configuration applied (2026-07-10)

| Item | Before | After | How |
|---|---|---|---|
| `magic_link` plugin | disabled | **enabled** (expiry 5 min, sign-up allowed) | raw API — CLI has no write wrapper (§6) |
| `email_and_password` | enabled (OTP verification, verification not required) | unchanged — **QA path depends on it; do not disable** | — |
| Email provider | `shared` (Neon-operated sender) | unchanged (`shared`) | see limits below |
| Webhook | disabled, no events | unchanged | future: `send.magic_link` event for fully branded emails |
| OAuth providers | `google` (shared dev credentials) | unchanged | prod credentials = owner action |
| Trusted domains | empty; `allow_localhost: true` | unchanged | add prod domain at S0.6 |

**Email branding reality on `shared`:** sender is fixed `Neon Auth <auth@mail.myneon.app>` — `--sender-name/--sender-email` are explicitly ignored for `shared` (CLI warns). The template itself auto-brands from the project name: verified delivered email has subject **"Sign In to animichi"** and body signed "animichi". Full Animichi sender branding requires `--type standard` + own SMTP (owner action list, §7). Verified end-to-end: magic-link email delivered to the QA mailbox in ~2 s via Neon's shared sender (SendGrid infrastructure, click-tracking-wrapped link).

## 3. User migration

Source inventory (Supabase `auth.users` via admin API): **7 users** — 5 real (incl. owner), 1 QA identity, 1 disposable. All email/magic-link, none confirmed-with-password, no OAuth.

Method: `neonctl neon-auth user create --project-id $NEON_PROJECT_ID --email <email>` per user. **Idempotent**: re-running an existing email fails cleanly with `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` and writes nothing (verified). Verify with SQL: `select email from neon_auth."user"` over `neonctl connection-string --database-name neondb`.

| Email (masked) | Class | Migrated | Note |
|---|---|---|---|
| `z***@outlook.com` | owner | ✅ | |
| `r***@gmail.com` | real | ✅ | |
| `s***@duck.com` | real | ✅ | |
| `j***@163.com` | real | ✅ | |
| `5***@qq.com` | real | ✅ | |
| `seichijunreiqa@mails.dev` | QA (receivable mailbox) | ✅ (was never in Supabase auth) | `mails` CLI mailbox |
| `qa-bot@animichi.test` | QA (new brand) | ✅ created via sign-up with password | replaces `qa-bot@seichijunrei.test` |
| `qa-bot@seichijunrei.test` | QA (legacy) | ❌ deliberately | retires with Supabase (#312 step 4) |
| `je***@gmeenramy.com` | disposable | ❌ deliberately | never confirmed, never signed in |

Result: **7 users in `neon_auth."user"`**. Full unmasked email + old-UUID → new-ID mapping lives operator-local (Claude project memory `reference_auth_migration_mapping.md`); it is required for #312 step 2.

Post-migration facts:
- Migrated users have `emailVerified = false` and a placeholder `credential` account row created by the CLI. No usable password exists; they sign in via magic link (verification flips on first login). Password reset would require access to their inbox, so the placeholder rows are not an account-takeover surface.
- **User-ID remap is mandatory at operational-data migration** (#312 step 2): `sessions` / `messages` / `user_memory` rows carry Supabase UUIDs; translate `user_id` via the mapping table when moving them to Neon.

## 4. QA / agent login paths (Neon Auth world)

`Origin: http://localhost:3000` (or any localhost origin; `allow_localhost` is on) is **required** on POSTs — Better Auth rejects origin-less requests. Env vars: `QA_NEON_USER_EMAIL` / `QA_NEON_USER_PASSWORD` in `.env.test` (local) and CI secrets (owner action).

**Path A — password sign-in (CI default; zero email dependency):**
```bash
# 1. sign in, capture the HttpOnly session cookie
curl -s -c /tmp/qa.jar -X POST "$NEON_AUTH_BASE_URL/sign-in/email" \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d "{\"email\":\"$QA_NEON_USER_EMAIL\",\"password\":\"$QA_NEON_USER_PASSWORD\"}"
# 2. exchange cookie for a JWT (EdDSA, kid-signed, 15-min expiry)
curl -s -b /tmp/qa.jar -H "Origin: http://localhost:3000" "$NEON_AUTH_BASE_URL/token"
```
Notes: the JSON `token` returned by sign-in is an opaque session token; `Authorization: Bearer <session token>` against `/token` is **401** (bearer plugin off) — the cookie is the credential. Playwright: `request.post` sign-in inside the browser context sets the cookie automatically; API-level tests take the `/token` JWT.

**Path B — real email round-trip (prod-like, magic link):**
```bash
curl -s -X POST "$NEON_AUTH_BASE_URL/sign-in/magic-link" \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"email":"seichijunreiqa@mails.dev","callbackURL":"http://localhost:3000/auth/callback"}'
mails inbox --full-id | head -2        # newest email id
mails inbox <id>                       # body contains the sign-in link (SendGrid-wrapped)
# visit the link (follows to $NEON_AUTH_BASE_URL/magic-link/verify?token=…) → session established
```
`mails code` does NOT work here (it waits for numeric codes; magic-link mail has none). Link expiry: 5 minutes.

**Path C — DB token read (per-branch fallback, no inbox needed):**
Magic-link tokens are rows in `neon_auth.verification` (`identifier` = raw token, `value` = `{"email": …}`). After requesting a magic link, reconstruct:
`$NEON_AUTH_BASE_URL/magic-link/verify?token=<identifier>&callbackURL=<url>`.
Useful on staging or disposable test branches where only Postgres access is handy. Treat as
fallback — it bypasses email delivery, so keep Path B in the suite too.

**Branch provisioning** (auth is branch-isolated): re-run `user create` for QA identities and one
sign-up POST for the password user against that branch's own base URL (`neonctl neon-auth status
--branch <id>`), same commands as above.

## 5. Cutover checklist (S0.6 / S0.8 — executed AUTH-2 #950)

- [x] apps/web login UI on Better Auth client SDK pointed at `$NEON_AUTH_BASE_URL` (magic link + email OTP; Google/Apple/X once prod OAuth creds exist).
- [x] Edge worker: **JWKS-only Neon verification** — fetch + cache `$NEON_AUTH_JWKS_URL`, verify EdDSA signature by `kid`, check `iss`/`aud` == auth base URL and `exp`; Supabase verification and the dual-issuer flag are **deleted** (AUTH-2 #950 hard cut). Production JWKS stays unset until its Neon Auth branch is provisioned — empty fails closed.
- [ ] `neonctl neon-auth domain add <prod-domain>` (trusted redirect origins; keep `allow-localhost` for dev).
- [ ] Branded email decision: `email-provider update --type standard` with own SMTP **or** webhook `send.magic_link` → own sender function (successor of `send-auth-email`, #312 step 3).
- [x] CI: `QA_NEON_USER_EMAIL` var + `QA_NEON_USER_PASSWORD` secret; E2E login on Path A/B; `scripts/qa_auth.py` + `scripts/qa_login.sh` + Mailpit auth-hook infra retired with the Supabase login path.
- [x] Local login on Neon: `make local-login` → `scripts/local-login.sh` (magic link, token read from the branch DB — Path C).
- [x] Staging issuer/JWKS + QA login declared in IaC (`infra/src/neon-auth.ts`, `infra/neon-secrets`) — applied on the next `pulumi up` with the config keys set.
- [ ] Operational tables (#312 step 2): migrate `sessions`/`messages`/`user_memory` **with user-id remap** (mapping file, §3).
- [ ] RLS on Neon per Neon Auth docs before exposing user-scoped data.
- [ ] Supabase retirement (#312 step 4): only after all above verified — dump `auth.users` as backup, then decommission (project, `supabase/` dir, env vars, deps).

## 6. Command reference (as executed)

```bash
npx --yes neonctl neon-auth status --project-id $NEON_PROJECT_ID
npx --yes neonctl neon-auth user create --project-id $NEON_PROJECT_ID --email <email>   # per user; idempotent error on repeat
npx --yes neonctl neon-auth plugins list --project-id $NEON_PROJECT_ID -o json
npx --yes neonctl neon-auth config email-provider get --project-id $NEON_PROJECT_ID -o json

# magic_link enable — not wrapped by CLI (v2.30.1); raw Neon API:
curl -X PATCH "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$NEON_AUTH_BRANCH/auth/plugins/magic-link" \
  -H "Authorization: Bearer $NEON_API_TOKEN" -H "Content-Type: application/json" -d '{"enabled": true}'

# QA password user (one-time per branch; password only in env/secret stores):
curl -X POST "$NEON_AUTH_BASE_URL/sign-up/email" -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{\"email\":\"$QA_NEON_USER_EMAIL\",\"password\":\"$QA_NEON_USER_PASSWORD\",\"name\":\"QA Bot\"}"
```

Related API surface (in `@neon/sdk`, mostly unwrapped by CLI): `updateNeonAuthEmailAndPasswordConfig`, `updateNeonAuthWebhookConfig`, `createNeonAuthProviderSdkKeys` (app SDK keys for S0.6), `deleteNeonAuthUser`, `updateNeonAuthUserRole`.

## 7. Owner action list

1. **Branded sender (optional until cutover):** pick an SMTP provider (Resend already holds the prod key for Supabase emails and offers SMTP), then
   `neonctl neon-auth config email-provider update --type standard --host <smtp-host> --port 587 --username <user> --password <key> --sender-email noreply@<sending-domain> --sender-name Animichi`
   DNS needed at the sending domain: provider-issued **SPF TXT** + **DKIM CNAME/TXT** records (values from the provider dashboard; none are committed here). Until then emails arrive as "Neon Auth <auth@mail.myneon.app>" with subject "Sign In to animichi".
2. **CI secrets:** add `QA_NEON_USER_PASSWORD` (value = local `.env.test`) as a GitHub Actions secret; `QA_NEON_USER_EMAIL=qa-bot@animichi.test` as a variable.
3. **Optional mailbox rebrand:** `mails claim animichiqa` (browser approval at mails.dev, max 10 mailboxes), then `neon-auth user create` for it and swap Path B's address. `seichijunreiqa@mails.dev` keeps working meanwhile.
4. **OAuth production credentials** (pre-cutover): Google/Apple/X client id+secret via `neonctl neon-auth oauth-provider update`; LINE via generic OAuth. Current `google` entry uses shared dev credentials — not for production.
5. **Supabase-side branding (optional, recommend skip):** live magic-link emails are still Seichijunrei-branded inside the deployed `send-auth-email` Edge Function; changing it means `supabase login` + function redeploy (deploy-coupled). Cutover retires it entirely — spend nothing here unless pre-cutover polish matters.
6. **Decide** whether the skipped disposable signup (`je***@gmeenramy.com`, never confirmed) should be preserved anywhere before Supabase deletion. Default: let it die with Supabase.

## 8. Staging cut state (AUTH-2 #950)

Status: **hard cut, committed 2026-08-11** (`0ed18d1c` + `6addec65`). The dual-issuer era is over.

**What the edge verifies today:** the edge Worker (`workers/edge/src/identity/auth.ts`) verifies
Neon Auth EdDSA JWTs against **one** source of truth — `NEON_AUTH_JWKS_URL` — and nothing else.
The `NEON_AUTH_ENABLED` activation flag and the split `NEON_AUTH_ISSUER` var are deleted;
issuer/audience are **derived from the JWKS URL** (`issuerFromJwksUrl`, the same derivation the
retired `workers/users/src/auth/jwt.ts` used). The Supabase verifier is gone; a non-Bearer scheme is
"absent", and a bearer that fails Neon verification is 401 — no fallback, no silent demotion.
Users trusts only the edge's forwarded identity (`X-User-Id`), rejecting raw bearer and forged
headers.

**Web seam:** `apps/web` logs in through the Better Auth client (`src/lib/auth/neon-auth.ts`:
magic-link + JWT exchange), caches the EdDSA JWT in `src/lib/auth/auth-session.ts`, and sends it as
`Authorization: Bearer` to the edge via `sessionHeaders()`. The browser session cookie lives on the
Neon Auth origin (`credentials: "include"`), so it survives reloads; the edge verifies the JWT
against the branch JWKS.

**Local login + E2E (no Supabase):** `make local-login` → `scripts/local-login.sh` requests a
magic link from the Neon Auth origin and opens the verify URL (token read from the branch's
`neon_auth.verification` — Path C, §4). The Playwright suite stubs every transport and runs
without `supabase start`; the one live spec (`e2e/web-neon-login.spec.ts`) drives the real Neon
origin via Path A and self-skips without `QA_NEON_USER_*`.

**IaC declarations (no pulumi run yet):** the staging issuer/JWKS derivation and QA login creds are
declared in `infra/src/neon-auth.ts` (pure derivation, pinned by `topology-neon-auth.test.ts`),
exported from `infra/index.ts` (`neonAuthJwksUrl`, `neonAuthIssuer`, `qaNeonUser*`), and provisioned
as Cloudflare Secrets Store secrets in `infra/neon-secrets` — all config-gated, so stacks apply
unchanged until an operator sets `neonAuthBaseUrl` / `qaNeonUser*`.

**Production:** `NEON_AUTH_JWKS_URL` is **not set for the edge Worker** (wrangler vars leave it
empty) — the production edge fails closed on any bearer until its Neon Auth branch is provisioned.
Provisioning the prod Neon Auth branch and setting the JWKS is an owner-sequenced step (tests in
`workers/edge/test/auth-config.test.ts` pin the unset state). CI still uploads a
`NEON_AUTH_JWKS_URL` secret to the **users** Worker (staging + prod); that upload is now a dead
binding — users trusts only the edge-forwarded identity and no longer reads it (AUTH-2 #950), so it
can be dropped from `worker_secrets` at the next deploy-touch.

**Rollback to dual-issuer is not available** — the flag, the Supabase verifier, and the users
JWKS/bearer verifier are deleted. Correcting a staging issuer now means fixing the derived JWKS URL
(`wrangler.toml` `[env.staging.vars]` or the neon-secrets secret) and re-deploying, not flipping a
switch.
