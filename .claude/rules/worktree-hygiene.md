---
paths:
  - "**/*"
---
# Worktree / branch hygiene

- Before editing, reviewing, merging, or deleting in a worktree, record the current branch, HEAD,
  dirty state (`git status --short --branch`), worktree list (`git worktree list --porcelain`), and
  remote-ref freshness. Run `git fetch` / `prune` before declaring branches stale or merged. Don't
  trust stale branch/worktree memory.
- At session start, `git config --get core.hooksPath` prints nothing; report anything else (the
  owner keeps the hooks on).
- Remove a card's worktree as soon as its PR is MERGED (`gh pr view --json state`; `is-ancestor`
  is never true after a squash merge), after three checks: clean tree, no runner inside it, no
  unpushed commits (owner, 2026-09-17). Why: `docs/agents/worktrees-and-local-gates.md`.
