#!/usr/bin/env bash
# The `contracts` job's own registry, run before the push that would break it
# (#1883). `pr-verification.yml`'s `contracts` job is the ONE list: this script
# reads the commands out of that job and runs them, so a contract joins the
# local gate by the same line that puts it in CI, and there is no second list to
# drift from. CI runs the job; a push that changed a path the contracts own runs
# this; both read those lines.
#
# Which paths those are is `pre-push-affected.sh`'s decision, not this script's:
# it calls this one when the diff touches `.github/`, `scripts/` or
# `test/repo-config/` — the three families the contracts job owns, and the three
# the routing table's whitelist used to leave to CI alone.
#
# The command forms are closed. The job's steps are `bundle exec ruby <path>`
# and `bash <path>`; any other line stops the push and names itself, because a
# contract this script cannot classify is a contract that would otherwise pass
# by absence. A line's path must be committed at HEAD, too: CI checks out that
# tree, so a line naming a path that exists only in this working tree runs here
# and is missing there — a contract that passes by absence one step later. The
# registry supplies a PATH and this script supplies the interpreter, so a
# workflow line can never reach a program the gate did not classify — running a
# step's text verbatim would let a later step reach a command a push hook has no
# business running.
#
# The whole registry is read before any of it runs: a line this script cannot
# run must stop the push, not a prefix of the suite reported as green.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

WORKFLOW='.github/workflows/pr-verification.yml'
JOB='contracts'
READ_JOB='
  jobs = YAML.safe_load(File.read(ARGV[0]), aliases: true).fetch("jobs")
  job = jobs[ARGV[1]] or abort("pre-push: #{ARGV[0]} has no #{ARGV[1]} job")
  job.fetch("steps").flat_map { |step| step["run"].to_s.lines }
     .map(&:strip)
     .reject { |line| line.empty? || line.start_with?("set ", "#") }
     .each { |line| puts line }
'

refuse() { printf 'pre-push: %s\n' "$1" >&2; exit 1; }

# The job's commands, one per line, read from the workflow the job lives in.
registry() { ruby -ryaml -e "$READ_JOB" "$WORKFLOW" "$JOB"; }

# The one path a registry line names, or a refusal. `bundle exec ruby x.rb` and
# `bash x.sh` are the whole grammar, and the path carries no whitespace, so a
# line cannot smuggle a second command past the classifier.
target_of() {
  local path="${1##* }"
  case "$1" in
    "bundle exec ruby $path" | "bash $path") ;;
    *) return 1 ;;
  esac
  case "$path" in
    "" | *[!A-Za-z0-9._/-]*) return 1 ;;
  esac
  printf '%s\n' "$path"
}

# The interpreter this script chose, over the path it read out of the line.
run_contract() {
  case "$1" in
    "bundle exec ruby "*) bundle exec ruby "${1#bundle exec ruby }" ;;
    "bash "*) bash "${1#bash }" ;;
  esac
}

if [ "${1:-}" = "--list" ]; then
  registry
  exit 0
fi

commands="$(registry)"
[ -n "$commands" ] || refuse "$WORKFLOW names no commands in its $JOB job"

while IFS= read -r command; do
  target="$(target_of "$command")" || refuse "the contracts job runs a command this gate cannot classify: $command"
  # `HEAD:` and not `git ls-files`: the index holds a file that is staged and not
  # yet committed, which is the same fail-open one step narrower.
  git cat-file -e "HEAD:$target" 2>/dev/null ||
    refuse "the contracts job runs a path that is not committed at HEAD: $command"
done <<<"$commands"

printf 'pre-push: contracts — %s commands from the %s job of %s\n' \
       "$(wc -l <<<"$commands" | tr -d ' ')" "$JOB" "$WORKFLOW"
while IFS= read -r command; do run_contract "$command" < /dev/null; done <<<"$commands"
