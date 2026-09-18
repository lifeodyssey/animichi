# Delivery velocity, September 2026

The evidence base for #1768 and its children. Every report here was produced by an investigation
agent against a named commit, and each one is the reason a card says what it says. Without them a
future reader sees a dozen issues asserting numbers with no visible derivation.

**Read the measurement date and SHA at the top of each file before trusting a number.** These are
snapshots, not living documents. Where a figure has since been superseded, the card that
superseded it says so.

## What is here

| File | What it establishes | Backs |
|---|---|---|
| `INTEGRATION-PROFILE.md` | Where integration-test time actually goes, per suite and per phase, ranked by setup seconds per case. Measured at `6f084975e`, three runs per suite. | #1782, #1783, #1769, #1771 |
| `CONTRACT-TESTS.md` | What the 91 files in the `repository contracts` job actually test, sorted into four unrelated groups, and what each is worth. | #1774, #1776 |
| `UNIT-TEST-QUALITY.md` | 738 files, 4,549 tests read for shape: where assertions are vacuous, where copy is unpinned, where mocks pile up. | future test-quality cards |
| `INTEGRATION-TEST-QUALITY.md` | The same for integration tests: which suites cram cases, which are fine, with per-suite assertion density. | #1782 and follow-ups |
| `CI-PARALLELISM-MECHANISMS.md` | Every way to distribute CI work across machines, costed against primary sources, including the ones we rejected. | #1773 |
| `CI-PARALLELISM-FIELD-EVIDENCE.md` | What 23 real public monorepos actually do in their workflow files, read out of the YAML rather than from blog posts. | #1773 |

## Two reports are deliberately absent

**The pre-flip integration performance report is not here.** It was measured before the Prisma
flip, when Atlas owned the migration chain; `atlas-chain.ts` and `migrations/neon` no longer
exist, and every number in it needs re-deriving. `INTEGRATION-PROFILE.md` replaced it. Keeping a
known-void measurement beside a current one is how someone ends up acting on the wrong number.

**The first Nx/turborepo report is not here.** Its central recommendation was overturned by an
owner decision, and its analysis was superseded by the two CI-parallelism reports above, which
reach the same subject with better evidence.

## Raw data is not committed

Several reports cite raw artifacts — per-run JSONL, statement logs, instrumentation diffs — that
stayed on the machine that produced them. The reports carry the derived tables and the method;
the raw files were working material, not a record.

## The one finding that outlives all of them

Two separate investigations, on two separate days, found a test passing **for the wrong reason**:
a 135.44-second real-clock wait that no assertion ever read, and a 90-second settlement window inside
which a recurrent scan satisfied the obligation the test claimed to prove. Neither was visible
from a green suite. The 135.44 s is measured, not estimated: it is the `Finished in 135.440791s`
line in `CI / repository contracts` on run `35312913725`, quoted with its timestamps in
`CI-PARALLELISM-MECHANISMS.md` §0.3 — the earlier draft's "142 seconds" was the task's own estimate
and is superseded here.

The measurement that would have caught both is the same one: ask what a test asserts, then break
exactly that thing and watch it fail. A suite that has never been broken on purpose has not been
tested.
