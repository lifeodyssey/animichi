# frozen_string_literal: true

# The verdict documents the reader is tested with: a document whose head line names the candidate, and
# one that names it on a differently-worded line.
module VerdictDocuments
  HEAD = "d49a1c8be1f2a3b4c5d6e7f8091a2b3c4d5e6f70".freeze

  APPROVED = <<~MARKDOWN
    # Round-2 review — #1672

    - HEAD (under review): `d49a1c8be1f2a3b4c5d6e7f8091a2b3c4d5e6f70` — chore(deps): to catalogs
    - Base: `8797c359245fe947223842423ea46cc48db07304`

    ## Verdict: APPROVED
  MARKDOWN

  CHANGES = <<~MARKDOWN
    # Round-1 review — PR #1711 (review lane)

    - Commit 1: `057dba0041a2b3c4d5e6f708192a3b4c5d6e7f80`
    - Candidate HEAD: `4ec8a4f6e60ad71605d96b46b1e1679789298a15` (branch `lifeodyssey/orca-1601-ac5`)

    ## Verdict: CHANGES REQUIRED
  MARKDOWN
end
