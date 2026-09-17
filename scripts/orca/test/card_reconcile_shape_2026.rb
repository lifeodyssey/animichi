# frozen_string_literal: true

# The 2026-09-16 lane shape: fourteen exited-but-unsettled runners, a settled lane per card, an
# unreviewed head, and worktree directories that drifted from the card their branch names. This is
# what the shape is; `Shape2026Tree` builds it on disk and `Shape2026Responses` supplies the Orca,
# GitHub and git output the machine reported for it.
module Shape2026
  DEAD = (1000..1013).to_a.freeze
  UNRECORDED = 1558
  READY = 678
  # A settled lane whose recorded worktree belongs to another card: #1440's lane ran in the worktree
  # on #1718's branch, so only the branch may attach that worktree to a card.
  ORPHAN = 1440
  ALIVE = 1014
  RUN = "run_0950f6f54b72".freeze
  LANE_START = "2026-09-16T13:00:00Z".freeze
  APPROVED = "d49a1c8be1f2a3b4c5d6e7f8091a2b3c4d5e6f70".freeze
  PR_HEAD = "4ec8a4f6e60ad71605d96b46b1e1679789298a15".freeze
  DRIFT_ONE = "15d2478f337000afebd795fbf7a6d9d79a3e5148".freeze
  DRIFT_TWO = "833602144a28f97e7e87436d56027bf2efaaf73e".freeze
  DRIFT_THREE = "ff94edce8dd516464fe8986c0ed23b8cc80a3efb".freeze
  LATER = "b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4".freeze
  # Each card's worktree: directory name and branch. The directory drifts from the card; the branch
  # names the card, and the branch is what makes the worktree belong to it.
  WORKTREES = { 1672 => ["orca-1672-pnpm-and-deps", "lifeodyssey/orca-1672-pnpm-and-deps"],
                1601 => ["orca-1601-ac5", "lifeodyssey/orca-1601-ac5"],
                1715 => ["orca-1691-lane", "lifeodyssey/orca-1715-lane"],
                1702 => ["orca-1694-lane", "lifeodyssey/orca-1702-lane"],
                1718 => ["orca-678-lane", "lifeodyssey/orca-1718-lane"] }.freeze
  HEADS = { 1672 => APPROVED, 1601 => PR_HEAD, 1715 => DRIFT_ONE, 1702 => DRIFT_TWO,
            1718 => DRIFT_THREE }.freeze
  # card => phases, each with a completed Orca task and an exited runner.
  SETTLED = { 1672 => %w[write review], 1601 => %w[write review], 1715 => %w[write],
              1702 => %w[write], 1718 => %w[write], ORPHAN => %w[measure] }.freeze
  VERDICT = <<~MARKDOWN
    # Round-2 review — #1672

    - HEAD (under review): `#{APPROVED}` — chore(deps): move to pnpm catalogs
    - Base: `8797c359245fe947223842423ea46cc48db07304`

    ## Verdict: APPROVED
  MARKDOWN

  module_function

  def task_id(card, phase)
    "task_#{card}_#{phase}"
  end

  def stamp(hour, minutes = 0)
    Time.utc(2026, 9, 16, hour, minutes).iso8601
  end

  # The dead runners are ten minutes apart, oldest first, so the report order is pinned.
  def dead_stamp(index)
    (Time.utc(2026, 9, 16, 14) + index * 600).iso8601
  end
end
