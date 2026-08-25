#!/usr/bin/env bash
# Local-gate test harness: builds a stub PATH and an invocation log.
#
# Source this from a local-gate behavioral test, then run the gate under
# PATH="$GATE_STUB_BIN:$PATH". Every tool invocation is recorded in
# $GATE_TEST_LOG as "PWD :: argv" (real git, bash, ruby, and the Quality
# bash checks are intentionally NOT stubbed — they are hermetic and must run
# against the real repo tree; the Quality ruby self-tests are hermetic too,
# and the quality gate needs deterministic local tool output). The
# log is cleaned up on exit.
set -euo pipefail

GATE_STUB_ROOT="$(mktemp -d)"
GATE_STUB_BIN="$GATE_STUB_ROOT/bin"
GATE_TEST_LOG="$GATE_STUB_ROOT/log"

cleanup_gate_stubs() { rm -rf "$GATE_STUB_ROOT"; }
trap cleanup_gate_stubs EXIT

mkdir -p "$GATE_STUB_BIN"
for tool in uv pnpm node atlas pulumi docker actionlint shellcheck sleep; do
  ln -s "$(dirname "${BASH_SOURCE[0]}")/test-stub.sh" "$GATE_STUB_BIN/$tool"
done
export GATE_TEST_LOG
