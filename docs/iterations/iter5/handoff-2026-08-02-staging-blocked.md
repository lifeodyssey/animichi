# Animichi handoff — PR closure complete, staging promotion blocked

Generated: 2026-08-02T15:28:30Z

## Next-session focus

Resume the Animichi delivery plan from the staging configuration blockers. Do not start S1 or production promotion until staging is green. The user asked for PR-based work and for the root agent to review/orchestrate; code-writing belongs in an independent worker clone/worktree, one logical fix per commit.

## Current repository state

- Root checkout is intentionally untouched and dirty. Branch: `feat/frontend-rebuild`, behind its remote by 3 commits. Preserve all existing untracked files; do not reset, clean, or layer new work there.
- `origin/main` is `15c6f013ff2d6479a90b69ce8add781931b84769`.
- Open PRs: none. The current open-PR zero state must be preserved unless a new docs/fix PR is explicitly authorized and then merged/closed through the normal review gates.
- Phase-0 recovery archive and SHA manifest were created outside the repo and independently decrypt/list/sample-verified. Refer to the earlier handoff/recovery artifact; never delete original sources or expose archive keys.
- A credential was accidentally exposed earlier in the conversation. Do not repeat it; the user must rotate that credential.

## Completed PR work

These implementation PRs are merged into `main`; inspect their PR pages/commits instead of duplicating their diffs:

| PR | Scope | Merge commit |
|---|---|---|
| https://github.com/lifeodyssey/animichi/pull/627 | S0.3 CI/Codecov/rules | `667d0d595ba1e9744d0979eb64ddcfb98ebfcc8d` |
| https://github.com/lifeodyssey/animichi/pull/628 | S0.4 private R2 tiles and `/tiles/*` proxy | `f73a1e054151e4ea4d67c1e8468bf32c7d220e63` |
| https://github.com/lifeodyssey/animichi/pull/629 | S0.6 privacy/Storybook/Codecov v7 | `8138eb5e87049ba3d2a76f7fb7483b5c429a8465` |
| https://github.com/lifeodyssey/animichi/pull/630 | S0.7 CSS splash/system theme/mobile perf | `6de73315bfa462759fc6f84164e7c897213e3d8e` |
| https://github.com/lifeodyssey/animichi/pull/631 | S0.9 Atlas migration authority | `15c6f013ff2d6479a90b69ce8add781931b84769` |

PR #631 established Atlas as the only Neon migration authority (`db/migrations/*.sql` + `atlas.sum`); Drizzle remains runtime query/type-only. It also preserved the latest S0.6/S0.7 files after a safe main sync.

## Branch ruleset and negative tests

Ruleset `protect main` (ID `19974534`) is active for the default branch. It has:

- required PR before merge;
- required review-thread resolution;
- zero mandatory human approvals;
- required checks: `Web CI`, `Backend CI`, `Agent CI`, `Infra & DB CI`, `Cross-stack E2E`, `Repository Quality`, `Codecov Patch`;
- no bypass actors, no direct push/force push, rebase-only merge, no merge queue.

Temporary PR tests for unresolved conversation, missing required checks, and direct push were all rejected as intended; their branches/PRs were cleaned up.

## Latest CI/deployment evidence

Main push run: https://github.com/lifeodyssey/animichi/actions/runs/30737053650

- All seven required code/quality gates succeeded, including CodeQL/security/component tests.
- Overall run is `failure` only because staging deployment jobs failed; production jobs were skipped by `needs` and were not attempted.
- `Deploy staging` (catalog), `Deploy users staging`, Atlas migration, Pulumi, and their smoke portions succeeded.
- `Deploy web staging` failed at the explicit preflight because `vars.VITE_TURNSTILE_SITE_KEY` is empty/unset. The reusable workflow reads public Vite configuration from GitHub `vars`, not secrets.
- `Deploy root staging` built the container and reached Wrangler, then failed at Cloudflare Containers API `/accounts/<redacted>/containers/me` with HTTP 403 Authentication error. The catalog Worker succeeding does not prove the root container permission is present.
- `staging.animichi.com` currently has no DNS answer and an HTTPS probe cannot establish a public endpoint, so no live staging/browser evidence exists yet.

Cloudflare's current official permission reference lists account-scoped `Containers Edit` separately from Workers permissions: https://developers.cloudflare.com/fundamentals/api/reference/permissions/

## Hard blockers requiring operator authority

Do not invent or commit values. The repository/environment variable-name checks showed no `VITE_*` variables at the staging or repository scope (organization-variable listing was unavailable/404). The operator must configure, in GitHub's `staging` environment:

1. Public Actions variables (not secrets): `VITE_NEON_AUTH_BASE_URL` and `VITE_TURNSTILE_SITE_KEY`. Optional explicit public origin/service variables are documented by the workflow: `VITE_SITE_ORIGIN`, `VITE_CATALOG_URL`, `VITE_USERS_URL`, `VITE_AGENT_URL`.
2. A replacement `CLOUDFLARE_API_TOKEN` secret with account-scoped `Containers Edit` plus the existing Worker/R2 permissions needed by the rest of the deployment. Never paste the token into chat or logs.
3. After the values are set, rerun the failed main deployment (or an appropriately scoped failed-job rerun) and verify public DNS/HTTPS, root container readiness, auth callback/JWKS, R2 `/tiles/*`, smoke, and post-staging checks.

Production must remain unattempted until staging is fully green and the user performs the configured production environment approval. S0.8 is intentionally deferred until after production launch. S1.1–S1.13 are not started; their production ACs remain open.

## Pending docs-only commit

A worker created a safe documentation-only commit in an independent temporary clone:

- Clone: `/private/tmp/animichi-docs-staging-prereqs.lYMpUk/repo`
- Branch: `codex/docs-staging-prereqs`
- Commit: `de0705697a42d62f1729b7d2c04b44f515147907`
- File: `docs/ops/deployment.md` only, 23 lines. It documents the two Vite vars, the Containers permission, and staging-to-production gating; it contains no secret values.
- `git diff --check` passed. `make check` was attempted but blocked in the fresh clone by dependency/network/toolchain issues; do not call it green.
- Push was not performed: external-write approval rejected the push as potentially sensitive deployment documentation, and the local GitHub CLI authentication is invalid. The worker did not create a PR.

Before pushing this commit, obtain explicit user authorization for the docs-only external write and have the user re-authenticate GitHub CLI. If they do not authorize it, leave the commit in the temp clone and do not open a PR.

## Next actions

1. Wait for the user's explicit authorization and GitHub CLI re-authentication; decide whether to push `de070569` as a draft docs PR.
2. In parallel, have the operator configure the staging variables/token above without sharing values in chat.
3. Re-run staging through GitHub Actions only; no local deploy. Review every job and public endpoint, then resolve S0.4/S0.6/S0.7 evidence.
4. Only after staging is fully green, request the user's production environment approval and then perform S0 production smoke/rollback verification.
5. After production, execute S0.8 SEO/IndexNow/LHCI/canonical/OG/DNS/auth-callback/crawler/GSC/Bing evidence. Start S1 only within the agreed staging-only boundary.

## Suggested skills

- `github:github` — inspect PRs, rulesets, environments, and Actions metadata.
- `github:gh-fix-ci` — diagnose the failed staging workflow after operator configuration.
- `github:yeet` — publish the explicitly authorized docs-only PR using the project PR workflow.
- `cloudflare:wrangler` and `cloudflare:workers-best-practices` — verify root container/Worker permissions and runtime behavior; do not deploy locally.
- `atlas` — validate migration authority if any migration work resumes.
- `code-review` / `audit` — review any new PR before merge; preserve the required-check and conversation-resolution gates.
- `handoff` — use again if this task is handed to another agent.

## Safety constraints

- Never edit the dirty root checkout; use a fresh clone/worktree per fix.
- Never paste, print, or commit secrets, API keys, cookies, magic links, or access tokens.
- Never claim staging/production green from static tests, Pulumi output, or a successful ordinary Worker deploy alone.
- Do not delete the phase-0 originals or recovery archive without separate explicit authorization.
