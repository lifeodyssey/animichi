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
