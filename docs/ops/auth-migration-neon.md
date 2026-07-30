# Auth Migration: Supabase → Neon Auth (SD-31, Slice 1)

Status: executed 2026-07-10. Users migrated, Neon Auth login-ready, QA login paths validated.
Scope of this slice: **data migration + new-system configuration + test-login design only. No traffic cutover** — the edge worker JWT check and the login UI still run on Supabase until S0.6/S0.8 (apps/web rebuild). Umbrella epic: #312.

Secret hygiene: this doc uses placeholders only. Real values live in the operator's CLI session, Neon/Supabase dashboards, and env files (`.env.test`, CI secrets). Never commit project IDs, branch IDs, base/JWKS URLs, connection strings, or tokens.

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
- QA login: `scripts/qa_auth.py` (admin `generate_link`, no email) as `qa-bot@seichijunrei.test`. Stays in place until cutover.

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

## 5. Cutover checklist (S0.6 / S0.8 — do NOT start in this slice)

- [ ] apps/web login UI on Better Auth client SDK pointed at `$NEON_AUTH_BASE_URL` (magic link + email OTP; Google/Apple/X once prod OAuth creds exist).
- [ ] Edge worker: replace the remote `${SUPABASE_URL}/auth/v1/user` lookup with **local JWKS verification**: fetch + cache `$NEON_AUTH_JWKS_URL`, verify EdDSA signature by `kid`, check `iss`/`aud` == auth base URL and `exp`. Claims carry `sub`/`id`, `email`, `emailVerified`, `role`, `banned`.
- [ ] `neonctl neon-auth domain add <prod-domain>` (trusted redirect origins; keep `allow-localhost` for dev).
- [ ] Branded email decision: `email-provider update --type standard` with own SMTP **or** webhook `send.magic_link` → own sender function (successor of `send-auth-email`, #312 step 3).
- [ ] CI: `QA_NEON_USER_EMAIL` var + `QA_NEON_USER_PASSWORD` secret; port E2E login to Path A/B; retire `scripts/qa_auth.py` + `scripts/qa_login.sh` + Mailpit auth-hook infra with the Supabase login path.
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
