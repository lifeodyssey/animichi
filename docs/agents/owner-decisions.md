# Standing owner decisions

Decisions with a date and, where one exists, the issue. Only decisions still in force and without
a natural home elsewhere are here; when one is implemented in the repository, its entry moves to
the document that owns the result. What needs the owner at all is decided by the escalation path
in `docs/agents/harness.md`.

## Product stance

- Animichi is a tool, not a platform: the owner rejected community and social features.
- 聖地巡礼 (seichijunrei) is the product's identity; "pilgrimage" is the translation, not the
  brand.
- Two layers: the route planner is the practical wedge; the photo overlay tool is the future,
  native-app layer. Separate the wedge from the dream; refuse scope creep.

## Delivery scope (2026-09-23)

- The dispatch source is GitHub issues. An empty Ready for Dev column is not a reason to stop; the
  owner's verbal go-ahead is the tick's Ready for Dev, and the coordinator adds each dispatched
  card to Project #3 and sets it In Dev.
- Do not build the S2–S7 product stories (the `iteration:2`–`iteration:7` labelled cards,
  #213–#291). Spec and epic cards belong to the planner. Spend, staging/production actions and
  secrets stay with the owner. Why: most of the backlog's product stories were written in June–July
  against an architecture that no longer exists; the owner wants the delivery pipeline and the
  repository's debt cleared first.

## Eval spend (2026-09-16)

Paid eval runs are allowed only when every hop of the run (the model under test, tool calls, the
judge) goes through opencode go ("可以，只要是 opencode go 的随便跑"). If any hop is fixed to
another paid API, do not run; report back (#1560).

## Default model provider (2026-10-03)

Every default (non-BYOK) agent turn runs `mimo-v2.6-flash` through OpenCode Go instead of Xiaomi's
API ("我们先上默认的provider就是oc吧"). BYOK turns are unchanged. Production then depends on OpenCode
Go's quota alone, with no Xiaomi fallback. Xiaomi's credential binding stays in place, unread by
default turns, so rolling back to the previous release still works (#1974).

## Delivery workflow redesign (2026-09-29)

The orchestration is being redesigned as a state-driven agentic workflow; the design is
`orchestration/docs/orchestration-system-design.html` in `lifeodyssey/zdev`
(`docs/agents/orchestration.md`). Decided so far:

- Card state has one authority, computed from facts; the coordinator is a short session that reads
  that table each time it is woken and follows it.
- The tracker moves from GitHub Issues and Project #3 to Linear. Until the migration lands, GitHub
  Issues stay the working tracker.
- `/to-tickets` stays automatic and sets each card's estimate when it creates the card. An estimate
  is not changed after the card is Ready; a scheduled retrospective compares estimates with the
  actual difficulty instead.
- Models: the coordinator, the upgrade seat for a blocked card, and the cross-lane code review run
  Opus 5.5 with Fable as advisor. Very complex cards will go to a Sonnet 5.5 writer; it is not in
  the launcher roster yet and the estimate threshold is still to be set. Card-level review stays
  off Claude models (2026-09-24 decision stands); a card written by Opus or Sonnet is reviewed by
  GLM or DeepSeek.
- Cross-lane code review runs every 12 hours over every in-flight lane's diff. A finding inside one
  lane goes back to that lane; a finding spanning lanes becomes a new issue blocked by those cards
  and is handled after they merge.

## Failure-alert drill (2026-09-16)

A deliberate unattended workflow failure in the real repository is allowed, to prove the alert
issue reaches a person (#1718), with three constraints: not `cd.yml` (a manual dispatch deploys)
and not a workflow that calls a model; use `verify-deploy-evidence` with a card
number that does not exist; run it only once the notification code is on `main`; close the issue
the drill opens.

## First production migration (2026-09-15)

The Prisma chain is the migration authority (`docs/DOCS_POLICY.md`). The first production migration
(#1637) stays a separate, human-gated step: staging CD is green at every merge, and the
production run is approved by the owner with the run number and the
artefact checked (`docs/agents/delivery-flow.md`).

## osv ignore for GHSA-ch52-4w7c-c8xp (2026-10-04)

The advisory (http-cache-semantics ≤ 4.2.0, High, no fixed version, modified 2026-10-02) turned
every pull request's `security (osv)` lane red through `infra/database-access/pnpm-lock.yaml`, where
the package is only a transitive dependency of `@pulumi/pulumi` and unreachable: make-fetch-happen
builds its HTTP cache with `shared: false`, so the shared-cache entry the advisory needs never exists.
The coordinator proposed a time-boxed `osv-scanner.toml` ignore (14 days) as the one option that
unblocks delivery, and the owner replied "修啊" (2026-10-04). It expires on 2026-10-18: from that
date the lane is red again unless the lockfile has moved to a fixed version, and this entry leaves
with the toml. The root lockfile carries the same package; CI's osv lane does not read it today
(#1964 tracks the scanner that will), and that copy is a separate suppression decision. This does
not loosen the rule: every other suppression still needs the owner's approval first.
