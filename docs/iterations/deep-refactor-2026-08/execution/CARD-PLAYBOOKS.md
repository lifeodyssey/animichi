# Card playbooks

This file adds execution order to each Spec row. It does not duplicate the acceptance contract.
Before dispatch, copy the exact row and `needs` into the card brief, then add the red test, cut,
deletion, and proof below. Each card is one worktree and one PR.

## Wave 1: foundations after SAFE-1

### CONTRACT-1 · [#938](https://github.com/lifeodyssey/animichi/issues/938)

- **Red:** inventory every retained Agent path and prove two model generations are byte-identical;
  add failures for a missing health field/path and one unsupported schema construct.
- **Cut:** make Contract generate only health/service-metadata Python boundary models now; keep future
  Agent capabilities as inventory entries until their caller-migration card.
- **Delete:** handwritten health DTOs, legacy runtime metadata, and their parity-by-hand tests.
- **Proof:** Edge plus deploy smokes consume Contract; generated output is checked in and clean-tree
  regeneration is green; a local wire mirror or omitted path makes the drift gate red.

### TURN-1 · [#939](https://github.com/lifeodyssey/animichi/issues/939)

- **Red:** script success, dependency failure, usage, cancellation, and stale-provenance cases around
  the current PydanticAI call and emitted frames.
- **Cut:** introduce `ModelTurnPort` and framework-neutral `TurnEventSink`; production adapters wrap
  PydanticAI and AI SDK frame mapping, and the current live caller uses them immediately.
- **Delete:** application/route imports of PydanticAI result and callback types.
- **Proof:** remove current-turn provenance isolation and observe red; cancellation remains a raised
  cancellation, not a business error or successful result.

### RETENTION-1 · [#940](https://github.com/lifeodyssey/animichi/issues/940)

- **Red:** inventory local references, generated config, GitHub triggers, roles/grants/secrets, and
  live staging Worker/Cron identities; write exact-allowlist absence assertions before deleting.
- **Cut:** retire staging resources through IaC, verify zero scheduled or manual executor remains,
  then remove the generic retention package without replacement.
- **Delete:** `workers/jobs`; both Python purge paths/settings; repository purge SQL/methods; tests;
  staging GHA fallbacks; package/Make/CI/deploy/meta-check routing; staging role, credential, grants,
  bindings, runbooks, Worker, and Crons.
- **Proof:** only immutable history and SAFE-1's production pin may mention the retired surface;
  ordinary Session/quota writes still pass; adding TTL, soft delete, replacement scheduling, or any
  staging trigger makes the suite red. Follow [staging cutover](./STAGING-CUTOVER.md).

### CATALOG-1 · [#941](https://github.com/lifeodyssey/animichi/issues/941)

- **Red:** characterize exact title, alias, ambiguity, not-found, upstream ingest, and upstream
  failure through the published route and real Neon adapter.
- **Cut:** `ResolveBangumi` owns exact-before-upstream sequencing through alias and ingest ports;
  migrate its route and Agent gateway capability.
- **Delete:** mixed handler/SQL/upstream orchestration, shadow DTOs, and pass-through tests.
- **Proof:** weakening exact-first resolution or swallowing upstream failure makes the replacement
  integration suite red.

### CATALOG-2 · [#942](https://github.com/lifeodyssey/animichi/issues/942)

- **Red:** pin requested ordering, missing Bangumi, empty result, and invalid Neon row behavior.
- **Cut:** `PointsByBangumi` owns ordered published Points through one Neon read port; migrate guide,
  work-point, and Agent gateway callers.
- **Delete:** row mapping outside the adapter, `work_id` wire vocabulary, shadow Point types, wrappers,
  and structure tests.
- **Proof:** reverse requested ordering or accept one invalid row and observe red in the real-adapter
  suite.

### CATALOG-3 · [#943](https://github.com/lifeodyssey/animichi/issues/943)

- **Red:** capture lower/upper radius boundaries, deterministic distance ordering, empty results, and
  database failure through real PostGIS behavior.
- **Cut:** `NearbyPoints` owns radius policy, distance order, and typed empty results; migrate Catalog
  and Agent callers.
- **Delete:** duplicate geo SQL/mapping and transport-owned radius policy.
- **Proof:** remove the radius bound or distance order and observe red without asserting SQL text.

### CATALOG-4 · [#944](https://github.com/lifeodyssey/animichi/issues/944)

- **Red:** capture exact, fuzzy, ambiguity, no-result, timeout, and invalid gazetteer row outcomes.
- **Cut:** `Geocode` owns exact-before-fuzzy sequencing through gazetteer and external-geocoder ports;
  migrate every live caller.
- **Delete:** handler fallback sequencing, duplicate result DTOs, and transport tests that encode the
  domain order.
- **Proof:** fuzzy-before-exact or swallowed outage makes the seam test red.

## Wave 2: identity policy and Catalog completion

### AUTH-1 · [#945](https://github.com/lifeodyssey/animichi/issues/945)

- **Red:** enumerate every Contract policy cell and numeric limit at Edge and admission consumers;
  characterize `sk_*` acceptance and BYOK as separate channels.
- **Cut:** publish one generated IdentityPolicy for public, anonymous, and authenticated traffic.
- **Delete:** `agent` identity class; API-key mint, verify, persistence, `api_keys` table/grants,
  secrets, tests, docs, and every `sk_*` path. Keep BYOK only as opaque payer input.
- **Proof:** all matrix cells and 20/60s, 20 turns/day, USD 5/day values are consumer-tested;
  accepting `sk_*`, anonymous BYOK, a restored table, or divergent hardcoded value makes red.

### CATALOG-5 · [#946](https://github.com/lifeodyssey/animichi/issues/946)

- **Red:** characterize popular/search/overview pagination, validation, empty, cache, and error cases.
- **Cut:** `GetBangumiOverview` owns the three read projections through narrow Catalog readers;
  migrate Web and public Contract callers.
- **Delete:** API-level row projection, duplicate overview/search types, and pass-through tests.
- **Proof:** bypass a bound or make projection drift invisible and observe red.

### CATALOG-6 · [#947](https://github.com/lifeodyssey/animichi/issues/947)

- **Red:** preserve PlanItinerary clustering cap, deterministic order, timing, truncation, published
  route behavior, and real Neon Point adapter.
- **Cut:** route composition calls `PlanItinerary` directly; keep this existing deep seam as the
  reference pattern for the campaign.
- **Delete:** pass-through route function, compatibility type re-exports, shadow Itinerary DTO, and
  duplicate route behavior tests.
- **Proof:** change cluster cap, deterministic order, or timing rule and observe red at the seam.

### CATALOG-7 · [#948](https://github.com/lifeodyssey/animichi/issues/948)

- **Red:** characterize singleflight, negative cache, retryable upstream, atomic publish, crash
  recovery, and idempotent replay.
- **Cut:** `IngestBangumi` owns acquire through completion via source, store, and publisher ports;
  migrate on-demand and scheduled callers.
- **Delete:** work vocabulary, orchestration hidden in adapters, duplicate state machines, and
  handler-level retry policy.
- **Proof:** break claim uniqueness, publish ordering, or negative-cache TTL and observe red.

## Waves 3–5: turn, auth, Agent, and Users slices

### TURN-2 · [#949](https://github.com/lifeodyssey/animichi/issues/949)

- **Red:** drive initial/continued admission, ownership collapse, quota, BYOK, stale revision, digest
  mismatch, completed replay, and concurrent winner against real repositories.
- **Cut:** `TurnAdmission` performs identity-to-payer mapping and one transactional turn/quota
  reservation before every current text/selection caller.
- **Delete:** route/runner admission, quota, concurrency, ownership, and BYOK ordering branches.
- **Proof:** removing durable uniqueness or consuming a hardcoded policy value makes red; only the
  winner receives one single-use admitted capability.

### AUTH-2 · [#950](https://github.com/lifeodyssey/animichi/issues/950)

- **Red:** first prove a real staging Neon login, exact issuer/audience/algorithm verification, Edge
  acceptance, internal Users identity, and rejection of former Supabase tokens/forged headers.
- **Cut:** IaC derives issuer/JWKS from the exact staging branch and provisions QA login; Web owns the
  Neon session seam; Edge verifies once and forwards trusted service-binding identity.
- **Delete:** Supabase verification, dual-issuer fallback, activation flag, GoTrue fixtures, old login
  commands, and Users browser-JWT verifier only after the real-token smoke is green.
- **Proof:** unmocked browser login plus authenticated Users request passes; direct Users bearer,
  caller identity headers, or weaker verification makes red. Follow [staging cutover](./STAGING-CUTOVER.md).

### TURN-3 · [#951](https://github.com/lifeodyssey/animichi/issues/951)

- **Red:** kill execution after reservation and after provider dispatch; control lease expiry,
  concurrent claims, provider certainty, persistence failure, and cancellation phase.
- **Cut:** `TurnOutcome` owns reserved/running/terminal transitions, exactly-once settlement, and the
  bounded indexed sweep at Agent startup and before admission/policy/quota/budget reads.
- **Delete:** route/runner settlement, terminal audit, and recovery branches. Add no scheduler.
- **Proof:** removing lease claim, pre-admission ordering, certainty branch, bounded batch, or
  settlement idempotency makes red; an uncertain provider call is never replayed.

### AGENT-1 · [#952](https://github.com/lifeodyssey/animichi/issues/952)

- **Red:** characterize anonymous/member photo search, malformed image, quota, guarded egress,
  candidate confirmation, cleanup, and usage.
- **Cut:** `SearchPhoto` and `ConfirmPhotoOffer` own a separate sessionless offer namespace through
  vision and Catalog adapters; extend generated FastAPI boundaries in this card.
- **Delete:** route-local DTOs/orchestration and duplicate transport tests.
- **Proof:** bypass quota, accept the wrong offer, or treat it as a Session offer and observe red.

### AGENT-2 · [#953](https://github.com/lifeodyssey/animichi/issues/953)

- **Red:** characterize authenticated probe, anonymous rejection, SSRF, timeout, response cap,
  redaction, and cleanup.
- **Cut:** `ProbeModelCredential` performs one bounded capability probe through guarded egress and
  the generated boundary; migrate the Web BYOK caller.
- **Delete:** handwritten probe/error mirrors and duplicated route ordering.
- **Proof:** allow anonymous use, secret tracing, arbitrary base URL, or unbounded response and
  observe red.

### USERS-1 · [#954](https://github.com/lifeodyssey/animichi/issues/954)

- **Red:** characterize explicit create/update, owner/cross-owner, state transition, saved-at policy,
  and persistence failure without transport objects.
- **Cut:** `SaveSavedRoute` owns authorization and persistence through Neon; migrate Contract handler
  and Web Save action.
- **Delete:** pass-through handlers, adapter-owned public policy, duplicate wrappers, and any Agent
  completion write.
- **Proof:** one explicit action makes one authenticated write; missing owner predicate or automatic
  save makes red.

### TURN-4 · [#955](https://github.com/lifeodyssey/animichi/issues/955)

- **Red:** name and run the existing translation, injection, output-validation, and current-turn
  provenance eval baselines before structural change; add all three command and SSE behavior cases.
- **Cut:** `AgentTurn` owns Text, PointSelection, and CandidateSelection through Session, Catalog,
  ModelTurnPort, TurnOutcome, and one SSE adapter; extend generated `/v1/chat` Contract models.
- **Delete:** RuntimeAPI lifecycle orchestration, shallow HandleUserMessage, legacy runtime endpoints,
  old request modes, selection bypasses, handwritten turn DTOs, and internal-patching tests.
- **Proof:** initial/continued turns, replay/conflict, stale/invalid offers, persistence, event order,
  disconnect, browser, and evals pass; removing CAS or selection-oracle collapse makes red.

### USERS-2 · [#956](https://github.com/lifeodyssey/animichi/issues/956)

- **Red:** characterize owned/empty/not-found/error route list/detail plus map fallback and coordinate
  order in one browser journey.
- **Cut:** `ListSavedRoutes` and `LoadRouteDetail` own the read journey through Users, Catalog Points,
  and one map interface.
- **Delete:** Users list pass-through, duplicate route-detail homes, and competing map controllers.
- **Proof:** change route selection, state projection, or coordinate order and observe browser red.

### USERS-3 · [#957](https://github.com/lifeodyssey/animichi/issues/957)

- **Red:** characterize owner, cross-owner, missing, concurrent change, and database failure.
- **Cut:** `DeleteSavedRoute` performs one owner-predicated atomic Neon deletion.
- **Delete:** pre-read/delete race, pass-through handler, adapter-owned public errors, duplicate tests.
- **Proof:** remove owner predicate or reveal a cross-owner existence oracle and observe red.

## Waves 6–10: browser/session cut and final gateway

### WEB-1 · [#958](https://github.com/lifeodyssey/animichi/issues/958)

- **Red:** characterize anonymous Save click, login, authenticated replay, clear, expiry, failure,
  retry, plus final chat/selection/cancellation browser behavior.
- **Cut:** `CompleteDeferredSave` stores only bounded browser intent and creates a new authenticated
  SavedRoute after login.
- **Delete:** claim Contract/endpoint/port/SQL/column/client, anonymous Users records, claim tests, and
  duplicate chat/save feature homes.
- **Proof:** sending a legacy route ID, extending intent lifetime, or restoring claim makes red.

### SESSION-1 · [#959](https://github.com/lifeodyssey/animichi/issues/959)

- **Red:** characterize ordered, empty, missing/forbidden collapse, revision, and pagination through
  the current Session/Message adapter.
- **Cut:** `GetSessionHistory` becomes the Agent-owned generated boundary and Web history caller.
- **Delete:** Users Session list, raw Agent-table query, SessionSummary Contract/types, and
  pass-through tests.
- **Proof:** direct Users table access or restored SessionSummary export makes the structure/API gate
  red.

### SESSION-2 · [#960](https://github.com/lifeodyssey/animichi/issues/960)

- **Red:** cover same-browser adoption, cross-device no-op, replay, partial failure, concurrency,
  audit, revision, and admitted-capability invalidation.
- **Cut:** `AdoptSessions` consumes only trusted anonymous and Neon identities and atomically rebinds
  the current browser's Sessions after login.
- **Delete:** legacy adoption paths and every client-supplied Session-ID input.
- **Proof:** accepting a Session ID, omitting revision CAS, or leaving one anonymous capability valid
  makes red.

### SESSION-3 · [#961](https://github.com/lifeodyssey/animichi/issues/961)

- **Red:** seal the retained-schema manifest and exercise every retained adapter before reset; add
  workflow-order failure cases with staging ingress closed.
- **Cut:** `FinalSessionRepository` owns create/load/commit/history/adoption for one Session aggregate;
  IaC preserves Neon Auth, resets application schema, applies fresh chain, deploys one commit, smokes,
  then reopens.
- **Delete:** Conversation as second root, duplicate transcript/state, local wire mirrors, legacy
  adoption SQL, and old tables. Preserve quota, budget, audit, feedback, memory, ingest, SavedRoute,
  Catalog, and location/media surfaces.
- **Proof:** replay/concurrency, ordered Messages, history/adoption, every retained adapter, private
  smoke, and failure-closed workflow pass; restore TTL, drop a retained table, or reopen early and
  observe red. Follow [staging cutover](./STAGING-CUTOVER.md).

### AGENT-3 · [#962](https://github.com/lifeodyssey/animichi/issues/962)

- **Red:** characterize validation, optional owned/absent Session, forbidden/missing collapse,
  persistence failure, and stable public errors.
- **Cut:** `SubmitFeedback` owns the final Session/feedback-store interaction; migrate generated
  boundary and Web caller.
- **Delete:** route orchestration, handwritten DTO, and duplicate error mapping.
- **Proof:** bypass Session ownership or leak Session existence and observe red.

### EDGE-1 · [#963](https://github.com/lifeodyssey/animichi/issues/963)

- **Red:** cover authenticated, anonymous, identityless public, invalid, limited, challenged,
  direct-Users, forged-header, upstream failure, and disconnect requests.
- **Cut:** `HandleGatewayRequest` composes identity, protection, route selection, trusted internal
  identity, forwarding, and observation in that order; Worker entry delegates once.
- **Delete:** policy branches spread across app/auth/anonymous forwarding, old re-exports, runtime
  allowlists, raw bearer forwarding, and duplicate route vocabulary.
- **Proof:** forwarding before guards, preserving caller credentials, accepting forged identity, or
  restoring a retired route makes the API suite red. This is the final join and cannot merge until
  every listed dependency in `tickets.md` is green on `main`.
