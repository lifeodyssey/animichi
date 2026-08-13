#!/usr/bin/env bash
# Behavioral tests for the disposable fresh-schema gate
# (scripts/local-gates/db-fresh-schema.sh), AC3/AC6.
#
# The gate is required and must FAIL CLOSED with an actionable message when
# Docker or the offline image is unavailable — it never silently skips. The
# atlas and docker tools are stubbed (scripts/local-gates/stub-env.sh +
# test-stub.sh); the success path asserts the gate waits for the admin
# database, creates the pristine target database from template1, and applies
# atlas only to that disposable 127.0.0.1 container (never the image-
# preinitialised POSTGRES_DB, never shared Neon).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/db-fresh-schema.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
source "$SCRIPT_DIR/stub-env.sh"

STUB="$GATE_STUB_ROOT/out"
mkdir -p "$STUB"

run_gate() {
  local rc=0
  (
    cd "$REPO_ROOT"
    PATH="$GATE_STUB_BIN:$PATH" GATE_TEST_LOG="$GATE_STUB_ROOT/log" "$GATE"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  echo "$rc"
}

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

make_only_atlas_bin() {
  # A bin dir with ONLY the atlas stub (no docker): `command -v docker` must
  # come up empty regardless of what the host has installed.
  local only_atlas="$GATE_STUB_ROOT/only-atlas"
  mkdir -p "$only_atlas"
  ln -s "$GATE_STUB_BIN/atlas" "$only_atlas/atlas"
  printf '%s\n' "$only_atlas"
}

run_with_path() {
  local path="$1"
  local rc=0
  (
    cd "$REPO_ROOT"
    PATH="$path" GATE_TEST_LOG="$GATE_STUB_ROOT/log" "$GATE"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

test_docker_not_installed_fails_closed() {
  local rc
  rc="$(run_with_path "$(make_only_atlas_bin):/usr/bin:/bin")"
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
  assert_msg "docker build -f apps/agent/docker/test-postgres/Dockerfile"
  assert_msg "animichi-test-postgres:18-3.6-pgvector-0.8.5"
  echo "ok: missing offline image fails with the exact build command"
}

assert_fresh_chain() {
  assert_msg "fresh-schema apply: OK"
  assert_has "$GATE_STUB_ROOT/log" "docker run -d -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=postgres"
  assert_has "$GATE_STUB_ROOT/log" "pg_isready -U postgres -d postgres"
  assert_has "$GATE_STUB_ROOT/log" "psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c CREATE DATABASE gate TEMPLATE template1"
}

assert_atlas_disposable_only() {
  assert_has "$GATE_STUB_ROOT/log" "atlas migrate apply --dir file://migrations/neon --url postgresql://postgres:gate@127.0.0.1"
  assert_lacks "$GATE_STUB_ROOT/log" "-e POSTGRES_DB=gate"
}

test_success_applies_only_to_pristine_template1_schema() {
  local rc
  rc="$(run_gate)" || true
  [ "$rc" = "0" ] || { echo "FAIL: success path exited $rc" >&2; exit 1; }
  assert_fresh_chain
  assert_atlas_disposable_only
  echo "ok: applies the full chain to the pristine template1 database on the disposable container"
}

test_docker_not_installed_fails_closed
test_daemon_down_fails_closed
test_image_missing_fails_with_build_command
test_success_applies_only_to_pristine_template1_schema
echo "db-fresh-schema.test.sh: all green"
