#!/usr/bin/env bash
# Sourced by reset-staging-baseline.test.sh, into its shell: how the reset reads its Neon target
# out of the stack configuration. The shipped `yaml_value` runs as written — sourced, the
# script only defines its functions — against a stack file of the case's own, so the YAML library
# decides what a value is: the three ways YAML writes a scalar (plain, single- and double-quoted)
# read as one value, and a key the file does not set, or sets to anything but a non-empty string
# (a number, a boolean, a `secure:` object), refuses by key and file. The last case runs `main` on
# such a file: the refusal is the script's own exit although `load_target` runs where `set -e` does
# not, and no neonctl call comes before it.

STACK_FILE="$WORK/Pulumi.case.yaml"
REFUSAL="refusing reset: $STACK_FILE sets no string animichi-neon-secrets:neonBranchId"
READ_EXIT=0

read_branch() { # read_branch <stack yaml>: the shipped reader on a file of the case's own
  printf '%s\n' "$1" > "$STACK_FILE"
  OUT="$(PATH="$WORK/bin:$PATH" bash -c 'set -euo pipefail; source "$1"; yaml_value "$2" neonBranchId' \
    _ "$SCRIPT" "$STACK_FILE" 2>&1)" && READ_EXIT=0 || READ_EXIT=$?
}

for written in "br-plain-1" "'br-plain-1'" '"br-plain-1"'; do
  read_branch "config:
  animichi-neon-secrets:neonBranchId: $written"
  expect "a branch written as $written reads" 0 "$READ_EXIT"
  expect "a branch written as $written reads as br-plain-1" br-plain-1 "$OUT"
done

refuses_branch() { # refuses_branch <what the value is> <the key's line, after `neonBranchId:`>
  read_branch "config:
  animichi-neon-secrets:neonProjectId: proj-1
  animichi-neon-secrets:neonBranchId:$2"
  expect "a branch that is $1 refuses" 1 "$READ_EXIT"
  expect "a branch that is $1 is refused by key and file" yes "$(said "$REFUSAL")"
}
read_branch "config:
  animichi-neon-secrets:neonProjectId: proj-1"
expect "a stack file without the branch refuses" 1 "$READ_EXIT"
expect "a stack file without the branch is refused by key and file" yes "$(said "$REFUSAL")"
refuses_branch "an empty string" " ''"
refuses_branch "a number" " 12345"
refuses_branch "a boolean" " true"
refuses_branch "a secure: object" $'\n    secure: v1:AAAA'

printf 'config:\n  animichi-neon-secrets:neonProjectId: proj-1\n' > "$STACK_FILE"
OUT="$(PATH="$WORK/bin:$PATH" NEON_API_KEY=stub-neon-key bash -c 'set -euo pipefail; source "$1"
  STAGING_YAML="$2"; PRODUCTION_YAML="$2"; neonctl() { echo "neonctl reached: $*"; }; main' \
  _ "$SCRIPT" "$STACK_FILE" 2>&1)" && READ_EXIT=0 || READ_EXIT=$?
expect "the reset on a stack file without the branch exits 1" 1 "$READ_EXIT"
expect "and its refusal names the key and the file" yes "$(said "$REFUSAL")"
expect "then the target it could not load" yes "$(said "refusing reset: staging target is invalid")"
expect "and no neonctl call came first" no "$(said "neonctl reached")"
