# Animichi Production-Readiness Refactor

- Status: REVIEWED — owner waived the unavailable Fable seat; Codex adversarial review complete; owner signed off; tickets and the execution Goal are published
- Scope: repository-wide production-readiness target and remaining execution program
- Tracking: GitHub Issue #1004
- Existing execution inputs: repo close-out #904; persistence/PG18/UUIDv7 #992 and #993–#1003
- Authority: this spec supersedes the close-out campaign's execution order and definition of done plus the old refactor GOAL; it does not replace foundational architecture ADRs, accepted bounded-context decisions, or the accepted product rebuild specification

## Problem Statement

Animichi has made substantial progress toward its hybrid target architecture, but the repository still tells several partially overlapping stories about what “finished” means. Accepted clean-architecture designs, the repo close-out campaign, the ORM migration, the frontend rebuild, environment isolation, Catalog ingestion, and CI/CD hardening are spread across multiple specs and tickets. Some of those plans have landed, some are actively being implemented, and some describe targets that are not yet enforced by code or gates.

From the maintainer's perspective, this creates five practical problems:

1. A change can satisfy a local ticket while leaving a cross-service invariant incomplete, such as database ownership, API idempotency, environment isolation, or immutable promotion.
2. Important engineering rules exist as prose in several places, but not every deterministic rule is enforced before push or repeated in CI.
3. Runtime persistence, Catalog ingestion, staging data, and deployment artifacts still contain transitional or duplicated ownership boundaries.
4. Frontend accessibility and performance, API compatibility, idempotency, and rate limiting do not yet share one release-grade contract.
5. Obsolete packages, releases, tags, deployment descriptions, README material, and historical implementation surfaces can continue presenting a second architecture story after the code has moved on.

The owner wants the cleanest long-term design rather than the smallest patch. All confirmed work should be completed, but it must remain reviewable, testable, and safely parallelizable. The program therefore needs one authoritative target, explicit dependency boundaries, and machine-verifiable completion criteria without turning the repository into a policy framework for its own sake.

## Solution

Complete one production-readiness program that converges the repository on the accepted hybrid architecture and makes its boundaries executable.

The program preserves the accepted architecture and product specs, incorporates the already-running repo close-out and ORM tracks, and adds the missing cross-cutting contracts for Catalog data operations, staging isolation, frontend quality, API semantics, delivery review, and repository publication hygiene. It is delivered as dependency-aware tickets and small pull requests except where an existing owner-approved atomic cutover explicitly requires one coordinated pull request.

Every behavior is tested at the highest stable observable boundary. Deterministic rules run locally before push and repeat in CI. Semantic design judgment runs through a local read-only reviewer agent before a pull request is opened. Staging proves the deployed system; production receives the same immutable component revisions only after staging evidence and approval.

The finished repository has one current architecture story, one active execution goal, one owner for every table and contract, no unsupported compatibility layer, no hidden raw-SQL application path, no duplicated crawler, and no release/package surface that the product does not actually use.

## User Stories

1. As the owner, I want one authoritative production-readiness target, so that I can see what remains without reconciling several overlapping plans.
2. As the owner, I want every confirmed refactor completed, so that temporary architecture does not become permanent debt.
3. As a planner, I want existing accepted specs and tickets linked rather than duplicated, so that historical decisions and active work keep their identity.
4. As an executor, I want each ticket to have explicit dependencies and acceptance criteria, so that independent work can run in parallel safely.
5. As a reviewer, I want every acceptance criterion paired with a test type and evidence, so that completion is observable rather than asserted.
6. As a maintainer, I want domain, application, adapter, and composition boundaries enforced, so that infrastructure does not become the business model.
7. As a package consumer, I want each library package to expose one controlled public API, so that callers do not depend on internal paths.
8. As a service consumer, I want each deployable service to expose only its protocol contract, so that implementation modules remain private.
9. As a domain developer, I want untrusted input parsed at the boundary and typed values used internally, so that validation is not scattered through business logic.
10. As a maintainer, I want specific domain or adapter names instead of generic helper, utils, or common modules, so that ownership remains visible.
11. As a maintainer, I want composition preferred over inheritance, so that behavior is assembled explicitly.
12. As a persistence developer, I want a small shared persistence base for identity, version, timestamps, deletion, and audit metadata, so that mechanical fields are consistent without creating a behavior-heavy base class.
13. As a product operator, I want soft deletion to be the default for business entities, so that ordinary deletion remains recoverable and auditable.
14. As a privacy operator, I want retention-driven purge or anonymization to remain possible, so that soft deletion is not mistaken for permanent retention.
15. As a Python developer, I want Agent persistence implemented through SQLModel and SQLAlchemy 2 async sessions, so that mapping and transaction ownership are typed.
16. As a TypeScript developer, I want Catalog and Users persistence implemented through Drizzle query builders, so that table access is checked by the compiler.
17. As a database owner, I want Atlas to remain the only DDL and migration authority, so that ORM metadata cannot create a second schema history.
18. As a database owner, I want PostgreSQL 18 in Neon, local integration, and CI, so that UUID and extension behavior match production.
19. As a domain developer, I want every Animichi-owned persistent entity to use database-generated UUIDv7, so that identifiers are globally consistent and index-friendly.
20. As an upstream integrator, I want Bangumi, Anitabi, Auth, idempotency, and other provider or semantic identifiers to retain their native meaning, so that UUID standardization does not corrupt external contracts.
21. As a database reviewer, I want complete application and test SQL statements prohibited, so that ORM boundaries cannot silently regress.
22. As a database specialist, I want migrations and narrow typed dialect expressions to remain available, so that PostgreSQL-specific capabilities are not hidden behind unsafe abstractions.
23. As a test author, I want database fixtures written through ORM interfaces against real PostgreSQL, so that tests do not maintain a second persistence implementation.
24. As a performance reviewer, I want N+1 queries rejected and query counts bounded, so that apparently correct code cannot scale linearly by accident.
25. As a performance reviewer, I want keyset pagination and query-plan evidence for unbounded or high-volume access paths, so that SQL complexity is explicit.
26. As a security owner, I want one writer for each domain table and defense-in-depth row isolation for user data, so that cross-service access cannot bypass ownership.
27. As a production user, I want production identity and business data isolated from staging, so that testing cannot expose or mutate my information.
28. As an internal tester, I want a staging account that may use the same email spelling as production while remaining a separate environment-scoped identity, so that realistic testing does not join the environments.
29. As a QA operator, I want a dedicated synthetic staging Auth user and synthetic data, so that automated validation is deterministic.
30. As a security owner, I want staging Auth to use a closed roster with public signup disabled, so that direct Auth API access cannot bypass the WAF.
31. As an operator, I want WAF protection to remain the outer staging control, so that bots and network abuse are rejected before application work begins.
32. As a Catalog operator, I want only production to run the automatic upstream crawler, so that staging does not duplicate traffic or race the source of truth.
33. As a Catalog operator, I want production discovery to combine Bangumi seasonal, popular, and historical coverage with Anitabi point and original-image enrichment, so that coverage grows sustainably.
34. As an upstream provider, I want request, work, and runtime budgets with refresh tiers, so that Animichi does not crawl sources aggressively.
35. As a Catalog maintainer, I want provenance retained for each source-derived field and only the latest and previous raw payload retained, so that changes remain diagnosable without unlimited storage.
36. As a Catalog reader, I want only fully validated snapshots published atomically, so that partial ingest never becomes visible.
37. As an operator, I want the latest two Catalog snapshots retained behind a versioned manifest and atomic latest pointer, so that rollback remains simple.
38. As a staging tester, I want a daily catalog-only snapshot imported from production, so that staging uses realistic public data without production user data.
39. As a security owner, I want staging to receive snapshots through a private read-only service interface without production bucket credentials, so that staging cannot browse or mutate production storage.
40. As a Catalog developer, I want protected staging canary and full-ingest commands to use the same adapters as production, so that crawler changes can be tested without enabling a second schedule.
41. As an operator, I want Catalog run state, stale-snapshot detection, and repeated-failure alerts in existing observability systems, so that scheduled work is monitored without deploying a separate uptime product.
42. As a frontend developer, I want server state owned by TanStack Query, navigable state owned by the URL, and transient state owned by the nearest component, so that state is not duplicated.
43. As a frontend developer, I want reducers or state machines only for real feature lifecycles and feature-scoped Context only for stable deep capabilities, so that global stores do not become a default.
44. As a frontend developer, I want browser storage behind typed feature adapters, so that persistence does not leak into components.
45. As a user, I want WCAG 2.2 AA treated as a release requirement, so that core journeys remain usable with keyboard and assistive technology.
46. As a mobile user, I want Core Web Vitals to remain in the Good range at the 75th percentile, so that the product feels responsive on realistic devices.
47. As an API consumer, I want pre-production contracts to allow clean hard cuts, so that historical compatibility does not distort an unreleased API.
48. As an API consumer, I want the production `/v1` surface to remain backward compatible after go-live, so that clients are not broken silently.
49. As an internal service operator, I want service-binding contracts to support N and N-1 during rolling deployment, so that component promotion does not require synchronized downtime.
50. As a client developer, I want every retryable non-idempotent mutation to use one documented idempotency protocol, so that network retries cannot duplicate writes or charges.
51. As a chat user, I want one client turn to invoke the model and consume quota at most once, so that interrupted streams do not create duplicate answers or cost.
52. As an API client, I want reusing an idempotency key with a different request rejected explicitly, so that accidental key collisions are visible.
53. As a security operator, I want the edge to own distributed application rate limiting, so that per-process counters cannot be bypassed by another Worker instance.
54. As a public reader, I want coarse WAF/IP abuse controls separated from application identity limits, so that network defense and product policy remain understandable.
55. As a paid-resource operator, I want rate limits separated from daily quota and endpoint costs weighted, so that bursts and total spend are governed independently.
56. As an API client, I want rate-limit failures returned as typed `429` responses with retry guidance, so that retry behavior is predictable.
57. As a contributor, I want deterministic failures caught before push whenever practical, so that CI is confirmation rather than the first feedback loop.
58. As a contributor, I want pre-commit to remain fast and staged-file scoped, so that local safety does not make every commit expensive.
59. As a contributor, I want pre-push to run the complete locally reproducible gate set, so that type, architecture, contract, and test failures are found before remote CI.
60. As a CI owner, I want CI to repeat every trust-boundary gate and add container, browser, mutation, build, and cloud-only checks, so that local results are never trusted blindly.
61. As a reviewer, I want a local read-only reviewer agent to inspect Standards and Spec independently, so that semantic quality is checked before a pull request exists.
62. As a reviewer, I want mutation evidence for key assertions, so that tests are proven capable of failing when behavior is broken.
63. As an executor, I want every rejection returned to the implementation agent and reviewed again from the beginning, so that approval never applies to a stale diff.
64. As the owner, I want ambiguous product, security, and architecture judgments escalated to me, so that an agent does not invent policy.
65. As a merger, I want both GitHub review threads and top-level comments examined against a fresh head, so that automated findings cannot be missed.
66. As a deployer, I want staging and production to receive the same immutable component revision and artifact, so that production is not rebuilt from different inputs.
67. As a deployer, I want component-scoped manifests and promotion evidence, so that unchanged services are not redeployed unnecessarily.
68. As a deployer, I want migrations applied through expand, deploy, and contract phases after go-live, so that rolling versions remain compatible.
69. As a maintainer, I want obsolete code, compatibility layers, GitHub Packages, release workflows, deployment descriptions, and current docs deleted when their replacement is verified, so that the repository has one live story.
70. As an operator, I want Git tags available as explicit version backups without publishing GitHub Releases or public distribution artifacts, so that rollback markers do not create a fake distribution channel.
71. As a maintainer, I want a committed changelog derived from accepted pull requests and version tags, so that notable history remains readable without GitHub Releases.
72. As a maintainer, I want obsolete historical tags removed only after the rewrite backup is verified, so that cleanup does not destroy the last recoverable reference.
73. As a new contributor, I want README, repository metadata, deployment docs, package descriptions, and agent guidance to describe only the current system, so that onboarding starts from reality.
74. As an agent author, I want repository invariants, skills, role definitions, workflow, and ticket briefs to each own one kind of instruction, so that prompts do not drift through copy-paste.

## Implementation Decisions

### Decision registry

| ID | Durable decision |
|---|---|
| PR-01 | This specification is the single remaining-work program and completion authority. |
| PR-02 | Catalog owns Bangumi, Point, Itinerary, discovery, ingest, enrichment, and publication; Agent owns Session, messages, turns, and model orchestration; Users owns SavedRoute and accepted user commands; Edge owns identity enforcement, protection, and routing; Web owns presentation and browser state. |
| PR-03 | Catalog and Agent use full clean architecture where their domain complexity warrants it; Users remains a thin domain service; Edge remains a gateway; Web remains a UI application. Empty ceremonial layers are prohibited. |
| PR-04 | Atlas is the only schema authority; SQLModel/SQLAlchemy 2 and Drizzle are the runtime persistence mappings; PostgreSQL 18 and database-generated UUIDv7 are the owned-identity baseline. |
| PR-05 | Production and staging have isolated Auth and user data; only validated public Catalog snapshots cross from production to staging. |
| PR-06 | Production alone schedules upstream Catalog ingest; staging imports daily snapshots and runs crawler changes only through explicit protected canaries. |
| PR-07 | Public API stability begins at production go-live; retryable mutations use durable idempotency, and Edge owns distributed rate limiting distinct from quota. |
| PR-08 | WCAG 2.2 AA and Good Core Web Vitals are release criteria; frontend state has one owner according to its lifecycle. |
| PR-09 | Deterministic rules are automated locally and repeated in CI; semantic Standards and Spec judgment belongs to the local reviewer agent before PR creation. |
| PR-10 | Deployment builds each component artifact once and promotes the same digest from staging to production under approval. |
| PR-11 | Current documentation has one architecture story; superseded execution plans move to archive and obsolete code/package/release surfaces are deleted after verification. |
| PR-12 | Routine integration uses merge-based branch updates and repository-configured squash merge; force-push exists only inside an owner-authorized, frozen, backed-up history-rewrite window. |

### Program authority and delivery

- This specification is the umbrella target for all remaining production-readiness work. It links existing accepted execution tracks instead of reopening them.
- It supersedes the wave order, completion checkboxes, and current-status claims in the former repo close-out campaign and refactor GOAL. Still-open child tickets are reconciled into the new dependency graph rather than silently closed or duplicated.
- Existing owner-approved atomic cutovers retain their stated pull-request boundary. All other work is split into the smallest independently releasable tickets with explicit blocking edges.
- Independent tickets may run concurrently in isolated worktrees. Layout moves, schema-history rewrites, shared contracts, and final cutovers serialize where their write sets or rollout semantics conflict.
- No implementation ticket may silently broaden product scope. Newly discovered structural work becomes a separate ticket unless it is required to make the current acceptance criteria true.
- Production go-live is the stability boundary for public API compatibility and append-only business migrations.

### Architecture and code quality

- Dependency direction is domain → application → outbound/inbound ports and adapters → composition root. Domain and application code do not import framework, transport, ORM, or vendor implementations.
- Library packages expose one deliberate public export surface. Deployable services expose protocol contracts; internal modules are not cross-package APIs.
- Boundary data is parsed into named types. `Any`, unmodeled object dictionaries, deep imports, and suppression directives remain prohibited.
- The 1-10-50 discipline remains: one primary indentation level, functions no longer than 10 lines, classes no longer than 50 lines, and production files no longer than 300 lines. Tests remain bounded separately by the testing policy.
- Generic helper, utils, and common ownership is a design smell. Extraction requires a domain, application, policy, serializer, mapper, or adapter name that states why the code exists.
- Composition is the default. Inheritance is reserved for framework-required contracts and small persistence metadata mixins.
- A persistence base or precise mixins may provide UUID identity, optimistic version, created/updated/deleted timestamps, and audit metadata. They may not accumulate domain behavior.
- Soft delete is the default business deletion policy. Privacy, legal, or storage retention may trigger audited physical purge or anonymization.
- Each table is classified before migration as a soft-deleted business entity or an explicit exception. Join tables, leases, disposable ingest staging, immutable audit/events, and bounded operational logs use lifecycle semantics appropriate to their role instead of receiving ceremonial deletion columns.
- TDD is state- and behavior-oriented. DDD establishes vocabulary and ownership; SOLID guides dependency and cohesion; KISS and YAGNI reject speculative abstractions; design patterns require a recurring problem rather than aspirational architecture.
- N+1 access is prohibited. Collection use cases declare bounded query-count contracts. Large ordered feeds use keyset pagination. High-volume queries require representative PostgreSQL plan evidence and bounded complexity.

### Persistence, schema, and identity

- The already-approved persistence track remains authoritative for SQLModel/SQLAlchemy 2 in the Agent, Drizzle in TypeScript services, PostgreSQL 18, UUIDv7, Atlas migration ownership, and Supabase compatibility deletion.
- Complete runtime and test SQL statements are prohibited. Atlas-controlled migrations and narrow typed PostgreSQL expression adapters are the only sanctioned SQL surfaces.
- Typed expression adapters return expressions; they do not execute queries, accept unchecked fragments, or hide complete statements.
- Database-mapping parity is machine checked after applying Atlas to an empty PostgreSQL 18 instance: every mapped column used by SQLModel or Drizzle agrees on name, PostgreSQL type, nullability, identity/default, key relationships, and indexes. ORM metadata never becomes an alternative DDL source.
- Every Animichi-owned persistent entity uses a PostgreSQL UUID primary key with a native UUIDv7 default. Provider-owned identifiers, Auth subjects, idempotency keys, and semantic natural keys retain their native type.
- User-domain tables have one owning writer. Row-level database policy is defense in depth; authenticated application authorization and service boundaries remain primary.
- Schema history may be rebuilt only inside the already-approved pre-production rewrite window. After production go-live, migrations are append-only and use expand → deploy → contract.

### Environment and Auth isolation

- Production and staging use separate Auth environments, credentials, user identifiers, application data, object storage, and service configuration.
- Staging contains only synthetic users and synthetic user-domain data. The same normalized email may exist in both environments, but it represents two unrelated identities and is never used as a cross-environment join key.
- Staging Auth uses a closed roster. Public signup and unrestricted OAuth are disabled; automated and human test identities are provisioned explicitly through secret-backed operational workflows.
- WAF remains an outer access-control and abuse layer. Auth and API authorization remain correct when the Auth endpoint or API is called directly.
- Production user or session data is never cloned into staging. Public third-party-derived Catalog data is the only production dataset eligible for controlled synchronization.
- Pull requests do not create Neon branches. Real deployed integration and QA occur in staging after merge.

### Catalog data platform

- Production runs one automatic Catalog ingestion schedule, initially daily. Staging deploys the same worker code but has no automatic upstream crawler schedule.
- Discovery combines Bangumi current-season lists, popularity surfaces, and historical coverage. Anitabi supplies pilgrimage points, source mapping, and original images. Coverage grows gradually under explicit daily budgets.
- Refresh policy is tiered by volatility and value. Budgets cap works, upstream requests, and runtime; exhaustion records a partial run without publishing an invalid snapshot.
- Source provenance is retained per field or record. Raw upstream payload retention is bounded to the latest and previous versions needed for diagnosis.
- Ingest writes an isolated candidate dataset, validates quality and referential integrity, then atomically publishes a complete snapshot. Readers never observe half-published data.
- Object storage retains the latest two immutable catalog snapshots. A versioned manifest and atomic latest pointer identify the active snapshot and its predecessor.
- Snapshot contents are limited to public Catalog records, aliases, points, source maps, provenance, and original-image references or objects. Auth, users, sessions, operational locks, and private run logs are excluded.
- Staging imports the newest production Catalog snapshot once per day through a private, read-only production service interface. Staging receives neither production object-store credentials nor arbitrary production database access.
- Import loads temporary tables, validates manifest/schema/data, and swaps the active Catalog version in one PostgreSQL transaction.
- Staging supports explicit protected canary and full-ingest runs. Canary selection includes fixed regression works plus a rotating sample and exercises the same discovery, fetch, enrich, validate, and publish path as production.
- Worker schedules are declared with the Worker runtime configuration. Pulumi owns surrounding Cloudflare resources, bindings, storage, routes, secrets, and environment wiring.
- Monitoring uses run records, Cloudflare logs, and Logfire. Alert on repeated production failures, absence of a fresh production snapshot beyond 36 hours, and staging snapshot age beyond 48 hours. A separate Uptime Kuma deployment is not introduced.

### Frontend state, accessibility, and performance

- Remote server state is owned by TanStack Query. Shareable or navigable state is owned by the URL. Ephemeral interaction state stays with the nearest component.
- Complex feature lifecycles use a reducer or state machine. Stable deeply consumed capabilities may use feature-scoped Context. A generic global Redux/Zustand store requires a future ADR-backed offline, multi-window, or equivalent need.
- Query results are not copied into local state. Derived values are computed. Browser storage is accessed only through typed feature-owned adapters.
- WCAG 2.2 AA is a production release criterion. Stable automated checks cover semantic markup, accessible names, common contrast and ARIA failures, and critical keyboard paths; manual evidence covers focus order, screen-reader meaning, and interactions automation cannot judge.
- Core Web Vitals must meet Good thresholds at the 75th percentile: LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1.
- Controlled Lighthouse and bundle budgets block deterministic regressions. Field telemetry confirms real-user percentile performance after deployment; lab data is not misrepresented as field data.

### API compatibility, idempotency, and rate limiting

- Before production go-live, obsolete API paths and compatibility aliases are deleted through hard cuts. After go-live, `/v1` changes are additive and backward compatible; error codes and semantics are part of the contract.
- Breaking post-go-live changes require a new major path, a documented migration window, and explicit deprecation and sunset behavior.
- Internal service-binding contracts support the current and immediately previous deployed contract during rolling promotion.
- OpenAPI and shared-contract change classification distinguishes additive from breaking changes and blocks unapproved breaks.
- Every operation advertised by a generated OpenAPI document is mounted by the corresponding runtime router, and every mounted public operation is represented by the contract. Generated-contract drift and runtime-route parity are separate required checks.
- A pre-go-live operation that exists only in a contract is either implemented because its product scope is already accepted or removed from the active contract until that product work ships. Phantom APIs are not retained as placeholders.
- Native HTTP idempotency is preferred where resource semantics permit it. Every retryable non-idempotent mutation requires a client-generated `Idempotency-Key` under Animichi's documented contract.
- Idempotency scope includes authenticated principal or stable anonymous identity plus operation. The database stores the key, canonical request fingerprint, execution state, and result reference atomically with the mutation.
- Repeating the same key and fingerprint returns the committed result. Reusing a key with a different fingerprint returns a typed conflict. Concurrent duplicates receive an explicit retryable response and do not execute the effect twice.
- Chat uses a stable client turn identity: one turn creates at most one user message, model invocation, quota charge, and committed result. Interrupted streaming recovers committed conversation state rather than rerunning the model merely to replay bytes.
- Scheduled and ingestion jobs use stable run identifiers and database uniqueness rather than an HTTP header. External side effects that cannot share the transaction use an outbox or equivalent durable handoff.
- The edge is the sole distributed application-rate-limit authority. Service-local in-memory limiters are removed.
- WAF/IP controls handle coarse attacks. Application limits key authenticated users, stable anonymous identities, and service credentials separately and classify endpoints by cost.
- Rate limiting governs bursts; quota governs daily or billing-period consumption. BYOK may affect billing quota but never bypasses abuse protection.
- Rate-limit responses use typed `429` errors, `Retry-After`, and documented standard rate-limit fields. Expensive mutations fail closed if the limiter is unavailable; cacheable public reads may fail open with an alert.

### Local gates, CI, review, and deployment

- Mechanically decidable rules are automated. Semantic design questions are reviewer-owned. Measurable but judgment-dependent properties produce automated evidence for reviewer disposition.
- Pre-commit remains fast and staged-file scoped: formatting, lint, secret scanning, forbidden syntax/policy checks, and other deterministic checks that complete in seconds. Its changed-package router derives scope from the staged tracked diff, including additions, modifications, renames, and deletions; it does not rely only on commits already present in `HEAD`. Untracked content is not inspected before staging: pre-commit ignores untracked files until they are staged.
- Pre-push runs the complete locally reproducible static, type, architecture, contract, generated-artifact, unit, and affected integration gates. When a changed scope requires Docker-backed evidence, an unavailable local prerequisite fails with an actionable setup message rather than silently skipping the gate; CI still repeats the evidence authoritatively.
- CI repeats every trust-boundary gate and adds hermetic PostgreSQL containers, mutation testing, coverage, production builds, browser tests, IaC preview, and checks requiring controlled services.
- Every hard rule has a scope, owner, execution point, evidence artifact, and exception process. Hard-gate exceptions are centralized, owner-approved, time-bounded, and never implemented as inline suppression.
- The code-review skill defines the Standards and Spec review method. The reviewer agent owns execution, permissions, gate re-runs, mutation probes, finding severity, and the verdict artifact. Workflow owns stage ordering. Ticket briefs own only task-specific scope and acceptance criteria.
- The verdict artifact pins base and head revisions plus the brief/spec digest; reports Standards and Spec findings and status separately; maps acceptance criteria to tests; records gate and mutation evidence; and records reviewer identity and time. Both axes must pass, so an aggregate approval cannot hide a rejected axis.
- After implementation gates pass, the local reviewer independently reads the real diff and ticket brief. `REJECT` returns work to the implementation agent; any changed diff receives a complete new review. Only `APPROVE` permits commit, push, and pull-request creation.
- Ambiguous product, security, privacy, compatibility, or architecture decisions stop in a human state for owner judgment.
- Pull-request merge requires both unresolved line-thread triage and top-level comment triage, a recorded authorized judgment, all required checks, and a fresh head. The judgment is bound to pull request, head revision, and the reviewed findings snapshot and must be newer than the latest managed finding; an old acknowledgment cannot approve later feedback.
- Comment triage and fresh-head verification are repository required checks, not merely a local CLI hook, so the same rule applies to UI, API, automation, and agent merges.
- Deployment is CI/CD-only. Staging receives merged component revisions automatically; production promotes the exact same revision and artifact after staging evidence and environment approval.
- Component-scoped manifests identify source revision, schema compatibility, artifact digest, SBOM/attestation, configuration schema, and dependencies. Artifacts are built once and verified by digest in both environments; production does not rebuild a promoted component.
- Production eligibility is the SAFE-1 trust boundary: the eligibility gate resolves each component manifest from its pinned immutable GitHub blob — never from the working tree — and compares the candidate against staging evidence. The mutable checkout guard scripts that implement that resolution are the narrow, documented SAFE-1 exception.
- Browser bundles are environment-neutral. Environment-varying public configuration is injected or selected at runtime under a versioned schema rather than compiled into separate staging and production artifacts.
- CI/CD failure alerts use the existing GitHub, Cloudflare, and Logfire channels with deduplication and actionable component/revision context.

### Documentation, repository metadata, packages, and version history

- Current documentation describes only the live architecture and supported workflows. Historical rationale may remain in designated archives, but it cannot be linked as current guidance.
- Accepted 2026-08 bounded-context, language, package-shape, and IaC ownership decisions are retained in the decision registry or their governing ADR. Their stale inventories, path maps, wave plans, implementation status, old Auth trust model, retired Jobs runtime, and outdated CI prescriptions are historical rather than current requirements.
- Root agent guidance contains repository-wide invariants and routing only. Package guidance contains local rules. Skills contain reusable procedures. Agent definitions contain role permissions and outputs. Workflow documentation contains ordering. Ticket briefs contain dynamic scope.
- README, architecture, deployment, migration, testing, repository description, homepage links, workflow badges, and package metadata are reconciled with the final system in the same tickets that change their source of truth.
- Obsolete code, compatibility layers, generated deployment surfaces, package publication workflows, and stale docs are deleted after replacement verification. They are not retained behind fallback flags.
- The obsolete GitHub Package is deleted after proving no deployment consumes it. The repository does not publish a public distribution package or GitHub Release merely to represent an application deployment; private, immutable CI deployment artifacts and container images required by promotion remain part of the delivery pipeline.
- Version tags may be created intentionally as deployment/history backup markers. A committed changelog is derived from merged pull requests and version tags. Tag creation is not a deployment trigger.
- Legacy tags are removed only in the authorized history-cleanup window after bundle and private backup verification. The recoverable legacy reference follows the already-approved retention period.

## Testing Decisions

### Test philosophy and seams

- Tests assert externally observable state and protocol behavior, not private methods, ORM-generated SQL text, component implementation details, or executor claims.
- The highest stable seam is mandatory: public contract for API behavior; repository/application port over PostgreSQL for persistence; complete ingest-to-snapshot pipeline for Catalog; browser journey for frontend; Pulumi preview plus deployed smoke for infrastructure.
- Each acceptance criterion declares one primary test type — `unit`, `integration`, `eval`, `browser`, or `api` — and has a corresponding test present in the same pull-request diff. Lower-level tests are added only for algorithms, deterministic edge cases, or failure localization.
- Tests are written before behavior changes. They use controlled clocks, deterministic fixtures, no conditional assertions, no skips, and no retry-until-green.
- Mutation testing is the authoritative green-light proof: every changed key assertion is mutation-probed — deliberately breaking the behavior must make the relevant test fail (red) before the original implementation is restored (green).

### Required behavioral evidence

- `[unit]` Architecture rules reject forbidden dependency directions, deep imports, generic ownership buckets, suppressions, and mechanically measurable 1-10-50 violations.
- `[integration]` PostgreSQL 18 Testcontainers apply the complete Atlas history and exercise SQLModel/Drizzle repository contracts, transaction rollback, optimistic concurrency, UUIDv7 defaults, soft-delete filtering, and audit metadata.
- `[integration]` Schema-parity inspection proves Atlas, SQLModel, and Drizzle agree for every mapped table and catches UUID/text/serial or nullability drift before runtime.
- `[integration]` Query-count contracts demonstrate no N+1 behavior for collection use cases; representative large datasets produce bounded plans and keyset pagination behavior.
- `[integration]` Positive and negative role tests prove table ownership and user-row isolation through the same service credentials used by runtime adapters.
- `[integration]` Catalog fixtures drive discovery, refresh prioritization, source mapping, enrichment, quality validation, atomic publication, N/N-1 retention, manifest switching, and rollback without live upstream calls.
- `[integration]` Snapshot export proves that user/Auth/operational data is absent; staging import proves temporary-load validation and atomic activation.
- `[api]` Protected canary/full-ingest commands reject public and unauthorized callers and exercise the same pipeline as the production schedule.
- `[api]` Idempotency tests cover repeat-same-request, changed-payload conflict, concurrent duplicate, commit-before-response-loss, expiry policy, and downstream outbox handoff.
- `[eval]` Chat retry cases prove one turn, one model execution, one quota charge, and recovery after stream interruption.
- `[api]` Rate-limit tests cover burst, refill, identity separation, endpoint weights, encoded-path bypass attempts, BYOK behavior, and limiter failure modes.
- `[api]` Contract-diff tests classify additive and breaking public changes; internal compatibility tests exercise N and N-1 service contracts.
- `[api]` Generated OpenAPI operation sets and runtime router operation sets are equal, including the Users, check-in, and share surfaces, and edge forwarding reaches every advertised operation.
- `[browser]` Critical anonymous and authenticated journeys run axe checks, keyboard navigation, visible focus, dialog/focus restoration, and representative screen-reader assertions.
- `[browser]` Controlled mobile runs enforce LCP, INP, CLS, and bundle budgets; staging field telemetry is checked separately for 75th-percentile release evidence.
- `[integration]` Staging proves closed-roster Auth, synthetic identities, WAF outer control, no production user data, daily public Catalog import, manual crawler canary, and deployed component revisions.
- `[integration]` Pulumi previews and policy checks prove environment separation, no production credential binding in staging, schedule ownership, object-store permissions, and component manifest wiring.
- `[unit]` Documentation and repository checks reject broken current links, stale package/release references, duplicate source-of-truth claims, invalid agent pointers, and generated-artifact drift.
- `[unit]` Local-gate routing tests use temporary repositories to prove staged tracked additions, modifications, renames, deletions, and root-level changes select the intended packages, and that untracked files are ignored until staged.
- `[api]` Pull-request gate tests prove acknowledgments become stale after a new head revision or managed finding and that UI/API merge paths cannot bypass the required check.
- `[integration]` Promotion evidence proves staging and production use identical source revisions and artifacts and that production cannot proceed without staging success and approval.

### Gate placement

- Pre-commit runs only stable second-scale checks over staged or directly affected files.
- Pre-push runs all deterministic checks that can be reproduced locally and routes by changed package while preserving cross-package dependency gates.
- CI repeats pre-push checks from a clean checkout and owns containers, full mutation/coverage, browser, build, IaC, and controlled-environment evidence.
- Staging owns real Cloudflare, Neon, Auth, WAF, scheduled-job, and end-to-end QA evidence. Pull requests do not create disposable live environments.
- The local reviewer owns semantic cohesion, naming, KISS/YAGNI, pattern justification, threat-model completeness, migration rollout judgment, accessibility meaning, and plan interpretation. Automation supplies evidence where possible.

## Out of Scope

- New end-user product features unrelated to making the accepted architecture production-ready.
- Per-pull-request Neon branches, preview databases, or automatic staging destruction.
- Copying production Auth users, sessions, or user-domain data into staging.
- Running a second scheduled upstream crawler in staging.
- Deploying Uptime Kuma or another standalone monitoring product.
- Replacing Atlas with ORM-owned schema generation or migrations.
- Replacing provider-owned or semantic identifiers with UUIDs.
- Treating PostgreSQL RLS as a substitute for application authorization and service ownership.
- A generic global frontend store without a separately approved offline or multi-window requirement.
- Preserving unreleased API aliases, old runtime fallbacks, or dead code for hypothetical compatibility.
- Publishing GitHub Releases or public distribution packages as a prerequisite for application deployment. Private immutable deployment artifacts remain required by promotion.
- Triggering deployment from version tags.
- Local or agent-triggered deployment outside the existing CI/CD promotion path.
- Exhaustive historical-document rewriting; archives remain historical unless they are incorrectly presented as current.
- Automatically accepting semantic reviewer findings or security exceptions without owner judgment where policy is ambiguous.

## Further Notes

- Spec review record (2026-08-13, base `7c4cb6b63ce40c85f67ee2d8e50e97b60174f8b7`): the owner waived the unavailable Fable seat and requested Codex adversarial review, which completed with no unresolved design finding. The review resolved program-authority drift, phantom OpenAPI behavior, immutable-deployment versus public-package ambiguity, pre-push prerequisite skipping, stale PR acknowledgment bypass, ORM/schema parity evidence, and current Auth/Jobs/domain facts. The owner signed off; the #1004 tickets and the execution Goal are now published. No separate verdict artifact exists, so the fields it would hold — head SHA, brief/spec digest, mutation results, comment-surface triage, reviewer identity/time — are not recorded; this record links only evidence that exists.
- Repo close-out #904 is superseded as the program authority. Its still-open tickets remain valid inputs and are retained, revised, or superseded explicitly during `/to-tickets` reconciliation.
- Persistence umbrella #992 and child tickets #993–#1003 remain the authority for the active ORM/PG18/UUIDv7/Supabase-removal cutover. This spec adds cross-program invariants but does not duplicate those tickets.
- The implementation checkout for #992 contained uncommitted work when this spec was written. Planning work was isolated in a separate worktree and must not overwrite or absorb that implementation diff.
- Existing accepted clean-architecture, target-layout, CI/deploy, and frontend-rebuild specs remain design inputs. When their transitional wording conflicts with this specification's confirmed final-state decisions, this specification controls the remaining execution program and the current docs must be reconciled.
- The current runtime trust boundary is Edge-verified Neon Auth identity forwarded to Users; the superseded Users self-verification design is not revived.
- The former standalone Jobs Worker target has been retired by later retention decisions and is not recreated merely to satisfy an old structure document.
- Production-domain activation remains an explicit owner/HITL deployment step; repository configuration at specification time does not prove that the apex is live.
- The `Idempotency-Key` field is an Animichi API contract based on the established HTTPAPI pattern; its exact behavior is documented locally rather than depending on the IETF draft becoming a final RFC.
- Initial Catalog schedule and staleness values are operational defaults: daily production ingest, daily staging import, production stale after 36 hours, staging stale after 48 hours. Changes require measured evidence and an operations-document update, not a source-code magic number.
- Completion requires: every derived ticket closed or explicitly superseded; every existing linked track reconciled; all hard gates green; every acceptance criterion with a declared test type, a corresponding test in the same pull-request diff, and red/green mutation evidence as the authoritative green-light proof; local reviewer verdicts recorded; pull-request comment gates resolved; staging evidence complete; current docs and repository metadata truthful; and the final execution Goal fully checked.
