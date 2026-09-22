# Orca delivery, 2026-09-18 → 21

Four days of coordinated lane delivery. The live pickup file is the newest `HANDOFF-*.md`;
the earlier ones are kept as history and say so in their own first lines.

| File | What it is | Read it when |
|---|---|---|
| [HANDOFF-2026-09-21-2330.md](HANDOFF-2026-09-21-2330.md) | **Live** coordination state as of 2026-09-21T15:45Z | Picking up coordination mid-flight |
| [HANDOFF-2026-09-21.md](HANDOFF-2026-09-21.md) | 21 September 13:45Z snapshot | Tracing how the 13:45Z lanes settled |
| [HANDOFF-2026-09-20.md](HANDOFF-2026-09-20.md) | 20 September snapshot. Stale, and instructively so: it called #1825/#1832 owner-blocked while the round-3 reports it links say both passed | Seeing how an inference becomes a fact by being written down |
| [HANDOFF.md](HANDOFF.md) | 19 September snapshot (#1628 still in review) | Reading how the prisma stack looked before #1628 merged |
| [LESSONS.md](LESSONS.md) | What the two days taught, with the incidents that paid for each | Writing a brief, adding a guard, or about to trust a measurement |

**The delivery itself is not here.** It is in the merged PRs, the commits, and the cards those
reference. These two files hold only what does not survive in them.

## The single finding that outlives the rest

Nine defects across two days were one shape: **a check whose real scope differs from the scope its
name claims** — in both directions. None produced a failure signal; all of them were cited, at some
point, as proof that something was safe.

The question that found every one: **what would have to happen for this check to go red?**

[LESSONS.md §1](LESSONS.md#1-the-defect-that-has-no-failure-signal) lists all nine.
