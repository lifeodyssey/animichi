---
paths:
  - "**/*"
---
# Worktree / branch hygiene

- Before editing, reviewing, merging, or deleting in a worktree, record the current branch, HEAD,
  dirty state (`git status --short --branch`), worktree list (`git worktree list --porcelain`), and
  remote-ref freshness. Run `git fetch` / `prune` before declaring branches stale or merged. Don't
  trust stale branch/worktree memory.
