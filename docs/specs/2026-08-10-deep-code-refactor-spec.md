# Deep Code Refactor: One Turn, One Contract, One Owner

> Status: Owner-approved and published v9 — signed off on 2026-08-10 after Codex Sol and OpenCode DeepSeek v4 Flash approved the final focused round with no blocking findings or owner questions. `/to-tickets` published 27 native sub-issues with verified blocking edges. Production runtime liveness remains outside this local-development/staging campaign.
>
> Planning base: origin/main at b94c30ab on 2026-08-10.
>
> Tracking issue: [#936](https://github.com/lifeodyssey/animichi/issues/936).

## Problem Statement

### Context

The completed skeleton campaign improved repository shape, package naming, and deployment structure, but it did not consistently move behavior behind deep application seams. Important workflows still span transport handlers, framework objects, direct database access, runner helpers, and compatibility wrappers. Tests often patch those internals, so changing the implementation requires preserving accidental structure instead of preserving product behavior.

The sharpest example is one Agent user turn. Session loading, command selection, model execution, persistence, metering, audit, and terminal streaming behavior are still coordinated across several callers. The existing HandleUserMessage service only guards a small prefix of that lifecycle; it is not the application boundary that callers or tests can rely on.

Similar shallow boundaries remain elsewhere:

- Users delegates SavedRoute behavior through thin handlers while SessionSummary still crosses into Agent-owned data.
- Catalog has a good PlanItinerary application seam, but keeps pass-through API wrappers and shadow contract models.
- Jobs owns direct retention SQL and policy even though the affected data belongs to Agent or Users.
- Web retains competing homes for chat, route detail, and map behavior.
- Edge has real policies, but request identity, protection, and forwarding remain spread through thick entry modules and legacy vocabulary.
- Contract is the intended published language, while package-local wire mirrors and parity tests still permit two sources of truth.
- Authentication still carries Supabase and Animichi-issued sk_* compatibility paths. The staging Neon branch is login-ready, but Edge still pins a redacted issuer/JWKS placeholder; a clean cut is possible only after declarative real-issuer and QA-login proof.

The result is a monorepo that looks more modular than it behaves. The next campaign must deepen boundaries, delete obsolete paths, and replace structure-coupled tests with behavior tests. It must not create a second skeleton or preserve staging-only compatibility.

### Goals

1. Establish one complete Agent Turn reference slice with one public application seam.
2. Make packages own behavior and data, not just directories and type names.
3. Make Contract the only source of cross-deployable wire shapes.
4. Make Neon Auth the only human identity authority and remove Animichi machine API keys.
5. Collapse Agent dialogue state into one Session aggregate with one durable Message transcript.
6. Apply the same deep-module standard to Catalog, Users, Web, Edge, migrations, and cross-stack tests, and delete the unjustified generic Jobs subsystem instead of rebuilding it.
7. Deliver every change as a complete vertical slice with replacement tests and no compatibility layer.

## Solution

### Design Decision

The first reference slice is one complete Agent user turn. The published application interface is AgentTurn.execute. It accepts one closed command union — TextTurn, PointSelectionTurn, or CandidateSelectionTurn — plus a framework-neutral TurnContext and an optional TurnEventSink, and returns a typed TurnResult. Every command carries a caller-generated turn identifier and expected Session revision; both selection commands also carry an opaque, globally unique offer identifier issued by the Session. A first turn explicitly sends no Session identifier and no expected revision. Every successful terminal result publishes the canonical Session identifier, committed revision, and any newly issued offer identifier needed to construct the next command.

TurnAdmission is a separate pre-stream application boundary for identity, quota, Session ownership, concurrency, and BYOK admission. In one transaction it creates or loads the Session, establishes the sole winner for the actor, turn identifier, and command digest, and creates one idempotent quota reservation. Only the winner receives a single-use admitted capability inside TurnContext, bound to that durable turn record, actor, payer, Session, expected revision, expiry, and reservation. Completed and concurrent replays cannot reserve quota again.

Once admission succeeds, AgentTurn owns the observable lifecycle. The durable turn record advances from reserved to running and then to exactly one of succeeded, rejected, aborted, cancelled, or aborted_uncertain. AgentTurn dispatches the command, runs deterministic selection or the model, projects current-turn provenance, persists required state with revision compare-and-set, settles quota, meters and audits, and records the terminal result. Cancellation before external dispatch records cancelled and releases the reservation; cancellation after an unconfirmed dispatch records aborted_uncertain and settles conservatively, while a confirmed response preserves its known usage before the appropriate aborted or cancelled persistence result. Every branch re-raises the cancellation cause. For this local/staging campaign, a bounded indexed sweep claims expired leases on Agent startup and before every TurnAdmission, before quota or budget reads; it closes abandoned records without replaying an uncertain provider call. No background scheduler, queue, or Workflow is introduced. An identical completed replay returns the stored result; a payload mismatch, stale revision, or concurrent in-flight replay returns a typed conflict and never automatically repeats model execution.

The only published Agent **turn** HTTP interface is POST /v1/chat, whose successful response is the AI SDK SSE protocol. Validation and admission failures return typed Contract errors before the stream starts; failures after start are terminal Contract events. Legacy /v1/runtime turn paths, dual turn entry points, and transport-owned orchestration are deleted. Health, Session ownership transition, photo search, feedback, and other non-turn capabilities remain separate interfaces unless their own vertical slice explicitly changes them.

The same rule then moves across the monorepo: each meaningful behavior gets one application use case that owns its ordering and policy; inbound adapters parse and map; outbound adapters implement narrow ports; tests call the application seam rather than patching internals.

### Architecture

- **Contract** is the sole wire source of truth for published paths, commands, events, results, and errors. TypeScript consumers import it directly. Python boundary models are generated and checked for drift. Internal domain models remain independent and map at the boundary.
- **Agent** owns one Session aggregate containing its identifier, actor binding, ordered Messages, tool state, fact ledger, and in-session memory. Messages are the durable user-visible transcript. Runtime checkpoints cannot become a second transcript.
- **Users** owns RouteShares, WalkCheckins, dormant UserMemory, and SavedRoutes created only by an explicit authenticated Save. It neither reads nor projects Agent Sessions and has no anonymous SavedRoute, claim_session_id, or Session-linked ownership transfer.
- **Catalog** owns Point and Bangumi master data and Itinerary computation. Agent and Users use owner-published application interfaces or identifiers, never Catalog-owned raw tables.
- **Automated retention is absent from this campaign's target.** The current generic Jobs Worker and both duplicate purge implementations are deleted without replacement. Staging data is disposable and removed only by the declared staging reset; production Session lifecycle, user deletion, account deletion, backup expiry, and any future TTL require a separate pre-production decision.
- **Web** owns browser interaction state and maps the single chat contract into UI state. It does not recreate Agent lifecycle policy.
- **Edge** owns the only human-token verification path, anonymous identity, request protection, and forwarding. It strips caller credentials and identity headers, then sends a trusted internal identity over service bindings; downstream Workers do not re-verify the browser token or accept direct identity headers. It does not own Agent Session or pilgrimage domain models.
- **Neon Auth** is the sole human JWT authority. Supabase Auth, dual-issuer fallback, and Animichi-issued sk_* credentials are removed in the staging cutover.
- **Infrastructure changes required by a code slice** must be declarative and reviewable as infrastructure as code. No dashboard-only or hand-run production configuration is introduced.

## User Stories

### Complete Agent Turn

1. As a chat user, I want a text message to execute as one complete turn, so that I receive one coherent result without transport-specific behavior.
   - AC: A TextTurn produces one domain result and one set of durable effects through AgentTurn, while the chat adapter only maps its events and terminal result to AI SDK SSE. [integration]

2. As a chat user, I want a point selection to continue my current Session, so that selecting an offered Point is deterministic and does not restart the conversation.
   - AC: A valid PointSelectionTurn consumes an opaque offer identifier issued by the admitted Session at the expected revision and does not invoke the model when deterministic handling is sufficient. [unit]

3. As a chat user, I want a candidate selection to be bound to the offer I saw, so that stale or cross-Session selections cannot mutate my current plan.
   - AC: Unknown and cross-Session offers share one public invalid_selection result, a stale revision of the caller's admitted Session returns stale_selection, internal audit retains the specific cause, and no rejected command writes product state. [unit]

4. As a first-time user, I want my first turn to create one Session identifier and actor binding, so that every event, Message, usage record, and result refers to the same dialogue.
   - AC: A command with no Session identifier and no expected revision allocates one canonical Session, while its successful result publishes that identifier and the committed revision across all observable outputs. [integration]

5. As a returning user, I want a turn to restore the state needed to continue, so that prior choices and facts remain available without replaying a second transcript.
   - AC: Restored execution rebuilds continuation state from the Session aggregate while current-turn output excludes stale provenance from earlier turns. [integration]

6. As a Session owner, I want unauthorized continuation rejected before streaming begins, so that another identity cannot learn whether or how my Session exists.
   - AC: TurnAdmission maps missing and forbidden Session cases to the same public result and handles expiry without exposing another actor's Session before AgentTurn starts. [api]

7. As a streaming caller, I want ordered progress events, so that the UI can render useful progress without understanding internal runner structure.
    - AC: After process loss, Agent startup or the next admission reconciles the expired lease before policy/quota/budget evaluation and records exactly one terminal outcome and settlement. [integration]
    - AC: A writable sink observes one start, paired step transitions, and exactly one terminal event in deterministic order. [unit]

8. As a caller, I want success to mean required writes completed, so that a successful terminal result never describes state that was not persisted.
   - AC: Injecting a required persistence failure prevents a finished outcome and produces one typed aborted outcome. [integration]

9. As a caller, I want cancellation to remain cancellation, so that disconnects are not reported as business failures or successful turns.
    - AC: Controlled cancellation before dispatch records cancelled and releases the reservation; cancellation during an unconfirmed provider call records aborted_uncertain and settles conservatively; cancellation after a confirmed response preserves known usage; cancellation during required persistence cannot report success. Every branch performs bounded cleanup, emits only to a writable sink, and re-raises the cancellation cause. [integration]

10. As an operator, I want dependency failures classified, so that Catalog, model, database, and policy failures can be diagnosed without exposing sensitive payloads.
    - AC: Each dependency failure maps to a stable typed cause, trace identity, and redacted audit record. [integration]

11. As an operator, I want usage and payer attribution tied to the completed turn, so that platform and BYOK accounting cannot drift from the model call that occurred.
    - AC: Turn replay, concurrent submission, crash recovery, and retry tests prove one durable winner, one quota reservation and settlement, at most one model execution, and one usage attribution for the admitted payer, Session, and turn identifier. [integration]

12. As a user, I want language and safety behavior preserved during refactoring, so that architecture work does not silently change response quality or guardrails.
    - AC: Existing translation, injection, output-validation, and current-turn provenance cases retain their accepted outcomes through the new seam. [eval]

### One Published Interface and Contract

13. As a browser caller, I want one /v1/chat turn interface, so that text and selection turns do not depend on undocumented runtime endpoints.
    - AC: Contract and API tests expose /v1/chat and reject the removed /v1/runtime and /v1/runtime/stream paths. [api]

14. As a chat caller, I want failures represented according to when they occur, so that pre-stream rejection and post-stream failure remain protocol-correct.
    - AC: Validation and TurnAdmission failures return typed Contract HTTP errors before stream start, while every later failure records one terminal outcome and maps to a terminal SSE event when the sink is writable. [api]

15. As a streaming caller, I want protocol frames derived from neutral turn events, so that changing the SSE library cannot change the application lifecycle.
    - AC: Adapter tests verify event-to-frame mapping and disconnect propagation without executing a second lifecycle state machine. [api]

16. As a TypeScript consumer, I want published DTOs imported from Contract, so that Web and Workers cannot redefine a subtly different wire model.
    - AC: A published-interface inventory covers the turn API and every retained non-turn Agent API, and a drift check fails when any consumer introduces a package-local request, event, result, or error shape. [integration]

17. As a Python maintainer, I want boundary models generated from Contract, so that FastAPI validation matches the TypeScript source of truth without hand-maintained parity.
    - AC: Regeneration is deterministic, checked into source, and CI detects any generated diff or unsupported schema construct. [integration]

18. As a domain maintainer, I want internal models independent from wire DTOs, so that domain refactoring does not force compatibility aliases into the published contract.
    - AC: Mapping tests prove domain commands and outcomes convert to the published contract without domain modules importing transport framework types. [unit]

### Identity and Admission

19. As an authenticated user, I want Neon Auth to be the only accepted human issuer, so that identity has one fail-closed verification path.
    - AC: After IaC derives the real issuer/JWKS from the exact staging Neon branch and provisions the QA path, a real Neon Auth login produces a token accepted once at Edge and the trusted internal identity expected by TurnAdmission and downstream services. [api]

20. As an anonymous user, I want permitted chat and browsing flows to remain available, so that the auth cutover does not turn the whole product into a login wall.
    - AC: The Contract-exported anonymous policy matrix allows only chat, photo search, and photo confirmation as identity-bearing anonymous APIs; allows preview, popular, and guide as identityless public reads; rejects every other API; enforces 20 requests per 60 seconds per anonymous identity, 20 chat turns per UTC day, a shared USD 5.00 daily model-spend breaker, no BYOK, and no separate photo-search daily cap. [api]

21. As a security owner, I want Supabase tokens rejected after cutover, so that dual-issuer fallback cannot silently survive.
    - AC: Formerly valid Supabase tokens fail closed at Edge and never reach an application use case. [api]

22. As a security owner, I want Animichi-issued sk_* API keys removed, so that an unused machine-credential capability cannot bypass the human and anonymous policies.
    - AC: API-key storage including the Neon `api_keys` table and grants, minting, verification, secrets, tests, and docs are absent, and Authorization: Bearer sk_* is rejected as a removed Animichi identity channel. [api]

23. As a BYOK user, I want my model-provider key treated as payer input rather than Animichi identity, so that deleting sk_* does not delete supported BYOK behavior.
    - AC: The designated sensitive BYOK header remains opaque and is never prefix-classified, body-modeled, logged, traced, emitted, audited, or persisted; guarded egress, redaction, safety, quota policy, and disconnect cleanup remain enforced. [integration]

### Session and User Data Ownership

24. As a chat user, I want one durable Session aggregate, so that actor binding, Messages, tool state, facts, and in-session memory cannot diverge between competing roots.
    - AC: Fresh-schema and repository tests demonstrate one writer, one aggregate identifier, and one revision for all dialogue state retained after the staging reset. [integration]

25. As a chat user, I want Messages to be the sole visible transcript, so that a runtime checkpoint cannot produce a conflicting conversation history.
    - AC: Replayed and concurrent completed turns append ordered Messages exactly once, while continuation snapshots contain no second product transcript. [integration]

26. As a privacy owner, I want Users separated from Agent Sessions, so that user-document retention and chat retention do not accidentally keep each other alive.
    - AC: Users has no Session listing, projection, raw Agent-table read, anonymous SavedRoute claim endpoint, claim_session_id column, or Session-linked retention dependency. [integration]

27. As an authenticated user, I want a SavedRoute created only when I explicitly save, so that generating an Itinerary never creates a hidden user document.
    - AC: Explicit Save creates or updates one user-owned SavedRoute; Agent completion alone performs no SavedRoute write. [api]

28. As an anonymous user who chooses Save, I want the save intent replayed after login, so that I can preserve my choice without creating an anonymous Users record or claim protocol.
    - AC: The browser holds only the minimum pending save intent, then creates a new authenticated SavedRoute after successful login and clears the pending intent. [browser]

29. As an anonymous chat user who signs in, I want my existing Agent Sessions adopted by my authenticated identity, so that login-at-save does not discard my conversation history.
    - AC: An Agent-owned idempotent ownership command uses only trusted anonymous and Neon identities, accepts no client-supplied Session identifier, atomically rebinds that browser's Sessions, increments each adopted Session revision, invalidates every previously admitted anonymous capability by compare-and-set, audits the transition, and returns a typed no-op for cross-device login. [api]

### Deep Package Boundaries

30. As an Agent maintainer, I want Catalog accessed through consumer-owned narrow read ports, so that Agent never depends on Catalog SQL, row mapping, or framework handlers.
    - AC: Agent behavior tests substitute a CatalogReadGateway covering the required resolve, Point, nearby, geocode, and Itinerary capabilities, while adapter integration tests alone cover the real Catalog protocol. [integration]

31. As a Catalog maintainer, I want PlanItinerary to remain the behavioral seam, so that pass-through API wrappers and duplicate route terminology can be deleted.
    - AC: Catalog behavior is tested through PlanItinerary, and removing a key planning rule makes its mutation probe fail. [unit]

32. As a Users maintainer, I want SavedRoute operations expressed as application use cases, so that authorization, validation, and persistence policy are not hidden in a database adapter.
    - AC: SavedRoute use-case tests cover create, list, update, delete, ownership rejection, and persistence failure with no transport object. [unit]

33. As a maintainer, I want the unproven automated-retention subsystem removed, so that staging does not carry a Worker, credentials, grants, schedules, and duplicate implementations for a product policy that has not been chosen for production.
    - AC: `workers/jobs`, both Python purge paths, all purge repository methods, both staging scheduled and manual triggers, retention-only staging settings, runtime roles, credentials, grants, tests, package routing, staging deployment mappings, and current non-production Cloudflare schedules are absent; the SAFE-1 pinned production Jobs manifest, deploy/maintenance-rollback mappings, runtime credential, grants, and scheduled runtime are the only live exception, and no replacement Worker, Workflow, function, soft-delete flag, or TTL is introduced. [integration]

34. As a Web maintainer, I want chat and save behavior organized as complete features, so that route handlers and components do not recreate Agent or Users policy.
    - AC: Browser tests cover chat, selection, cancellation, login-at-save, and explicit save through feature-owned client seams. [browser]

35. As a Web maintainer, I want one route-detail and map composition path, so that duplicate feature homes cannot drift in loading, selection, and error behavior.
    - AC: One browser scenario exercises the retained composition, and imports from the retired duplicate homes fail the source-structure gate. [browser]

36. As an Edge maintainer, I want identity, protection, and forwarding to form one request use case, so that the entry module is composition rather than a parallel policy implementation.
    - AC: Policy tests cover Neon Auth, anonymous access, Turnstile, rate limiting, route selection, trusted headers, and fail-closed forwarding. [unit]

37. As a migration maintainer, I want a fresh target schema with an explicit retained-surface manifest and legacy names removed, so that safety-critical storage cannot disappear behind fail-open adapters.
    - AC: A reset staging database converges from one explicit retained-surface manifest: Session, Message, SavedRoute, Point, Bangumi, Itinerary, durable turn, anonymous quota, daily usage, request audit, feedback, Agent memory, ingest, and required location/media support. It contains no retired route, work, conversation-root, anonymous claim, Supabase-auth, or Animichi API-key schema surface, and post-reset quota, budget, audit, feedback, replay, ingest, SavedRoute create/read, Point/Bangumi read, and location/media behavior passes. [integration]

### Refactor Delivery

38. As a maintainer, I want behavior tests to replace structure-coupled tests, so that internal extraction, deletion, and renaming remain cheap.
    - AC: Every slice removes superseded patch-through tests in the same change and demonstrates at least one relevant mutation that the replacement suite kills. [unit]

39. As a reviewer, I want every pull request to be a complete vertical slice, so that main never contains an unused architecture layer or compatibility bridge.
    - AC: Each ticket's acceptance suite proves its application seam, real local/staging runtime adapter, caller migration, old-path deletion, and observability together. [integration]

40. As a maintainer, I want the repository quality ratchet preserved, so that deep refactoring reduces complexity rather than moving it.
    - AC: Changed code obeys the repository size, typing, coverage, mock, and suppression rules with no lowered threshold or new exemption. [integration]

41. As a staging operator, I want the hard cutover reproducible from code, so that no successful refactor depends on undocumented local state or dashboard edits.
    - AC: A declarative cutover closes staging ingress, removes and verifies absence of every retention trigger, preserves the Neon Auth schema, resets the application schema, applies the fresh chain, deploys every final-schema consumer, passes private smokes, and only then reopens ingress; failure leaves ingress closed and supports reset-and-redeploy. [integration]

## Implementation Decisions

### Application and Contract Decisions

1. AgentTurn.execute is the single product-behavior test seam for a complete turn. A recording TurnEventSink observes the same call; it is not a second application entry.
2. The turn command is a closed discriminated union of TextTurn, PointSelectionTurn, and CandidateSelectionTurn. Every command carries turn_id; an initial command carries neither session_id nor expected_session_revision, while every continuation carries both. Both selection commands carry an opaque, globally unique offer_id issued and stored by the Session. Every successful TurnResult publishes session_id, the committed session_revision, and any newly issued offer_id; Web stores that revision for the next command, and a stale rejection does not advance it. Photo-confirmation offers are a separate sessionless namespace issued and stored by ConfirmPhotoOffer; they become Session offers only through a future explicit slice and dependency.
3. TurnAdmission owns pre-stream identity, Session ownership, concurrency, quota, and BYOK admission. In one transaction it reserves the actor, turn_id, and command_digest and creates an idempotent quota reservation. Only that winner receives a single-use admitted capability bound to the durable turn record, actor, payer, Session, revision, expiry, and reservation; completed and concurrent replays acquire no additional quota.
4. AgentTurn consumes the admitted reservation and owns ordering through one durable terminal outcome. The turn lifecycle is reserved, running, then succeeded, rejected, aborted, cancelled, or aborted_uncertain. Finalization uses Session revision compare-and-set. Cancellation before dispatch records cancelled and releases the reservation; an unconfirmed provider dispatch records aborted_uncertain and settles conservatively; a confirmed response retains known usage through later cancellation or persistence failure. A bounded indexed sweep runs on Agent startup and before each TurnAdmission, before quota/budget reads, claims expired leases, and never repeats an uncertain model call. Identical completed replay returns the stored result, while payload mismatch and concurrent reuse are typed conflicts. There is no wall-clock guarantee during a no-traffic staging interval and no new background deployable in this campaign.
5. Progress events are a narrow observation interface. They expose stable product progress and terminal semantics, not PydanticAI callbacks, database records, or framework exceptions. A disconnected sink may miss the terminal event, but the internal turn record still has exactly one terminal outcome.
6. POST /v1/chat is the sole Agent **turn** HTTP interface and successful calls use AI SDK SSE. Pre-stream failures are typed Contract HTTP errors; post-start failures are terminal Contract events. Legacy runtime turn paths are deleted, while non-turn Agent capabilities are not implicitly removed.
7. Contract owns all published paths, request shapes, event shapes, terminal results, and error codes, including every retained non-turn Agent interface. CONTRACT-1 generates and consumes only health and service-metadata Python boundary models plus the complete path inventory. Each later capability card extends generation, migrates its live production boundary, and deletes its handwritten wire mirror in the same pull request; the inventory may list future paths but cannot create unused generated models.
8. Context-local models stay independent. Boundary mappers are explicit; generated wire models do not become Agent, Catalog, or Users domain entities.

### Ownership Decisions

9. Agent owns one Session aggregate. Session and Conversation are not parallel roots; the Session has an actor binding, and ordered Messages are the only durable user-visible transcript.
10. Agent is the sole Session writer. It publishes an idempotent ownership-transition command that consumes only trusted anonymous and Neon identities, accepts no client Session identifier, atomically adopts the browser's anonymous Sessions, increments their revisions so every previously admitted anonymous capability fails compare-and-set, and audits the change. Users exposes no SessionSummary, Session list, anonymous SavedRoute claim, or retention dependency on Agent data.
11. Users creates SavedRoutes only through an explicit authenticated Save. A pending anonymous Save is browser intent, not a database record, and is replayed as a new authenticated Save after login. This decision does not change Users ownership of RouteShare, WalkCheckin, or dormant UserMemory.
12. Agent consumes Catalog through a consumer-owned CatalogReadGateway split into narrow capabilities. Catalog's PlanItinerary pattern remains the reference application seam for Itinerary computation; thin wrappers, compatibility type exports, and duplicate behavior tests around it are removed.
13. Automated Session and anonymous-quota retention is not justified for the current staging-only product and is removed rather than redesigned. No Session TTL, route-bearing exception, soft-delete state, retention function, background Worker, or schedule survives. Staging reset is the only campaign-level data destruction. Production data lifecycle is a mandatory, separate pre-production design with its own owner decision and user-facing policy.
14. Web feature modules own browser state and protocol mapping, while Agent and Users remain the authorities for chat and saved data.
15. Edge composes identity, protection, and forwarding. It forwards trusted identity and never imports or redefines pilgrimage domain models.

### Identity and Migration Decisions

16. Neon Auth is the sole human JWT issuer at staging cutover. Before deleting Supabase fallback, IaC derives and pins the real issuer and JWKS from the exact staging Neon branch, provisions a non-production QA login path with secrets kept in the declared secret store, and proves a real token at Edge. Edge is the only browser-token verifier: it strips Authorization and caller identity headers, then forwards an unforgeable internal identity over service bindings. Users removes its JWKS/bearer verifier and rejects direct or forged identity input. Supabase Auth and dual-issuer fallback are removed, not deprecated.
17. Animichi-issued sk_* machine credentials are removed completely from the Authorization identity channel, including the Neon `api_keys` table and grants. User-supplied model-provider BYOK remains payer configuration after identity admission, is accepted only through its designated sensitive header channel, and preserves redaction, guarded egress, and client cleanup.
   The staging anonymous policy is a Contract-exported matrix and its generated runtime configuration is the sole source consumed by Edge and TurnAdmission rather than prose or duplicated constants: chat, photo search, and photo confirmation are the only identity-bearing anonymous APIs; preview, popular, and guide are identityless public reads; every other API requires Neon identity. Anonymous traffic has a 20-request/60-second per-identity burst limit, a 20-turn UTC-day chat quota, and a shared USD 5.00 UTC-day model-spend breaker. Anonymous BYOK is forbidden, and the separate photo-search daily cap remains disabled. Changing any cell or value is a later owner-level product decision, not an implementation detail of this refactor.
18. Staging application data is disposable and the campaign targets a reset application schema built from a rewritten fresh migration chain while preserving the Neon Auth schema. The exact retained manifest covers Session, Message, SavedRoute, Point, Bangumi, Itinerary, durable turn, anonymous quota, daily usage, request audit, feedback, Agent memory, ingest, and required location/media support. Post-reset tests exercise every safety-critical retained adapter instead of trusting table presence. The campaign does not implement an upgrader for current staging records. Production auth, users, data, and Supabase resources remain untouched for the separate pre-production migration decision.
19. Database changes use owner-specific roles and migrations. Any required platform resource, grant, binding, secret reference, or safety gate is expressed through infrastructure as code; no manual configuration becomes part of the design. Retention-only roles, grants, bindings, and secrets are deleted rather than renamed.
20. Every deep-refactor campaign revision is ineligible for production promotion, not only auth or schema-cut revisions. Until a separate production migration ADR changes PromotionEligibility, all automatic and manual production entry points—`ci.yml`, `deploy.yml`, and `rollback.yml`—resolve one owner-approved immutable pre-campaign release manifest containing source revision, Atlas target, and every production component; they fail closed before campaign checkout, migration, build, deployment, or rollback and accept no caller-selected ref outside that manifest. The pinned manifest retains the production Jobs component, deploy/maintenance-rollback capability, runtime credential, grants, and scheduled runtime. Artifact digests belong to the successor build-once CI/CD design, not this source-checkout guard.
21. This campaign permits no code-level compatibility window: no dual issuer, dual read, dual write, alias, shadow DTO, wrapper, or legacy turn endpoint. A declarative staging cutover closes ingress, disables and removes every old retention trigger before schema mutation, preserves Neon Auth, resets the application schema, applies the fresh chain, deploys all final-schema consumers, runs private smokes, and only then reopens traffic. Retention schedules are never reopened. Any failure leaves ingress closed and supports reset-and-redeploy; a workflow-order contract test enforces the state machine.

### Local and Staging Recovery Boundary

This campaign chooses demand-driven recovery because it develops locally and changes staging only. Agent startup and every TurnAdmission perform a bounded indexed expired-lease sweep before policy, quota, or budget reads. The next observable request therefore sees reconciled state, while an idle staging environment has no artificial wall-clock terminalization promise. A scheduler, queue, Workflow, or production no-traffic service-level objective requires a separate pre-production decision and cannot enter this campaign as incidental infrastructure.

### Delivery Decisions

22. One ticket equals one dedicated worktree and one reviewable pull request. Each pull request includes application behavior, adapters, callers, tests, deletion, and observability for one vertical slice.
23. Within a pull request, commits stay small and green. Characterization comes before structural change; replacement tests and deletion land before the pull request is complete.
24. Tests are replaced, not layered. A test that exists only to patch a former internal helper is deleted once the same behavior is covered at the application seam.
25. The campaign follows the repository 1-10-50, typing, coverage, and no-suppression rules. Every pull request must have Codecov patch coverage of at least 95%, and repository coverage floors may only increase. No compatibility or coverage exception is granted merely because the refactor is large.

### Task Breakdown

**Each numbered row below is one ticket, one dedicated worktree, and one reviewable pull request.** The only exception is no exception: if a row cannot fit while remaining complete, it returns to specification instead of being split into horizontal layers. Every row begins with a behavior manifest and characterization commit, then includes its application seam, real local/staging runtime adapter, real caller migration, old-path deletion, redacted observability, typed acceptance test, a meaningful mutation killed by that test, and Codecov patch coverage of at least 95%. Those are card-internal gates, not separate “architecture”, “test infrastructure”, or “cleanup” tickets.

| ID | Behavior seam and real runtime adapter | Caller migration and deletion | Observability | Acceptance and mutation proof | `needs` |
|---|---|---|---|---|---|
| SAFE-1 | PromotionEligibility resolves one immutable pre-campaign release manifest containing source revision, Atlas target, and every production component; the release/IaC guard is the production adapter. | Automatic `ci.yml` promotion and manual `deploy.yml`/`rollback.yml` entry points use only the manifest; delete caller-selected refs and every path that can checkout, build, migrate, deploy, or roll back a campaign revision to production. Preserve the pinned production Jobs deploy/maintenance-rollback mappings, runtime credential, grants, and scheduled runtime. | Record manifest digest, source revision, schema target, component, environment, entry point, verdict, and public reason; never a secret. | Every campaign revision is rejected while every pinned component remains eligible; all three entry points fail before campaign checkout or mutation; changing one manifest field or restoring a caller ref fails. [integration] | None |
| CONTRACT-1 | GenerateAgentBoundaryModels publishes only health/service-metadata Python models plus the complete Agent path inventory; GetServiceMetadata is the live consumer. | Edge and deployment smokes consume the Contract; delete handwritten health shapes and legacy runtime metadata. Future paths appear only in the inventory, not as unused generated models. | Report generation drift, unsupported schema constructs, service version, and health outcome. | Two generations are byte-identical and clean-tree; deleting a health field or retained path, or adding a deliberately unsupported schema construct, fails. [integration] | SAFE-1 |
| TURN-1 | ModelTurnPort and the neutral TurnEventSink wrap the production PydanticAI executor and AI SDK frame mapper while the current turn caller immediately uses them. | Migrate the live caller in the same change; delete application and route dependencies on PydanticAI result/callback types. | Preserve model spans and add neutral stage and outcome fields without prompt, actor, or credential data. | Scripted success, failure, cancellation, usage, and current-turn provenance pass; removing provenance isolation fails. [unit] | SAFE-1 |
| AUTH-1 | Contract IdentityPolicy and Edge AuthenticateIdentity own the explicit public/anonymous/authenticated matrix and its generated numeric configuration while the current route/admission path consumes them. | Delete every `sk_*` identity path, `agent` identity class, API-key mint/verify/persistence surface, Neon `api_keys` table and grants, secret, test, and live doc; keep BYOK only in its sensitive payer channel. | Record identity kind, policy cell, stable rejection cause, and outcome; never token, header, user identifier, or BYOK material. | Every matrix cell and numeric value is tested at its consumers; accepting `sk_*`, anonymous BYOK, restoring the table, or hardcoding a divergent quota value fails. [api] | SAFE-1, CONTRACT-1 |
| TURN-2 | TurnAdmission owns identity-to-payer mapping, Session ownership, expected revision, concurrency, and one transactional turn/quota reservation through the live repositories. | Integrate it before every current text and selection caller; delete duplicate route/runner admission, quota, and BYOK ordering. Consume only AUTH-1's generated policy/configuration values. | Record admission outcome, policy cell, reservation state, and conflict class without content, credential, or identity values. | Initial/continued admission, one durable winner, completed/in-flight replay, digest mismatch, stale revision, quota, ownership collapse, and BYOK pass; removing uniqueness or hardcoding policy fails. [integration] | SAFE-1, CONTRACT-1, TURN-1, AUTH-1 |
| TURN-3 | TurnOutcome owns reserved/running/terminal transitions, phase-aware cancellation, exactly-once quota settlement, lease claims, and the bounded demand-driven sweep while the current caller immediately uses it. | Migrate every current turn finalization and crash path; run the indexed sweep on Agent startup and before TurnAdmission, before policy/quota/budget reads; delete route/runner-owned settlement, terminal audit, and recovery branches. Never replay an uncertain provider call and add no scheduler, queue, or Workflow. | Record state transition, lease/reconciliation disposition, dispatch certainty, quota settlement, dependency class, latency, and terminal outcome without content or identity values. | Kill the owner after reserve and after dispatch; prove startup and next-admission reconciliation, bounded batches, concurrent claim safety, and phase-aware cancellation. Removing the lease, pre-admission ordering, dispatch-certainty branch, or exactly-once guard fails. [integration] | TURN-2 |
| TURN-4 | AgentTurn implements TextTurn, PointSelectionTurn, and CandidateSelectionTurn through Session, Catalog, ModelTurnPort, TurnOutcome, and one SSE adapter; this card extends generated Contract models for `/v1/chat`. | Web sends turn identifier, Session revision, and the matching Session offer; delete RuntimeAPI lifecycle orchestration, shallow HandleUserMessage, legacy runtime paths, old request modes, selection bypasses, handwritten turn DTOs, and structure-patching tests. | Record neutral stage, dependency category, latency, and terminal projection without content or identity values. | Initial/continued turns, all commands, replay/conflict, stale/invalid selection, persistence, SSE order, disconnect, browser behavior, and named translation/injection/output/provenance eval baselines pass; removing CAS or public selection-oracle collapse fails. [integration] | TURN-3 |
| AUTH-2 | VerifyNeonIdentity at Edge and the Web auth-session seam use the exact staging Neon Auth branch; IaC derives issuer/JWKS and provisions the QA login path. | Migrate Web callback/API callers, local login, E2E, and `/v1/users/*` through Edge authentication. Edge strips Authorization and caller identity headers and forwards internal identity over the service binding; Users deletes its JWKS/bearer verifier. Delete Supabase verification, issuer fallback, activation flag, GoTrue fixtures, and old login commands only after the real-token smoke; update root/package guides, architecture reference, and auth runbook to the observed cutover state. | Record issuer class, verification outcome, internal-boundary verdict, and cutover smoke only; never token or claims. | The successor local-login command drives an unmocked browser through the Neon callback, session cookie/JWT establishment, and one authenticated Users request through Edge. [browser] Real staging tokens and Edge-bound calls pass while former Supabase tokens, raw Users bearer access, forged headers, or weaker issuer/audience/algorithm/internal-boundary checks fail. [api] | SAFE-1, AUTH-1 |
| AGENT-1 | SearchPhoto and ConfirmPhotoOffer own recognition, their separate sessionless candidate-offer namespace, confirmation, quota, BYOK, and usage policy through vision and Catalog adapters. | Migrate Web upload/confirmation and generated FastAPI boundaries; delete route-local wire models, route orchestration, and duplicate transport tests. | Record tier, outcome, offer correlation, and latency; never image bytes, credential, base URL, query, or actor. | Anonymous/member, malformed image, quota, guarded egress, candidate confirmation, cleanup, and contract cases pass; bypassing quota, accepting a wrong offer, or treating it as a Session offer fails. [api] | CONTRACT-1, AUTH-2, CATALOG-1, CATALOG-3 |
| AGENT-2 | ProbeModelCredential owns one bounded provider capability probe through guarded egress and extends its generated boundary in the same slice. | Migrate the Web BYOK caller; delete handwritten probe/error mirrors and duplicated route ordering. | Record provider family, outcome, latency, and egress verdict; never key, header, base URL, or response body. | Auth, anonymous rejection, SSRF, timeout, response cap, redaction, cleanup, and generated-contract cases pass; allowing anonymous probe or secret tracing fails. [integration] | CONTRACT-1, AUTH-2 |
| USERS-1 | SaveSavedRoute executes authenticated Create or Update and owns authorization, status transition, saved-at policy, and stable errors through the Neon store. | Migrate the Contract handler and Web Save action; delete pass-through handlers, adapter-owned transport policy, duplicate request wrappers, and any Agent completion write. | Record create/update, status transition, outcome, and duration without actor, title, or Point identifiers. | One explicit action makes one authenticated write; owner/cross-owner/persistence cases pass and automatic Agent save or missing owner predicate fails. [integration] | AUTH-2 |
| USERS-2 | ListSavedRoutes and LoadRouteDetail form the owned read journey through the Neon reader, Users client, Catalog Point reader, and one map interface. | Migrate route detail and map callers; delete the Users list pass-through, duplicate route-detail homes, and direct feature access to competing map controllers. | Record load outcome, duration, count, map mount, and fallback without route or actor identifiers. | Owned, empty, not-found, error, map fallback, and coordinate-order browser cases pass; changing route selection, state projection, or coordinate order fails. [browser] | USERS-1, CATALOG-2, CATALOG-6 |
| USERS-3 | DeleteSavedRoute performs one owner-predicated atomic deletion through the Neon store. | Migrate the Contract handler and real caller; delete pass-through, pre-read/delete race, adapter-owned public errors, and duplicate tests. | Record deleted, rejected, missing, failure, and duration without identifiers. | Owner, cross-owner, missing, concurrent change, and database failure pass; removing the owner predicate or exposing a cross-owner oracle fails. [integration] | USERS-1 |
| WEB-1 | CompleteDeferredSave owns bounded PendingSave replay after authentication through browser storage, Neon session, and USERS-1 client adapters. | Migrate the save wall and auth callback after the final turn caller lands; delete claim Contract, endpoint, port, SQL, schema column, client calls, anonymous Users records, and claim tests. | Record none, saved, failed, or expired and duration without intent payload. | Anonymous click, login, new authenticated Save, clearing, expiry, and retry pass; sending a legacy route id, extending TTL, or restoring claim fails. [browser] | SAFE-1, TURN-4, AUTH-2, USERS-1 |
| RETENTION-1 | RemoveAutomatedRetention proves that no live staging behavior depends on the two inherited purge paths and makes absence the target seam. | Delete `workers/jobs`; Python purge scripts/settings; SessionRepository and AnonQuotaRepository purge SQL/methods; unit, integration, plan, step-summary, trigger, and workflow tests; both deprecated staging GHA fallbacks; staging `jobs_svc`, `AGENT_DATABASE_URL`, grants, package filters, Make/CI typecheck paths, deploy/secrets/meta-check/component mappings, and current staging Worker/Cron resources through IaC. Delete or archive superseded live runbooks/designs and update history-aware structure checkers. Preserve only SAFE-1's pinned production Jobs deploy/maintenance-rollback mappings, runtime credential, grants, and scheduled runtime. | Record only the staging IaC retirement outcome and exact removed resource identities; there is no recurring retention telemetry. | Source-structure and generated-config tests prove zero references across live staging source, workflows, configs, grants, secrets, and runbooks while immutable archived iteration records and SAFE-1's pinned production manifest/deploy/rollback/runtime configuration are the exact allowlist; staging has zero retention triggers or remotely executable fallback; Session and quota writes still pass. Expanding either exemption or reversing any staging absence assertion fails. [integration] | SAFE-1 |
| SESSION-1 | GetSessionHistory is the Agent-owned generated boundary over the current Session/Message adapter. | Migrate Web history and delete the Users Session list, raw Agent-table query, SessionSummary types, Contract surface, and pass-through tests. | Record history outcome, Message count, revision, and duration without actor or Message content. | Ordered/empty/missing/forbidden history and pagination pass through Agent while direct Users table access and restored SessionSummary exports fail. [api] | CONTRACT-1, TURN-4, AUTH-2 |
| SESSION-2 | AdoptSessions is the Agent-owned idempotent ownership command over the current repository. | Migrate the post-login Web/Edge transition; delete legacy adoption paths. It consumes only trusted anonymous and Neon identities, accepts no client Session ids, and invalidates admitted anonymous capabilities by revision CAS. | Record adoption count, no-op class, revision outcome, and duration without actor or Session identifiers. | Same-browser, cross-device no-op, replay, partial failure, concurrency, audit, and capability invalidation pass; accepting a client Session id or omitting the revision bump fails. [api] | TURN-4, AUTH-2, WEB-1, SESSION-1 |
| SESSION-3 | FinalSessionRepository implements create, load, commit, history, and adoption for the sole Session aggregate against the explicit fresh-schema manifest. | Migrate AgentTurn, GetSessionHistory, and AdoptSessions adapters in one staging cut; delete Conversation as a second root, duplicate transcript/state stores, local wire mirrors, legacy adoption SQL, and old tables. Preserve feedback and every other retained manifest surface; purge SQL already belongs to RETENTION-1. | Record revision/CAS outcome, turn correlation, history/adoption outcome, and cutover phase without actor or Message content. | Fresh-schema replay/concurrency, ordered Messages, history, adoption, retained quota/budget/audit/feedback/memory/ingest, SavedRoute create/read, Point/Bangumi read, and location/media behavior, private smoke, and workflow order pass; dropping a retained table, restoring automatic TTL, or reopening early fails. [integration] | SAFE-1, TURN-4, AUTH-2, WEB-1, RETENTION-1, SESSION-1, SESSION-2 |
| AGENT-3 | SubmitFeedback owns validation, optional Session ownership, persistence, and stable public errors through the final Session and feedback stores. | Migrate generated boundary and Web caller; delete route-owned orchestration, handwritten DTO, and duplicate error mapping. | Record rating class, ownership outcome, persistence outcome, and duration without text, actor, or Session identifier. | Owned, absent-Session, forbidden/missing collapse, validation, and persistence cases pass; bypassing ownership or leaking existence fails. [api] | CONTRACT-1, SESSION-3 |
| CATALOG-1 | ResolveBangumi executes exact-first title resolution through Neon aliases and the explicit upstream-ingest adapter. | Migrate its published route and Agent gateway capability; delete mixed transport/SQL/upstream orchestration, shadow DTO, and pass-through tests. | Record typed outcome, candidate count, source class, and duration without query text or upstream body. | Exact, alias, ambiguity, not-found, ingest, and upstream failure pass; weakening exact-first resolution fails. [integration] | SAFE-1 |
| CATALOG-2 | PointsByBangumi returns ordered published Points through one Neon read port. | Migrate guide/work-point callers and Agent gateway capability; delete raw row mapping outside the adapter, `work_id` wire vocabulary, shadow types, and wrappers. | Record outcome, count, and duration without title/query. | Ordering, missing Bangumi, empty, row validation, and the real Neon adapter pass; changing requested order or accepting invalid rows fails. [integration] | SAFE-1 |
| CATALOG-3 | NearbyPoints owns radius validation, distance ordering, and typed empty results through the PostGIS adapter. | Migrate Catalog and Agent callers; delete duplicate geo SQL/mapping and transport-owned policy. | Record radius bucket, count, outcome, and duration without coordinates. | Boundary radii, ordering, empty, and database failure pass; removing the radius bound or distance order fails. [integration] | SAFE-1 |
| CATALOG-4 | Geocode owns exact-before-fuzzy place resolution through gazetteer and external geocoder ports. | Migrate callers; delete handler-owned fallback sequencing, duplicate result DTOs, and transport tests of domain ordering. | Record source class, outcome, candidate count, and duration without place text. | Exact, fuzzy, ambiguity, no-result, timeout, and invalid row pass; fuzzy-before-exact or swallowed outage fails. [integration] | SAFE-1 |
| CATALOG-5 | GetBangumiOverview owns popular, search, and overview projection through narrow Catalog readers. | Migrate Web and public Contract callers; delete API-level row projection, duplicate overview/search types, and pass-through tests. | Record operation, outcome, count, cache class, and duration without query. | Popular/search/overview pagination, validation, empty, cache, and error cases pass; bypassing bounds or stale projection detection fails. [api] | CATALOG-1, CATALOG-2 |
| CATALOG-6 | PlanItinerary executes deterministic clustering, ordering, and timing through the Neon Point reader. | Router composes the use case directly; delete the pass-through route function, compatibility type re-exports, shadow Itinerary DTO, and duplicate route behavior tests. | Record outcome, Point/cluster counts, truncation, and duration without coordinates or titles. | Real adapter and published route pass; changing cluster cap, deterministic order, or timing rule fails. [integration] | CATALOG-2 |
| CATALOG-7 | IngestBangumi owns acquire, fetch, raw persistence, enrich, publish, completion, and negative-cache outcome through source, store, and publisher ports. | Migrate on-demand and scheduled callers; delete work vocabulary, orchestration hidden in adapters, duplicate state machines, and handler-level retry policy. | Record typed phase/outcome, source class, version, Point count, cache decision, and duration without raw payload. | Singleflight, empty cache, retryable upstream, atomic publish, crash recovery, and idempotency pass; breaking claim uniqueness, publish ordering, or negative-cache TTL fails. [integration] | CATALOG-1, CATALOG-2 |
| EDGE-1 | HandleGatewayRequest composes identity, protection, route selection, internal-identity construction, and forwarding in that order through Neon, anonymous, Turnstile, limiter, budget, Catalog/Users/Agent, and observer adapters. | The Worker entry delegates once; delete policy branches spread across app/auth/anonymous forwarding, old re-exports, runtime allowlists, raw bearer pass-through, and duplicated route vocabulary. | Record identity kind, guard decision, internal-boundary verdict, upstream class, status, and duration without token, trusted header, user identifier, or payload. | Authenticated, anonymous, public, invalid, limited, challenged, direct-Users, forged-header, upstream failure, and disconnect cases pass; forwarding before guards, preserving caller credentials, or restoring a retired path fails. [api] | TURN-4, AUTH-2, AGENT-1, AGENT-2, AGENT-3, USERS-1, USERS-2, USERS-3, SESSION-3, CATALOG-1, CATALOG-2, CATALOG-3, CATALOG-4, CATALOG-5, CATALOG-6 |

TURN-4, AUTH-2, and SESSION-3 are deliberate atomic hard cuts. TURN-2 and TURN-3 first move live admission and outcome behavior behind tested seams, so TURN-4 can switch all three command kinds, the Web caller, generated Contract boundary, SSE adapter, and legacy-path deletion without landing unused scaffolding. AUTH-2 deletes fallback only after real-issuer, QA-login, and internal-identity proof. Before SESSION-3, WEB-1 has removed cross-context SavedRoute claims and RETENTION-1 has removed the generic Jobs package plus every local and remote deletion trigger. SESSION-3 therefore resets the schema with no retired background mutator capable of waking against it. Its IaC state machine closes ingress, preserves Neon Auth, resets the application schema, applies the explicit retained manifest, deploys every consumer from one commit, runs private smokes, and reopens only on success.

**Campaign exit gate**

- Done when the fresh schema, API Contract inventory, browser journeys, source-structure checks, full monorepo gates, Codecov records, and every per-slice mutation record prove the final vocabulary and absence of retired surfaces. [integration]

## Testing Decisions

### Verification Plan

1. The highest product seam is AgentTurn.execute. Complete-turn behavior is tested there with deterministic ports, controlled time, controlled identity, scripted model outcomes, and a recording event sink.
2. TurnAdmission is tested independently only for the work that must happen before a stream begins: trusted identity mapping, transactional turn and quota reservation, ownership, expected revision, concurrency, and BYOK admission. Tests prove only the durable winner receives a capability, consume AUTH-1's generated policy values, and do not duplicate turn lifecycle assertions.
3. Characterization tests capture externally visible behavior before movement. When the new seam proves the same behavior, internal patch-based tests are deleted in the same slice.
4. Every slice includes a mutation probe that changes a meaningful rule and proves the replacement suite fails. Line coverage alone cannot approve a refactor.
5. TurnOutcome tests independently control dispatch phase, cancellation, process loss, lease expiry, and quota settlement. They prove startup and next-admission reconciliation, bounded indexed batches, concurrent lease claims, and conservative uncertainty without invoking a real model. HTTP, SSE, and browser tests then verify parsing, pre-stream error mapping, event/frame serialization, cancellation propagation, and disconnect behavior without repeating the state machine.
6. Production adapters have focused integration tests for Neon transactions, Catalog protocol, PydanticAI behavior, generated Contract models, and Edge forwarding.
7. CONTRACT-1 inventory and drift gates reject omitted retained paths, unsupported generation constructs, stale health/service metadata, and dual exports. Each later Agent capability card extends generation only while migrating its live boundary and deleting the corresponding handwritten mirror.
8. Auth tests use the IaC-derived real staging issuer and successor local-login command; they cover valid Neon claims, invalid and former Supabase claims, anonymous policy, removed GoTrue fixtures, Authorization-channel sk_* rejection, BYOK separation and redaction, caller-header stripping, direct Users rejection, service-binding identity, guarded egress, and fail-closed configuration.
9. Session tests first cover Agent-owned history and ownership transition against the current adapter, then start the final cut from the explicit fresh-schema manifest. They cover new/resumed Sessions, published revisions and Session offers, replay/concurrency, ordered Messages, adoption idempotency and admitted-capability invalidation, cross-device no-op, partial failure, retained quota/budget/audit/feedback/memory/ingest behavior, ordinary-runtime preservation, and final absence of obsolete tables and columns.
10. Users tests prove explicit authenticated Save behavior and the absence of anonymous database records, claim APIs, Session projections, and cross-context table access.
11. Catalog, Users, Web, and Edge use application-seam tests as their primary proof, with real adapter or browser tests only where the external boundary adds behavior. Automated retention is proved by source, configuration, privilege, and remote-resource absence rather than replacement behavior tests.
12. A cutover contract test proves staging ingress remains closed and retired retention triggers remain absent across reset and coordinated deployment failures. A production-promotion contract test proves every campaign revision is rejected at both automatic and manual entry points while the complete immutable pre-campaign manifest remains deployable.
13. The full repository gates run before and after each slice. Every pull request reaches Codecov patch coverage of at least 95%, coverage floors only ratchet upward, and no skip, suppression, warning allowance, or timing-dependent assertion is introduced.

### Prior Art

- Catalog's PlanItinerary use case already demonstrates the desired narrow port, real adapter, and fake-port testing shape.
- Agent characterization and mutation tests already exist for public error responses and policy boundaries. Before TURN-4 is ticketed, its behavior manifest must name the existing translation, injection, output-validation, and current-turn-provenance eval cases; a missing baseline blocks rather than being invented after the cut.
- Edge policy tests already exercise pure routing and protection rules and can be lifted to the composed request seam.
- Existing Playwright chat and save journeys provide browser-level assertions that can be re-homed around the single published contract.

## Out of Scope

### Non-Goals

- New Agent tools, prompts, recommendation algorithms, models, or product capabilities.
- A visual redesign or new map product.
- A new event bus, workflow engine, generic repository framework, or abstract clean-architecture toolkit.
- Preserving internal or staging-only endpoints, type aliases, table aliases, dual issuers, dual reads, dual writes, or compatibility wrappers.
- Production auth activation, production user migration, production data transformation, production Session TTL, account-deletion lifecycle, backup expiry, or removal of production Supabase resources; those require a separate pre-production plan and owner gate. Every campaign revision remains technically ineligible for production, which stays on the immutable pre-campaign manifest including Jobs.
- The monorepo CI/CD redesign. Its already chosen successor target is one ci.yml and one cd.yml, with CI building and testing once and CD promoting the same immutable artifacts. That work begins only after the code-level campaign is specified and underway.
- Bulk deletion of historical branches, clones, or worktrees. Repository cleanup is a separate ticket with its own salvage audit.

## Further Notes

### Dependencies

The `needs` column in Task Breakdown is the authoritative card-level dependency graph and must be copied verbatim into each ticket's `needs` file. The blocking critical path is:

SAFE-1 is the mandatory root gate: no implementation card may merge until SAFE-1 is green on main. From there, `CONTRACT-1 → AUTH-1`; `TURN-1 + AUTH-1 → TURN-2 → TURN-3 → TURN-4`; and `AUTH-1 → AUTH-2`. Those branches join at `TURN-4 + AUTH-2 → USERS-1 → WEB-1 → SESSION-2`, while `SAFE-1 → RETENTION-1`; the final join is `SESSION-1 + SESSION-2 + RETENTION-1 → SESSION-3 → AGENT-3 → EDGE-1`.

Catalog work is intentionally parallel: CATALOG-1 through CATALOG-4 may start independently; CATALOG-5, CATALOG-6, and CATALOG-7 then follow their row-level edges. USERS-2 waits for the exact Catalog read/planning capabilities it renders. AGENT-1 waits for the exact resolve/nearby capabilities it calls. No downstream card may merge until every listed dependency has green gate evidence on main.

A dependent ticket may start exploratory work in parallel, but it cannot merge until its blocking edge has green evidence on main.

### Risks

| Risk | Required control |
|---|---|
| A broad campaign creates another empty architecture layer | No slice merges without behavior, a real local/staging runtime adapter, caller migration, and deletion |
| Hard auth cut locks out staging | IaC-derived real staging issuer/JWKS, declarative QA identity, successor local login, and a real-token Edge smoke before fallback deletion |
| A campaign revision reaches production before its migration plan | Both production entry points resolve only the complete immutable pre-campaign manifest and reject all caller refs/campaign revisions before mutation |
| Retry, crash, or concurrency duplicates model spend or Messages | One transactional turn/quota winner, durable lifecycle lease, conservative uncertain-call settlement, and Session revision compare-and-set |
| An abandoned turn blocks the next observable request or quota decision | A bounded indexed sweep runs on startup and before every admission, before policy/quota/budget reads; concurrent claims and exactly-once settlement are tested |
| Event ordering changes user-visible streaming | Internal terminal invariant plus writable-sink SSE mapping tests |
| Session collapse loses or duplicates Messages | Fresh-schema aggregate tests, turn idempotency, ownership-transition idempotency, and transactional failure tests |
| Generated Python becomes a second hand-edited source | Deterministic generation and clean-tree drift gate |
| Old tests remain coupled to deleted internals | Replace-not-layer rule and mutation proof per slice |
| Historical branches are mistaken for missing implementation | Use the workspace baseline and target-tree audit; never bulk cherry-pick or delete |
| No-compatibility schema work exposes mixed versions | IaC closes ingress and schedules, deploys one commit against a reset application schema, smokes privately, and fails closed |
| A retired remote Cron or manual fallback continues deleting after source removal | IaC adopts and removes staging retention resources, deletes every executable fallback, verifies zero triggers, and blocks schema reset until absence is proven |
| Code work quietly expands into deployment redesign | Keep CI/CD in its successor spec; include only SAFE-1 and the cutover IaC required by destructive code slices |

### Workspace, Branch, and Worktree Context

The detailed time-stamped snapshot is recorded in docs/iterations/deep-refactor-2026-08/WORKSPACE-BASELINE.md. At specification time:

| Folder | Branch / state | Rule |
|---|---|---|
| /Users/lumimamini/Documents/Seichijunrei-agent | main at 1bcd5906, clean, three commits behind fetched origin/main | Do not implement from this stale root |
| /Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/deep-refactor-spec | codex/deep-refactor-spec from b94c30ab; contains only this planning diff | Authoritative planning worktree |
| /Users/lumimamini/work/animichi | main at 1bcd5906, three commits behind, dirty with three workflow edits and one handoff | Preserve; never treat the whole checkout as source truth |
| /Users/lumimamini/work/animichi-wts | 35 clean campaign worktrees | Historical campaign evidence; no hidden deeper turn implementation |
| /Users/lumimamini/animichi-work | obsolete July clone at 02cd7fa0 with two clean worktrees | Preserve pending separate salvage review |
| /Users/lumimamini/Documents/Seichijunrei-agent-worktrees | empty, not registered | No authority |

Across the three clones there are 41 registered worktrees after creation of the planning worktree. The only campaign patch not represented in origin/main is the workflow-only fix/root-secrets-upload commit f72e779b; it is reserved for the later CI/CD campaign. Sixteen pre-rewrite branch families and two old-clone commits remain inconclusive salvage candidates, so this spec authorizes no branch or worktree deletion.

### Supersession and Follow-up

- This spec supersedes the shallow architecture direction in issues #829 and #432.
- It absorbs the code and staging portions of #312 and #230.
- It intentionally does not claim to complete the separate history UI product work in #526.
- It supersedes the per-package CI direction in #679 only through the recorded future target; the CI/CD implementation belongs to a successor spec.
- Owner-level seams are closed for the local/staging campaign: AgentTurn.execute with separate TurnAdmission owns a full turn, demand-driven recovery closes expired leases before the next observable request, and automated retention is removed without replacement. Production no-traffic liveness and production data lifecycle remain separate pre-production decisions.
