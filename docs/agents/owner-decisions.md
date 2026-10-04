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

## Agent API platform direction (2026-10-04)

After three verified research records (`docs/iterations/agent-platform-research-2026-10/`), the owner
approved the direction "one agent runtime, several surfaces, one contract" ("我感觉你的方案没啥问题")
with four decisions, and one constraint: "记得 staging 和 production 不太一样". The decisions:

1. Add a `service` principal kind; its first issuer is the Cloudflare Access service token.
2. The complete per-turn record (model, provider, per-call usage, tool calls and results, structured
   answer, status) is the single source of truth; the history read-back returns it.
3. Runs that need more than the 100-second turn budget continue in the background and are read as
   JSON by run id.
4. "No private back door" binds the web app; the agent's tools and `/v1` share one contract, and a
   contract-parity test keeps them aligned.

The spec is `docs/specs/2026-10-04-agent-api-platform-spec.md`. The earlier proposal that the agent
should call its own public capability API was withdrawn: no mature product does that.

Four consequences of decision 1 are written into the spec and wait for the owner's objection, not
for a new decision. Production has no Access application, so `service` exists in staging only;
giving production one would be a separate owner decision. The existing staging CI token stays a
door key only, because e2e, the smoke probe and the CD evidence recorder send it on every request;
`service` comes from a second Access service token that the edge accepts by Client ID. `service`
may run chat turns on staging, which adds `service` to `agent_admissions.payer` by a Prisma
migration. ADR 0006's staging row is
rewritten: the door stays Access and is not self-verified, and the edge verifies the Access
assertion only to derive `service`, because Cloudflare requires an origin to validate that JWT
before it trusts the claims.

## pi version line (2026-10-03)

pi-agent-core 1.0 removed the harness that the agent tier is built on; its successor
`@earendil-works/pi-durable` calls itself experimental. The owner chose a time-boxed spike on
pi-durable before any migration ("能用pi的就用pi的"), and existing SDKs over hand-built pipelines
("能用现成sdk就用现成sdk"). On 2026-10-04 the owner asked for two things, without ordering them: an
issue to move to 0.99.2, the last line that still ships the harness (#1995, "0.99开个issue"), and a
separate spec for the move off the harness whose first ticket is the spike ("剩下的做一个spec吧，spec
第一张卡写spike"); that spec is `docs/specs/2026-10-04-pi-durable-migration-spec.md`. The author's
reading, not an owner statement, and open to the owner's objection: staying on the 0.99 line until
that spec lands is a migration in progress under the latest-dependencies rule in
`docs/agents/code-standards.md`, not a pin around it.
