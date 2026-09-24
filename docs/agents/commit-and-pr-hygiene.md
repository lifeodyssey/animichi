# Commit and PR hygiene

Read before committing or opening a PR; `.claude/rules/git-commit.md` is the short path-scoped
form, and `docs/agents/delivery-flow.md` holds the PR mechanics measured on this repository.

- Historical bloat came from merge-carried branch WIP, PR-per-repair loops, commit-on-agent-stop
  behavior, and no message/title gate. Fix that workflow; a prettier vague subject is not enough.
- A commit is an independently reviewable, reversible outcome — never an agent checkpoint, handoff,
  review reply, formatter pass, or CI retry. Do not commit merely because a sub-agent stopped.
- Keep one e2e story in one PR; its tickets share it. Fold related fixes into that PR; do not open
  another PR for its review comments or gate repairs. Before the first push, amend an unpushed
  commit instead of stacking repair commits; after a push, add fixes to the same PR and let GitHub
  squash-merge it.
- Commit subjects and PR titles use `<type>(<scope>): <short outcome>` (scope optional), imperative
  lowercase after the colon, preferably ≤50 characters and always ≤72. Put `Refs: #…` in the body,
  never PR numbers in the subject. Generic `wip`, `checkpoint`, `fix`, `update`, `changes`, `review`,
  and `polish` subjects are invalid.
- Types: `feat|fix|refactor|perf|test|docs|ci|build|ops|chore|revert`. Scopes:
  `agent|web|chat|catalog|users|auth|edge|contract|db|infra|delivery|eval|e2e|repo|deps`.
- Never add Claude/Anthropic/Codex/OpenAI `Co-Authored-By` trailers or a `Generated with Claude Code`
  footer. Human and Dependabot attribution remains valid.
- `commitlint.config.js` is the machine source of truth for local commit messages and squash-merge
  PR titles: the commit-msg hook (`.pre-commit-config.yaml`) and CI's `commits` job read that one
  file. It pins the type and scope tables above, `header-max-length` 72, and — inherited from
  `@commitlint/config-conventional` — body and footer lines ≤100 characters. Install all hooks with
  `pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push`; never
  bypass them with `--no-verify`. Check a drafted message by hand with `pnpm exec commitlint --edit
  <file>`, or a whole branch with `pnpm exec commitlint --from origin/main` (both need
  `pnpm install`).
