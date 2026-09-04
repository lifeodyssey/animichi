#!/usr/bin/env bash
# Shebang-implies-executable gate (#1307): ruff's EXE001 fires the moment a
# shebang'd Python file without the executable bit is staged, and the fix
# (ruff-format reformatting the whole file, plus a manual chmod) then carries
# unrelated churn into that commit (#1299). Enforce the invariant up front,
# repo-wide, for every shebang'd *.py/*.sh tracked under .github/scripts/ and
# scripts/ so it cannot drift back after #1307's one-time chmod.
#
# Run from the repository root. Behavioral tests: shebang-exec-bit.test.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

has_shebang() {
  local first_line=""
  IFS= read -r first_line <"$1" || true
  [[ "${first_line}" == '#!'* ]]
}

main() {
  local file offenders=0
  while IFS= read -r -d '' file; do
    has_shebang "${file}" || continue
    if [ ! -x "${file}" ]; then
      echo "shebang present but not executable: ${file}"
      offenders=1
    fi
  done < <(git ls-files -z -- \
    '.github/scripts/*.py' '.github/scripts/*.sh' \
    'scripts/*.py' 'scripts/*.sh')
  if [ "${offenders}" -ne 0 ]; then
    echo "chmod +x the file(s) above (a shebang implies the executable bit), or drop the shebang if the file is only ever invoked via its interpreter"
    exit 1
  fi
  echo "all shebang'd .github/scripts and scripts .py/.sh files are executable"
}

main
