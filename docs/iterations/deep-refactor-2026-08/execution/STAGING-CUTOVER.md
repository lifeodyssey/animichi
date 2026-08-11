# Staging hard-cut playbook

Use this playbook only for `AUTH-2`, `RETENTION-1`, and `SESSION-3`. It coordinates their final
staging effects without creating a compatibility window. All actions are CI-driven infrastructure as
code. Local deploy commands and dashboard edits are prohibited.

## 1. Invariants

1. Production receives no checkout, migration, Pulumi update, secret update, deployment, rollback,
   or smoke from this cutover. SAFE-1 must already be merged and green.
2. Staging ingress closes before the first destructive or mixed-version action and reopens only after
   all final-schema consumers pass private smoke on one source revision.
3. Neon Auth schema and the exact staging Auth branch are preserved. Only application schema/data are
   disposable.
4. Old retention execution is made incapable of database mutation before schema reset: schedules,
   manual fallbacks, credential/binding, grants, role, and Worker are removed and their absence is
   verified.
5. The final migration chain contains only the target shape. No upgrader, dual schema, alias, view,
   trigger, fallback reader, or legacy writer keeps mixed versions alive.
6. Failure leaves ingress closed. Recovery is fix, reset, redeploy, and re-smoke, not partial rollback
   into a mixed schema.
7. Every resource identity, binding, grant, secret **reference**, issuer, route, and gate is declared
   in Pulumi, Atlas, Wrangler config, or workflow code. Secret values stay in the declared private
   stores and never enter logs or artifacts.

## 2. Preconditions

The orchestrator may schedule the cutover only when all are true:

- SAFE-1 is on `main` and all three production entry-point mutation tests are green.
- The active card and every dependency are merged; the cutover source is one full commit SHA.
- The IaC preview names only staging resources and the expected application-schema operations.
- Pulumi state export has completed and its encrypted backup is in the private R2 path; it is not a
  public GitHub artifact.
- Current staging ingress, routes, Workers, Crons, service bindings, Secrets Store references, Neon
  branch/schema, roles/grants, and deployed SHAs have been inventoried without secret values.
- The final Contract inventory and fresh-schema retained-surface manifest are committed and tested.
- Every final-schema consumer has a build and private smoke command tied to the cutover SHA.
- A workflow-order contract test is red if ingress reopens early, retention remains executable, or
  any consumer deploys from a different revision.

If the remote inventory differs from IaC state, import/adopt the resource first in a reviewed change.
Never delete an unowned remote object merely because its name resembles the target.

## 3. Declarative state model

The cutover workflow records these public fields at every phase:

| Field | Allowed values |
|---|---|
| `source_revision` | one full campaign commit SHA |
| `ingress` | `open`, `closing`, `closed`, `opening` |
| `retention_execution` | `present`, `disabled`, `incapable`, `absent` |
| `auth_boundary` | `legacy`, `neon_proven`, `neon_only` |
| `application_schema` | `old`, `resetting`, `fresh_applied`, `verified` |
| `consumers` | per-component `pending`, `deployed`, `smoked` |
| `verdict` | `running`, `failed_closed`, `complete` |

The state contains component/resource names, hashes, counts, timestamps, and reason classes only. It
contains no token, cookie, DSN, user identity, Message, prompt, SavedRoute content, or provider key.

## 4. Phase A: prove Neon Auth before fallback deletion

AUTH-2 performs this phase before the final schema reset:

1. Pulumi derives the issuer and JWKS endpoint from the exact staging Neon branch and wires the
   reviewed values to Edge. No redacted placeholder or environment-agnostic URL is accepted.
2. IaC provisions the non-production QA identity/login path and its secret references.
3. The successor local-login/E2E path obtains a real Neon Auth browser session.
4. Through Edge, the real token reaches one authenticated Users request as an internal trusted
   identity. Direct Users bearer and caller-forged identity headers fail.
5. Tests prove exact issuer, audience, algorithm, expiry, and claim handling; former valid Supabase
   tokens fail at Edge.
6. Only after steps 1–5 are green does the same reviewed change delete Supabase verification,
   dual-issuer fallback, activation flag, GoTrue fixtures, old login command, and Users JWT verifier.

Completion criterion: `auth_boundary=neon_only`, a real staging login smoke is attached to the exact
deployed SHA, and no fallback or second verification path remains in source/config/runtime.

## 5. Phase B: retire all staging retention execution

RETENTION-1 completes this phase before SESSION-3 may reset schema:

1. IaC changes both staging Cron schedules to absent/disabled and applies that state.
2. A read-only remote check proves `maintenance-staging` has zero Cron triggers. Any differently named
   inherited trigger is an inventory failure and blocks progress.
3. Repository workflow/config changes remove both deprecated manual purge fallbacks and every other
   remotely executable trigger.
4. Remove the staging `AGENT_DATABASE_URL` upload/reference and Worker binding through its declared
   owners. No value is read or printed.
5. Atlas/Pulumi remove retention-only `jobs_svc` grants and role ownership in the dependency-safe
   order. A real role-capability check proves the former runtime cannot select/delete Session or quota
   data before schema mutation.
6. IaC deletes the staging Jobs Worker and associated deployment/component mapping.
7. Remote inventory proves the Worker, Crons, credential binding, role/grants, and manual execution
   path are absent. Source/config zero-match checks prove they cannot be recreated from campaign HEAD.

Removing only the source directory is not completion. Removing only schedules is not completion
because an already delivered event might still run. Revoking the database capability before reset
makes any stale execution incapable of mutation.

Completion criterion: `retention_execution=absent`, ordinary Session/quota writes still pass, the
SAFE-1 production pin is unchanged, and no replacement deletion behavior exists.

## 6. Phase C: close ingress

SESSION-3 owns the coordinated hard cut:

1. The workflow sets the IaC staging gate to closed and waits for the edge configuration to converge.
2. Public unauthenticated and gate-authorized probes prove external application traffic cannot reach
   Agent, Users, Catalog mutation paths, or the Web journey during the cut.
3. Private service identity for deployment smoke remains available through the declared CI path.
4. Re-read `retention_execution=absent` and `auth_boundary=neon_only`; do not trust an earlier job's
   success without a current remote check.

Completion criterion: `ingress=closed` is observed remotely before any application-schema reset job
can start. GitHub `needs` must encode this order.

## 7. Phase D: reset and converge the application schema

1. Export schema/object inventory for evidence, without exporting user/application row content.
2. Verify the reset target excludes the Neon Auth-owned schema and includes only declared
   application schema objects.
3. Reset the application schema through the reviewed migration/IaC workflow.
4. Apply the rewritten fresh Atlas chain from the cutover SHA and verify its digest/head.
5. Assert the retained-surface manifest exactly:
   Session, Message, SavedRoute, Point, Bangumi, Itinerary, durable turn, anonymous quota, daily
   usage, request audit, feedback, Agent memory, ingest, and required location/media support.
6. Assert absence of route/work/conversation-root/anonymous-claim/Supabase-auth/Animichi-API-key
   schema vocabulary and every retention-only object.
7. Run exact owner-role and privilege checks. No service acquires cross-context raw table access to
   compensate for a missing application seam.

Completion criterion: `application_schema=fresh_applied`; Atlas validation, object manifest, absence
checks, and role checks are green against the real staging branch.

## 8. Phase E: deploy one revision and private-smoke every consumer

Deploy all final-schema consumers from `source_revision`; do not reuse a mutable branch ref:

1. Contract/generated boundary artifacts and migrations.
2. Catalog and its required infrastructure.
3. Users and its internal Edge identity boundary.
4. Agent container/Worker and startup lease reconciliation.
5. Web.
6. Edge routes/forwarding last, while public ingress remains closed.

The exact dependency order comes from tested workflow `needs`, not this prose. Each deploy verifies
the checkout SHA before build/apply and reports the same SHA in health metadata.

Private smoke must cover at least:

- real Neon Auth login and one authenticated Users request through Edge;
- anonymous public matrix and rejection of forbidden/`sk_*`/former Supabase channels;
- initial chat, continued chat, Point/Candidate selection, replay/conflict, cancellation, and SSE
  terminal behavior;
- Session history and same-browser adoption with revision invalidation;
- explicit SavedRoute create/read/update/delete and deferred Save after login;
- retained Catalog Point/Bangumi/Itinerary, ingest, geocode, and nearby behavior;
- quota, daily budget, usage, request audit, feedback, Agent memory, and location/media support;
- source/config/remote absence of Jobs and retention triggers.

Completion criterion: every component is `smoked`, every `/healthz` commit equals
`source_revision`, and no smoke required a legacy path or manual configuration.

## 9. Phase F: reopen or fail closed

Reopen only if all earlier completion criteria are true in the same workflow execution:

1. IaC changes staging ingress from closed to open.
2. Public smoke repeats the smallest critical browser/API journeys.
3. Remote inventory rechecks that retention remains absent after the final deployment.
4. Record `verdict=complete` with the source SHA and evidence links.

On any failure:

- set `verdict=failed_closed` and keep ingress closed;
- do not restore old binaries against the fresh schema;
- do not re-enable retention, Supabase fallback, old endpoints, or compatibility views;
- diagnose and fix source/IaC, then rerun reset-and-redeploy from the beginning of the required phase;
- if a permission or credential is missing, stop after three bounded attempts and request only that
  external intervention.

## 10. Evidence and review

The cutover PR/workflow evidence includes:

- Pulumi preview/apply resource names and private state-backup confirmation;
- before/after staging inventory with zero secret values;
- ingress closed/open probes and timestamps;
- exact Auth issuer class and real-login verdict, never token/claims;
- zero retention Worker/Cron/binding/role/grant/manual trigger evidence;
- Atlas source SHA, target/digest, retained/absent object reports, and role-capability checks;
- every deployed component's reported commit and private/public smoke result;
- workflow-order mutation proving early reopen and retained execution become red;
- independent reviewer approval and Codex Sol `xhigh` adversarial verdict.

The orchestrator reviews the IaC diff and remote plan before apply. No local operator command may
substitute for a missing declarative resource, and no production environment approval is requested
or consumed by this staging cutover.
