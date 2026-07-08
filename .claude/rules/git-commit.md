---
paths:
  - "**/*"
---
# Git commit + .claude tracking

- The git hooks run **more than ruff/mypy**. Every commit runs the fast gate — ruff + ruff-format +
  oxlint + **gitleaks (secret scan)** + whitespace/EOF fixers (<5s); pre-push adds mypy, frontend
  typecheck/lint, and frontend + backend **test-coverage** gates. Any *fixer* hook (`ruff --fix`,
  `ruff-format`, `end-of-file-fixer`) can modify files and **abort the commit**.
- **After any failed commit, assume hooks modified/staged files**: `git status --short`, inspect,
  re-stage the intentional hook fixes, and retry.
- `.claude/` is **gitignored but selectively tracked** — some agents/skills/rules are force-added,
  others aren't. Before relying on a `.claude/` agent/hook/rule as repo-shared context, verify with
  `git ls-files`; new tracked additions under `.claude/` need an explicit `git add -f`.
