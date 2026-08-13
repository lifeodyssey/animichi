#!/usr/bin/env bash
# Prerequisite VERSION-gate tests for the pre-push orchestrator — sourced by
# pre-push.test.sh AFTER the hygiene module (which owns the shared
# run_no_atlas_gate / make_no_atlas_bin / assert_prereq_out helpers); not
# standalone.
#
# Version semantics (#1003): node < 24 fails closed with the documented hint;
# atlas is pinned only in CI — locally ANY non-empty `atlas version` output
# passes, so a brew atlas 1.x cannot block a real push. Both tests go through
# the driver with a fixed `all` route (run_gate) — the real entry's route
# includes `scripts`, which would recurse the full script suite on the green
# path. The stubs print v20.0.0 / v0.29.9 under GATE_NODE_OLD / GATE_ATLAS_OLD.

test_old_node_version_fails_prereqs() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=all GATE_NODE_OLD=1 run_gate "$GATE_STUB_ROOT/old-node.log")" || true
  [ "$rc" != "0" ] || { echo "FAIL: old node version must fail prereqs" >&2; exit 1; }
  grep -qF "Node >= 24" "$GATE_STUB_ROOT/stdout" \
    || { echo "FAIL: prereq failure output lacks: Node >= 24" >&2; exit 1; }
  echo "ok: node < 24 fails the prereq check"
}

test_any_atlas_version_passes_prereqs() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=all GATE_ATLAS_OLD=1 run_gate "$GATE_STUB_ROOT/atlas-any.log")" || true
  [ "$rc" = "0" ] || { echo "FAIL: unpinned atlas version must pass prereqs (exit $rc)" >&2; exit 1; }
  echo "ok: atlas != v0.30.0 passes the prereq check"
}
