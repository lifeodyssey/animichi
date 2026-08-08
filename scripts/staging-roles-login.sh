#!/usr/bin/env bash
set -euo pipefail

# Staging least-privilege role wiring (#832) — one-shot, idempotent.
#
# N1 (db/migrations/20260806120000_role_matrix_n1.sql) created the service
# roles as NOLOGIN. This script flips catalog_svc / agent_svc / users_svc /
# jobs_svc to LOGIN with per-role passwords, and can also write the
# per-component DSNs into the staging GitHub environment secrets.
#
# ── Execution (owner; CI/CD or local) ────────────────────────────────────────
#   Option A — local (recommended): psql must be on PATH
#       (macOS: brew install libpq && brew link --force libpq).
#       Your shell must be able to reach the STAGING Neon endpoint (the host
#       inside NEON_DATABASE_URL; tunnel/VPN if your role's IP allowlist
#       demands it).
#   Option B — CI/CD: run the same commands from a manual workflow_dispatch
#       job with NEON_DATABASE_URL and the role passwords injected as job
#       secrets. This script never prints a password (only a sha256-8 prefix
#       per role, the repo's established redaction convention), so it is safe
#       in public logs.
#
# ── Prepare (passwords come from environment variables — never hardcoded) ───
#   URL-safe charset ONLY (the DSN builder refuses anything else):
#       export CATALOG_SVC_PASSWORD="$(openssl rand -base64 24 | tr '+/' '-_')"
#       export USERS_SVC_PASSWORD="$(openssl rand -base64 24 | tr '+/' '-_')"
#       export AGENT_SVC_PASSWORD="$(openssl rand -base64 24 | tr '+/' '-_')"
#       export JOBS_SVC_PASSWORD="$(openssl rand -base64 24 | tr '+/' '-_')"
#       export NEON_DATABASE_URL="postgresql://<migrator-role>:<pw>@<host>:5432/<db>?sslmode=require"
#   NEON_DATABASE_URL must be the STAGING DSN (same secret CI's Atlas apply
#   uses). The ALTERs run against its host, so the passwords are set on the
#   staging branch's endpoint only — production is untouched, per #832.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#   bash scripts/staging-roles-login.sh                # ALTER ROLE ... LOGIN PASSWORD x4
#   bash scripts/staging-roles-login.sh --set-secrets  # + write the three DSN
#                                                      #   staging env secrets
#   bash scripts/staging-roles-login.sh --verify       # only re-check rolcanlogin
#
# ── Role -> staging secret mapping (#832) ───────────────────────────────────
#   catalog_svc -> CATALOG_DATABASE_URL  (catalog Worker DATABASE_URL binding)
#   users_svc   -> USERS_DATABASE_URL    (users Worker DATABASE_URL binding)
#   jobs_svc    -> AGENT_DATABASE_URL    (maintenance component — the Worker is
#                                         named jobs / maintenance-staging and
#                                         binds AGENT_DATABASE_URL per its
#                                         wrangler.toml [secrets].required)
#   agent_svc   -> (no secret yet: the root container still connects through
#                   SUPABASE_DB_URL; wire agent_svc's DSN when the agent's
#                   data-plane connection is cut over in a follow-up)
#
#   Each DSN = NEON_DATABASE_URL with user:pass replaced by <role>:<password>
#   (same host/db/params — same staging branch). The script builds these
#   internally; to set them BY HAND instead of --set-secrets:
#       printf '%s' "postgresql://catalog_svc:<CATALOG_SVC_PASSWORD>@<host>:5432/<db>?sslmode=require" \
#         | gh secret set CATALOG_DATABASE_URL --env staging
#       (same for USERS_DATABASE_URL with users_svc, AGENT_DATABASE_URL with jobs_svc)
#
# ── Rotation ─────────────────────────────────────────────────────────────────
#   Re-run with new password env vars to rotate. The DSN secrets must change
#   in lockstep, so --set-secrets (ALTER + secret write in one run) is the
#   rotation path; deployed Workers pick up the new secret values on the next
#   deploy/restart.

MODE_SECRETS=0
MODE_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --set-secrets) MODE_SECRETS=1 ;;
    --verify) MODE_VERIFY=1 ;;
    --help|-h) sed -n '1,80p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "✗ $*" >&2; exit 1; }

# ── Preconditions ────────────────────────────────────────────────────────────
command -v psql >/dev/null 2>&1 || fail "psql not found — brew install libpq"
[ -n "${NEON_DATABASE_URL:-}" ] || fail "NEON_DATABASE_URL must be set (the STAGING owner/migrator DSN)"
case "$NEON_DATABASE_URL" in
  *://*@*/*) : ;;
  *) fail "NEON_DATABASE_URL must look like postgresql://user:pass@host:5432/db?... (got a value without user:pass@ authority)" ;;
esac

ROLES=(catalog_svc users_svc agent_svc jobs_svc)

password_for() {
  case "$1" in
    catalog_svc) printf '%s' "${CATALOG_SVC_PASSWORD:-}" ;;
    users_svc)   printf '%s' "${USERS_SVC_PASSWORD:-}" ;;
    agent_svc)   printf '%s' "${AGENT_SVC_PASSWORD:-}" ;;
    jobs_svc)    printf '%s' "${JOBS_SVC_PASSWORD:-}" ;;
    *) echo "internal error: unknown role $1" >&2; exit 2 ;;
  esac
}

URL_SAFE_RE='^[A-Za-z0-9._~-]+$'
PASSWORDS=()
for role in "${ROLES[@]}"; do
  pass="$(password_for "$role")"
  [ -n "$pass" ] || fail "password for $role is unset — export ${role^^}_PASSWORD (see header comment)"
  [[ "$pass" =~ $URL_SAFE_RE ]] || fail "password for $role contains characters outside [A-Za-z0-9._~-] (URL-safe); generate with: openssl rand -base64 24 | tr '+/' '-_'"
  PASSWORDS+=("$pass")
done

if [ "$MODE_SECRETS" -eq 1 ]; then
  command -v gh >/dev/null 2>&1 || fail "gh not found — needed for --set-secrets (https://cli.github.com)"
  gh auth status >/dev/null 2>&1 || fail "gh is not authenticated — run: gh auth login"
fi

hash8() {
  # sha256sum (Linux/CI) vs shasum (macOS local runs) — both print the hex
  # digest; only the tool name differs. Never echo the raw value.
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -c1-8
  else
    printf '%s' "$1" | shasum -a 256 | cut -c1-8
  fi
}

psql_quiet() {
  # Never let psql echo the statement (it contains the password): -q keeps
  # it off stdout; ON_ERROR_STOP makes a failure loud.
  psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null
}

# ── Apply / verify ───────────────────────────────────────────────────────────
if [ "$MODE_VERIFY" -eq 1 ]; then
  echo "Role LOGIN status (staging):"
  psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c \
    "SELECT rolname || ' rolcanlogin=' || rolcanlogin FROM pg_roles WHERE rolname IN ('catalog_svc','agent_svc','users_svc','jobs_svc') ORDER BY 1"
  exit 0
fi

i=0
for role in "${ROLES[@]}"; do
  pass="${PASSWORDS[$i]}"
  # Dollar-quoted so single quotes in the password need no escaping (the
  # URL-safe charset check above makes `$$` collisions impossible).
  psql_quiet "ALTER ROLE $role LOGIN PASSWORD \$\$$pass\$\$"
  echo "✓ ALTER ROLE $role LOGIN PASSWORD set (sha256_8=$(hash8 "$pass"))"
  i=$((i + 1))
done

# ── Write staging env secrets (#832) ─────────────────────────────────────────
if [ "$MODE_SECRETS" -eq 1 ]; then
  build_role_dsn() {
    local role="$1" pass="$2" head rest authority host tail
    head="${NEON_DATABASE_URL%%://*}"
    rest="${NEON_DATABASE_URL#*://}"
    authority="${rest%%/*}"
    host="${authority#*@}"
    tail="${rest#*/}"
    [ "$host" != "$authority" ] || fail "NEON_DATABASE_URL has no user:pass@ authority"
    printf '%s://%s:%s@%s/%s' "$head" "$role" "$pass" "$host" "$tail"
  }
  # Values are piped via stdin, never argv (argv can leak through process
  # listings); gh prints nothing secret. `--env staging` scopes the secret so
  # the deploy jobs' job-level `environment: staging` resolves it (#527).
  printf '%s' "$(build_role_dsn catalog_svc "${PASSWORDS[0]}")" \
    | gh secret set CATALOG_DATABASE_URL --env staging
  echo "✓ GitHub secret CATALOG_DATABASE_URL set (staging environment)"
  printf '%s' "$(build_role_dsn users_svc "${PASSWORDS[1]}")" \
    | gh secret set USERS_DATABASE_URL --env staging
  echo "✓ GitHub secret USERS_DATABASE_URL set (staging environment)"
  # AGENT_DATABASE_URL already exists in staging (the maintenance preflight
  # hard-requires it); this overwrites its value with the jobs_svc DSN — that
  # replacement is the point of #832 for the jobs worker.
  printf '%s' "$(build_role_dsn jobs_svc "${PASSWORDS[3]}")" \
    | gh secret set AGENT_DATABASE_URL --env staging
  echo "✓ GitHub secret AGENT_DATABASE_URL set (staging environment, jobs_svc DSN — overwrites previous value)"
fi

cat <<'NEXT'

Next steps (owner):
  1. Deploy once to staging (push to main) — each component now connects as
     its own role. The deploy log's "Report resolved secret shape" step shows
     per-component DSN hash prefixes and warns if a DSN is missing (fallback
     to the owner DSN keeps deploys working meanwhile).
  2. Verify a purge run in Cloudflare Cron Triggers (Past Events) for the
     jobs Worker — first invocation after cutover.
  3. agent_svc: no staging secret yet — root container still uses
     SUPABASE_DB_URL. Revisit when the agent's data-plane DSN is cut over.
  4. Production stays on NEON_DATABASE_URL (owner DSN) until #855.
NEXT
