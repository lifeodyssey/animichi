#!/usr/bin/env bash
# SUT: scripts/local-gates/db-fresh-schema.sh
# Behavioral tests for the disposable fresh-schema gate
# (scripts/local-gates/db-fresh-schema.sh), AC3/AC6.
#
# The gate is required and must FAIL CLOSED with an actionable message when
# Docker or the offline image is unavailable — it never silently skips. The
# pnpm and docker tools are stubbed (scripts/local-gates/stub-env.sh +
# test-stub.sh); the success path asserts the gate waits for the admin
# database, creates the pristine target database from template0, and applies
# the chain only to that disposable 127.0.0.1 container (never the image-
# preinitialised POSTGRES_DB, never shared Neon).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/db-fresh-schema.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
source "$SCRIPT_DIR/stub-env.sh"

STUB="$GATE_STUB_ROOT/out"
mkdir -p "$STUB"

assert_msg() {
  grep -qF -- "$1" "$GATE_STUB_ROOT/stdout" || {
    echo "FAIL: output lacks: $1" >&2
    cat "$GATE_STUB_ROOT/stdout" >&2
    exit 1
  }
}

assert_has() {
  grep -qF -- "$2" "$1" || { echo "FAIL: log lacks: $2" >&2; exit 1; }
}

assert_lacks() {
  if grep -qF -- "$2" "$1"; then
    echo "FAIL: log must not contain: $2" >&2
    exit 1
  fi
}

# A bin dir with the pnpm stub and bash but NO docker: `command -v docker` must come up empty
# regardless of what the host has installed (the bash symlink keeps the gate's
# `#!/usr/bin/env bash` shebang resolvable under a PATH that cannot contain docker).
make_dockerless_bin() {
  local dockerless="$GATE_STUB_ROOT/dockerless"
  mkdir -p "$dockerless"
  ln -s "$GATE_STUB_BIN/pnpm" "$dockerless/pnpm"
  ln -s "$(command -v bash)" "$dockerless/bash"
  printf '%s\n' "$dockerless"
}

# The log is truncated per run, so it records THIS run's invocations and a
# count of them means what it reads as.
run_with_path() {
  local path="$1"
  local rc=0
  : >"$GATE_STUB_ROOT/log"
  (
    cd "$REPO_ROOT"
    PATH="$path" GATE_TEST_LOG="$GATE_STUB_ROOT/log" "$GATE"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

run_gate() { run_with_path "$GATE_STUB_BIN:$PATH"; }

test_docker_not_installed_fails_closed() {
  local rc
  rc="$(run_with_path "$(make_dockerless_bin)")"
  [ "$rc" != "0" ] || { echo "FAIL: missing docker must fail closed" >&2; exit 1; }
  assert_msg "Docker is required"
  assert_msg "colima"
  echo "ok: missing docker fails closed with an actionable install message"
}

test_daemon_down_fails_closed() {
  local rc
  rc="$(GATE_DOCKER_UNAVAILABLE=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: stopped daemon must fail closed" >&2; exit 1; }
  assert_msg "daemon is not running"
  echo "ok: stopped docker daemon fails closed with an actionable message"
}

test_image_missing_fails_with_build_command() {
  local rc
  rc="$(GATE_DOCKER_IMAGE_MISSING=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: missing image must fail closed" >&2; exit 1; }
  assert_msg "missing offline test image"
  assert_msg "docker build -f packages/test-postgres/Dockerfile"
  assert_msg "animichi-test-postgres:18-3.6-pgvector-0.8.6"
  echo "ok: missing offline image fails with the exact build command"
}

test_tcp_readiness_fails_closed() {
  local rc
  rc="$(GATE_DOCKER_TCP_UNAVAILABLE=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: unavailable TCP readiness must fail closed" >&2; exit 1; }
  assert_msg "did not become ready over TCP for postgres"
  echo "ok: TCP readiness failure fails closed"
}

assert_fresh_chain() {
  assert_msg "fresh-schema apply: OK"
  assert_has "$GATE_STUB_ROOT/log" "docker run -d -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=postgres"
  assert_has "$GATE_STUB_ROOT/log" "pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres"
  assert_has "$GATE_STUB_ROOT/log" "psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c CREATE DATABASE gate TEMPLATE template0"
  assert_has "$GATE_STUB_ROOT/log" "pg_isready -h 127.0.0.1 -p 5432 -U postgres -d gate"
}

assert_chain_applied_to_the_disposable_target_only() {
  assert_has "$GATE_STUB_ROOT/log" "psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c CREATE ROLE \"agent_svc\" NOLOGIN"
  assert_has "$GATE_STUB_ROOT/log" "pnpm --filter @animichi/pi-session-neon exec prisma db migrate --db postgresql://postgres:gate@127.0.0.1"
  assert_lacks "$GATE_STUB_ROOT/log" "-e POSTGRES_DB=gate"
}

test_success_applies_only_to_pristine_template0_schema() {
  local rc
  rc="$(run_gate)" || true
  [ "$rc" = "0" ] || { echo "FAIL: success path exited $rc" >&2; exit 1; }
  assert_fresh_chain
  assert_chain_applied_to_the_disposable_target_only
  echo "ok: applies the full chain to the pristine template0 database on the disposable container"
}

# The gate issues its create once and fails closed on any refusal. Since #1890
# the source is `template0`, which `datallowconn = false` closes to sessions, so
# #1874's exclusivity conflict is not expected on this image; the residual is
# recorded in `packages/test-postgres/src/clean-database.ts`.
CREATE_DENIED='ERROR:  permission denied to create database'

# A docker stub whose `CREATE DATABASE gate TEMPLATE` refuses. It delegates to
# the shared stub first, so the invocation is recorded exactly as every other one
# is, and only then replaces the exit status.
make_refusing_docker() {
  local dir="$GATE_STUB_ROOT/create-denied"
  mkdir -p "$dir"
  cat >"$dir/docker" <<STUB
#!/usr/bin/env bash
"$GATE_STUB_BIN/docker" "\$@" || exit \$?
case "\$*" in *'CREATE DATABASE gate TEMPLATE'*) ;; *) exit 0 ;; esac
printf '%s\n' '$1' >&2
exit 1
STUB
  chmod +x "$dir/docker"
  printf '%s\n' "$dir:$GATE_STUB_BIN:$PATH"
}

# How many times the gate issued the create — one, never a retry loop.
assert_create_attempts() {
  local seen
  seen="$(grep -cF -- 'CREATE DATABASE gate TEMPLATE template0' "$GATE_STUB_ROOT/log" || true)"
  [ "$seen" = "$1" ] || { echo "FAIL: expected $1 create attempts, saw $seen" >&2; exit 1; }
}

test_a_refused_create_fails_closed() {
  local rc
  rc="$(run_with_path "$(make_refusing_docker "$CREATE_DENIED")")"
  [ "$rc" != "0" ] || { echo "FAIL: a refused create must fail closed" >&2; exit 1; }
  assert_msg "failed to create the pristine target database from template0"
  assert_msg "permission denied to create database"
  assert_create_attempts 1
  echo "ok: a refused create is reported once and fails the gate"
}

test_docker_not_installed_fails_closed
test_daemon_down_fails_closed
test_image_missing_fails_with_build_command
test_tcp_readiness_fails_closed
test_success_applies_only_to_pristine_template0_schema
test_a_refused_create_fails_closed
echo "db-fresh-schema.test.sh: all green"
