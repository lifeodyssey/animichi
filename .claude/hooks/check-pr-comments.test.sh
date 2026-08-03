#!/bin/bash
# Mutation test for check-pr-comments.sh. Each blocking case is a bypass the
# first version silently allowed; each passing case must not regress into a
# false positive.
H=~/.claude/hooks/check-pr-comments.sh

run() {
  printf '{"tool_input":{"command":%s}}' \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")" \
    | bash "$H" >/tmp/hook-out.txt 2>&1
  local code=$?
  printf '%-52s exit=%s  %s\n' "$2" "$code" "$(head -1 /tmp/hook-out.txt)"
}

M="gh pr merge"
echo "--- PR #710 has unresolved threads: every form must BLOCK (exit 2) ---"
run "$M https://github.com/lifeodyssey/animichi/pull/710 --rebase" "URL form"
run "$M --rebase -R lifeodyssey/animichi 710"                      "flags before number"
run "$M --repo=lifeodyssey/animichi 710"                           "--repo= form"
run "$M 710"                                                       "plain number"

echo
echo "--- must PASS (exit 0): not an actual invocation ---"
run "git status"                                                   "unrelated command"
run "git commit -m 'guard matched only \`$M <digits>\` before'"     "words quoted in a message"
run "grep -rn '$M' docs/"                                          "words as a search pattern"

echo
echo "--- fail-closed: broken gh must BLOCK, not wave through ---"
PATH="/tmp/fakegh:$PATH" run "$M 710"                              "gh returns error"
