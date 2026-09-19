# Orca delivery, 2026-09-18 → 19

Two days of coordinated lane delivery: 16 PRs merged, the anitabi egress chain landed, 51 stale
cards closed, and eight infrastructure defects fixed at their cause.

| File | What it is | Read it when |
|---|---|---|
| `HANDOFF.md` | Live state at `371819375` — running lanes, the waiting stack, merge protocol, the three things that bite a fresh coordinator | Picking up coordination mid-flight |
| `LESSONS.md` | What the two days taught, with the incidents that paid for each | Writing a brief, adding a guard, or about to trust a measurement |

**The delivery itself is not here.** It is in the merged PRs, the commits, and the cards those
reference. These two files hold only what does not survive in them.

## The single finding that outlives the rest

Nine defects across two days were one shape: **a check whose real scope differs from the scope its
name claims** — in both directions. None produced a failure signal; all of them were cited, at some
point, as proof that something was safe.

The question that found every one: **what would have to happen for this check to go red?**

`LESSONS.md` §1 lists all nine.
