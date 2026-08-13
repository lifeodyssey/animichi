#!/usr/bin/env bash
# Test-only route driver for the pre-push orchestrator (#1003).
#
# The real hook (.pre-commit-config.yaml → `bash scripts/local-gates/pre-push.sh`)
# obtains the package set exclusively from the canonical router
# (scripts/local-gates/changed-packages.sh); it never reads GATE_CHANGED_PACKAGES
# or any other override, so production routing cannot be shrunk by a caller
# (e.g. `GATE_CHANGED_PACKAGES=web git push` skips nothing). This driver is the
# ONLY route-injection seam: it sources the orchestrator — loading run_pre_push
# without executing the real entry, which is guarded by the BASH_SOURCE check in
# pre-push.sh — and then calls run_pre_push with the fixed route. The driver is
# never referenced by the hook configuration; pre-push.test.sh invokes it to
# exercise the AC routing contract without mutating the worktree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pre-push.sh"
run_pre_push "${GATE_CHANGED_PACKAGES:?the test driver requires GATE_CHANGED_PACKAGES}"
