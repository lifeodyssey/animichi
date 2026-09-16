# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# Verbatim excerpts of the verdict files this tool meets on the machine: a brief that mentions
# another round's verdict, a candidate line next to a parent line, a previous-round head line, an
# abbreviated candidate, a verdict heading that is not in the last lines of the file, and the four
# shapes one round-2 review found unreadable (a `fix` line, a `fix under review` line, a candidate in
# prose that names a range, and a candidate row that qualifies its own round).
module VerdictCorpus
  BRIEF_1672 = <<~'MARKDOWN'
    # Round-3 review — #1672 pnpm 12 upgrade, after the rebase onto current main

    You are the independent reviewer (Claude Opus 5). The writer was a DeepSeek Pi lane.

    **Stay in scope and write your verdict early.** Two review lanes on this pipeline exited 0 without a verdict: one after a repository-wide search, one that backgrounded a run and exited before it finished. Run every command in the foreground and wait for it. No verdict file = failed review.

    ## Candidate
    - Worktree `/Users/lumimamini/orca/workspaces/Seichijunrei-agent/orca-1672-pnpm-and-deps`, branch `lifeodyssey/orca-1672-pnpm-and-deps`, one commit `72f9672dc` on `origin/main` `8797c3592`, not pushed.
    - Round-2 verdict (APPROVED, on the pre-rebase commit `d49a1c8f7`) is in this branch's earlier lane files; the rebase report is `/private/tmp/animichi-lane-1672/rebase-report.md`, with gate logs in the same directory (`gates-final2.log` is the final run).
    - **Do not create or remove git worktrees.** Review only. `git status --porcelain` must be empty at the end. Do not run `pnpm install` in any other worktree.

    ## Verify
  MARKDOWN

  ROUND_3_1672 = <<~'MARKDOWN'
    # Round-3 review — #1672 pnpm 12 upgrade, after rebase

    - Reviewer: Claude Opus 5 (writer: DeepSeek Pi lane)
    - Candidate HEAD: `72f9672dcc0202c675261e3712b741f8c9c26747` (one commit, unpushed)
    - Base `origin/main`: `8797c359245fe947223842423ea46cc48db07304` (`git merge-base HEAD origin/main` = same)
    - Round-2 reviewed commit: `d49a1c8f7`
    - Control clone: `/private/tmp/animichi-lane-1672/main-control` at `8797c3592…`, `git status --porcelain` clean
    - Probe scratch: `/private/tmp/animichi-lane-1672/r3probe/`
    - Worktree `git status --porcelain` at end: empty

    ## Verdict: **APPROVED**
  MARKDOWN

  ROUND_2_1726 = <<~'MARKDOWN'
    # #1726 round-2 review — APPROVED

    - Reviewer: Claude Opus 5 (independent; writer was a DeepSeek Pi lane)
    - Candidate: `15d2478f337000afebd795fbf7a6d9d79a3e5148` on `lifeodyssey/orca-1726-lane`, parent = `origin/main` `8797c359245fe947223842423ea46cc48db07304`; not pushed.
    - Round-1 head: `b85ca3e20` (verdict `review-round-1.md`).
    - `git status --porcelain`: empty at start and at end. No worktrees created or removed.
    4. **Diff vs round 1 — CLOSED.** `git range-diff b85ca3e20~1..b85ca3e20 HEAD~1..HEAD`: only the commit-message paragraph, the Makefile comment and the vitest.config.ts comment differ; everything else is the rebase onto `8797c3592`.
    **APPROVED.** Must-fix list: none.
  MARKDOWN

  ROUND_2_1605 = <<~'MARKDOWN'
    # Round-2 review — #1605 + #1606 folded (`refactor(edge): remove the container binding and its plumbing`)

    - **Reviewer seat:** Anthropic · Claude Opus 5 (`claude-opus-5`) · effort high · Orca task `task_a2d80ea67c0f`, dispatch `ctx_a501e528d7b0`. The writer was the DeepSeek Pi lane.
    - **Method:** Matt Pocock `/code-review` (`~/.agents/skills/code-review/SKILL.md`). Standards and Spec ran as two separate parallel read-only subagents. I then checked their findings, ran the gates, and ran every mutation below myself.
    - **Subagents:** Standards axis = `general-purpose`, model `sonnet` (Claude Sonnet 5). Spec axis = `general-purpose`, model `sonnet` (Claude Sonnet 5).
    - **Logs:** `/private/tmp/animichi-lane-1605/r2/` (`mutate.sh`, `mut/*-red.txt` / `*-green.txt`, `contracts.log`, `edge-*.log`, `docker-{before,after}.txt`).

    ## SHAs (resolved 2026-09-16)

    | Ref | SHA |
    |---|---|
    | Candidate tip `a6039815f` (#1605 + #1606) | `a6039815f51ec24725b21175ae9063d01c6fd9ca` |
    | Its parent `5abed3b6a` (#1604 photo deletion) | `5abed3b6a32272b6b1e931962be23d07a0b3beca` |
      - `grep -c` finds none of those five in `workers/edge/wrangler.toml`, at HEAD or at the parent. They were entries in the deleted container env allowlist (`5abed3b6a:workers/edge/src/container/container-env.ts`).
    ## Verdict: **CHANGES REQUIRED**
  MARKDOWN

  ROUND_1_1591 = <<~'MARKDOWN'
    # Review round 1 — #1591(a): the append-only postcheck reads explicit grants

    Reviewer: Claude Opus 5 (independent; writer was a DeepSeek Pi lane)

    - Candidate: `5ea60618f8c01133eaf57f441f1a9fee3b146ecb` (branch `lifeodyssey/orca-1591-lane`, not pushed)
    - Parent / base: `feca8766a85206595bb393aadb5e624625ba1e73`
    - `origin/main` at review end: `8797c359245fe947223842423ea46cc48db07304` (one new commit, #1701, e2e only; touches neither `packages/pi-session-neon` nor `workers/migrator`)
    - `access.ts` sha256 before and after every mutation: `08238adb90136402db7a0c297aec907042652164f87918cac33ddb4b1613eb11`
    - `git status --porcelain` at the end: empty

    ## Verdict: **APPROVED**
    The only difference is the trailing newline, which the parent commit's `ops.json` also has (`git show HEAD~1:…/ops.json | tail -c 2` → `]\n`). All content, including `migrationHash 2a8ca7ac…`, is reproduced from source. The temp copy was removed.
  MARKDOWN

  FIX_BRIEF_1558 = <<~'MARKDOWN'
    # #1558 review fix — two subtractive nits, one of them a documented rule

    Use the installed Matt `/implement` skill. You are the sole writer. Do not commit, push, open a PR, merge, or deploy. Follow root and `packages/eval` `AGENTS.md`. No suppressions.

    ## Starting point

    - Worktree: `/Users/lumimamini/orca/workspaces/Seichijunrei-agent/orca-1558-lane`, branch `lifeodyssey/orca-1558-lane`, single commit at HEAD `02045bb9a`, parent `origin/main` at `eed25ea48`. Verify HEAD and that the tree is clean; escalate through Orca if not.
    - Round-1 review: `/private/tmp/animichi-lane-1558/grok-review-round-1.md`. Verdict was **APPROVED with no must-fix**; this lane exists only for the two nits, which the reviewer confirmed are simpler than the current code.
  MARKDOWN

  ROUND_2_1720 = <<~'MARKDOWN'
    # #1720 第二轮评审（Claude Opus 5，独立评审席）

    - 候选：`lifeodyssey/orca-1720-lane` @ `c8c9557b70099a5e56a1ec7e1d4bda51e8f77ad0`（一个提交，未推送）
    - 父提交 = `origin/main` @ `8797c359245fe947223842423ea46cc48db07304`（`git merge-base --is-ancestor origin/main c8c9557b7` 通过）
    - 第一轮评审 head：`22c085f3ba2b579427c9664b8801ba9a94c619e6`（当时基于 `feca8766a`）
    - 评审结束时 `git status --porcelain` 为空（已核验）

    ## 结论：APPROVED
  MARKDOWN

  ROUND_4_1702 = <<~'MARKDOWN'
    # Round-4 review — #1702, after M-3

    Reviewer: Claude Opus 5 (writer was a DeepSeek Pi lane). All commands ran in the foreground.

    ## SHAs

    - Branch `lifeodyssey/orca-1702-lane`, HEAD `3c9d1f330961d73d3270c623be1f5fa77d51b86b`
    - Parent `57bf0df099574cef74bea11dfa4cfcfba98c4ce2` = current `origin/main`. One commit, not pushed.
    - Round-3 head compared against: `854a8e519`
    - `test/repo-config/e2e-spec-coverage.test.rb` sha256 `fefcd839455372672baa690f0c1461d42c4c98fc8a51d0c0adae5b1c4a23cc46`
    ## Verdict

    **APPROVED.** No must-fix items remain.
  MARKDOWN

  ROUND_1_1725 = <<~'MARKDOWN'
    # Round-1 review — #1725 step 1, the read-only card reconciler

    - Reviewer: Claude Opus 5 (`claude-opus-5`), Orca task `task_ad89dd59310c` / `ctx_af74e8149c03`. Writer was a DeepSeek Pi lane.
    - Candidate HEAD: `d86e6f2653f110c098a57f14d470bfd3693f5185` (`ops(delivery): reconcile orca card state from live facts`), branch `lifeodyssey/orca-1725-lane`, not pushed.
    - Parent: `4b8a03f5a2208c06484456ca72d752aeab72c683` = `origin/main`.
    - Diff: 29 files under `scripts/orca/` (+2710/−1). The brief said 15; the real count is 29.
    - `git status --porcelain`: empty at start and at end. No worktrees created or removed. Orca reads were `check --terminal <mine>`, `run-current`, `task-list --run` (read-only). No `send`/`ack`/`cleanup` except my own heartbeats.
    - Scratch: `/private/tmp/animichi-lane-1725/r1/` (`mutate.sh`, `mut-*`, `probe-norekey/`, `failgh/`, `tasks.json`, `settled_vs_tasks.rb`, holds files).

    ## Verdict: CHANGES REQUIRED

       - (c) It only looks for the verdict in the last 25 non-empty lines, so verdicts in a top heading are dropped: 1672 r3, 1718 r1, 1702 r1–r3, 1720 r1–r2 (a Chinese `## 结论：APPROVED`), 1688 r1, 1591 r1.
  MARKDOWN

  # `1695/review-cr-2.md`: the candidate is the `fix` commit its stack line names, and the `HEAD`
  # marker on that line comes after the SHA, so no candidate or head marker can bind it.
  CR_2_1695 = <<~'MARKDOWN'
    # Round-2 review — PR #1713 fix commit, after the three must-fixes

    - Reviewer: Claude Opus 5 (independent of the DeepSeek Pi writer)
    - Stack: `origin/main` `57bf0df09` ← #1715 `1d0bd3bb9` ← #1718 `1ce7878df`, `bda74da50` (= `lifeodyssey/orca-1718-lane`) ←
      #1713 feature `802fb3367` ← **fix `df8fd6545` (HEAD, = PR #1713 remote head, base `lifeodyssey/orca-1718-lane`)**
    - Fix diffed against its parent `802fb3367`, not against main.

    ## Verdict: **APPROVED**
  MARKDOWN

  # `1695/review-cr.md`: the same shape one step earlier — the SHA follows `fix under review`, and the
  # title's `fix commit` binds no SHA at all.
  CR_1695 = <<~'MARKDOWN'
    # Review — PR #1713 fix commit for six CodeRabbit findings

    - Reviewer: Claude Opus 5 (independent of the DeepSeek Pi writer)
    - Base `origin/main`: `feca8766a` · feature: `fd1a3d0bc` · **fix under review: `54979ff8a`** (local, unpushed)

    ## Verdict: **CHANGES REQUIRED**
  MARKDOWN

  # `1695/grok-review-round-2.md`: the candidate line names the commit under review; the prose line
  # below it names the range `origin/main...HEAD`, whose start is the parent.
  GROK_ROUND_2_1695 = <<~'MARKDOWN'
    # Round-2 review — #1695

    - **Provider / model / effort:** xAI Grok 4.6 xhigh
    - **Candidate HEAD:** `cee36288535cce47a78cb1d9b450f44a00484dea` (`feat(delivery): publish post-deploy evidence a seat can read`, Refs: #1695)
    - **Parent / merge-base:** `9f6a14df4bc31ba4ccab75dd4b2c1b45bd3789ef` (`HEAD^`; this was `origin/main` when the review started)
    - **Round-1 HEAD (before the must-fixes):** `ea6ff1dc563b58d6307d95cb251e0c5a5c860be6`. Round-2 delta: 4 files, +113/−19.

    Standards-axis only. Scope: the round-1 must-fixes and whatever the fix itself broke. Full candidate `origin/main...HEAD` at start (`9f6a14df...cee36288`); round-2 delta `ea6ff1dc..cee36288`.

    ## Verdict

    **APPROVED**
  MARKDOWN

  # `1690/grok-review-round-2.md`: the candidate row says which round it belongs to, and the rows
  # below it are the round-1 candidate and the parent.
  GROK_ROUND_2_1690 = <<~'MARKDOWN'
    # Round-2 review — #1690

    Provider: xAI
    Model: Grok 4.6
    Effort: xhigh

    | Ref | Full SHA |
    |---|---|
    | Candidate `HEAD` (round 2, amended) | `241d6239aba14e923537c1cc25f8b10186ee45f2` |
    | Round-1 candidate `HEAD` | `b4a01905614b6c4ea14f205922b7959dd19f42a5` |
    | Parent (`HEAD^`, `origin/main` at the card's rebase) | `eed25ea48bc30871c4b0edb250352a0cedcce33a` |
    | `origin/main` now | `7cd7392d59fe286dd5c6cd2e04b4ec7e480bb991` |

    ---

    ## Verdict

    **CHANGES REQUIRED**
  MARKDOWN
end
