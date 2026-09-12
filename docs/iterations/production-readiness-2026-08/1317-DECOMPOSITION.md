# #1317 decomposition — deleting `apps/agent` is a migration campaign, not a deletion card

> **Issues filed 2026-09-12.** Every card below exists on the tracker; use the issue, not this
> document, as the card of record — this file is the reasoning behind the split.
>
> | Card | Issue | Card | Issue |
> |---|---|---|---|
> | A | #1596 | H | #1601 |
> | B | #1597 | I | #1605 |
> | C | #1598 | J | #1606 |
> | D | #1595 (owner decision) | K | #1602 |
> | E | #1599 | L | #1603 |
> | F | #1600 | N | #1607 |
> | G | #1604 | | |
>
> Two defects found while decomposing were filed separately: #1608 (the native tier never writes
> `sessions.title`) and #1609 (three documents disagree about a flag that no longer exists).

Read against `origin/main` (fetched 2026-09-12). Every claim below carries `path:line`.
Comments in this repo are known stale, so nothing here is taken from a comment unless the
comment is itself the artefact under discussion.

---

## 0. Verification of the brief's premises

| Premise given to me | Verdict | Evidence |
|---|---|---|
| `apps/agent` is 680 files / 617 `.py` | **confirmed** | `git ls-tree -r --name-only origin/main -- apps/agent` → 680; `grep -c '\.py$'` → 617 |
| #1582 moved four surfaces to the native tier | **confirmed** | `workers/edge/src/gateway/routing-policy.ts:82-84` (`turn`, `probe`) and `:92-96` (`transcript`, `stream`); type at `:60-63` |
| `/v1/search/preview` and `/v1/bangumi/{id}/guide` go to the **catalog worker** via `forwardPublicCatalog` | **WRONG — they go to the CONTAINER** | `workers/edge/src/gateway/request.ts:208` routes `isPublicV1` paths to `publicAgentV1Response`, which at `request.ts:217` calls `forwardV1(...)` — i.e. `forward.ts:74-76`, `env.CONTAINER`. `forwardPublicCatalog` (`forward.ts:23-25`) is reached only from `dispatch` case `"public-catalog"` (`request.ts:125` → `:163`), whose sole matcher is `/catalog/public/anime-overview/{digits}` (`request-class.ts:21,52`). The two `/v1` public paths never touch `env.CATALOG`. |
| `GET /` + `GET /healthz` reach the container via `containerLanding` | **confirmed** | `request.ts:137` → `:154-157` |
| `GET /healthz` is what the CD staging smoke probes | **confirmed** | `.github/scripts/staging-smoke-check.sh:88,92` (`$BASE_URL/healthz`, `jq -e '.status == "ok"'`); invoked at `.github/workflows/cd.yml:149` (staging) and `:281` (production) |
| `AGENT_TURN_ROUTE` no longer exists on main | **confirmed, and pinned** | zero hits in `workers/edge/wrangler.toml`; `workers/edge/test/agent-turn-route-config.test.ts:24-34` asserts its absence in `[vars]`, `[env.staging.vars]`, `[env.production.vars]`; `workers/edge/test/agent-database-binding.test.ts:91` repeats it |

---

## 1. The complete surviving container surface

Derived from `packages/contract/src/agent-paths.ts:39-52` cross-referenced against
`workers/edge/src/gateway/request-class.ts:35-57` (which class) and
`workers/edge/src/gateway/request.ts:122-236` (what serves that class).

| # | Path | Class | Served by today | Evidence |
|---|---|---|---|---|
| 1 | `GET /` | `landing/banner` | **container** | `request-class.ts:41` → `request.ts:137` → `:154` |
| 2 | `GET /healthz` | `landing/healthz` | **container** | `request-class.ts:36` → `request.ts:137` → `:154` |
| 3 | `POST /v1/chat` | `v1` | edge tier | `routing-policy.ts:82` |
| 4 | `POST /v1/byok/probe` | `v1` | edge tier | `routing-policy.ts:83` |
| 5 | `POST /v1/feedback` | `v1` | **container** | not in `edgeTierRoute`, not in `PUBLIC_V1_PATHS`/`ANON_V1_PATHS` → `request.ts:209` → `:224` → `authenticatedForward` → `forward.ts:97` → `forwardV1` |
| 6 | `GET /v1/conversations` | `v1` | **container** | same path as #5 |
| 7 | `PATCH /v1/conversations/{session_id}` | `v1` | **container** | same path as #5 |
| 8 | `GET /v1/conversations/{id}/messages` | `v1` | edge tier | `routing-policy.ts:92-96` |
| 9 | `GET /v1/conversations/{id}/stream` | `v1` | edge tier | `routing-policy.ts:92-96` |
| 10 | `GET /v1/bangumi/{bangumi_id}/guide` | `v1` | **container** | `routing-policy.ts:19` (`PUBLIC_V1_PATHS`) → `request.ts:208,217` |
| 11 | `GET /v1/bangumi/nearby` | `v1` | **container** | in no table → authenticated forward, `request.ts:224` |
| 12 | `GET /v1/search/preview` | `v1` | **container** | `routing-policy.ts:18` → `request.ts:208,217` |
| 13 | `POST /v1/photo-search` | `v1` | **container** | `ANON_V1_PATHS` `routing-policy.ts:25` → `request.ts:226,235` → `handleAnonymousV1`, and authenticated via `:224` — both end in `forwardV1` |
| 14 | `POST /v1/photo-search/confirm` | `v1` | **container** | `routing-policy.ts:26`, same as #13 |
| 15 | `POST /v1/sessions/adopt` | `adopt` | **container** | `request-class.ts:55` → `request.ts:127` → `:199` `handleSessionAdopt` → `identity/session-adopt.ts:40` `forwardV1` |

Plus one path the inventory does not carry: `POST /v1/turnstile/verify`
(`request.ts:205,238-245`) — edge-owned, no container hop.

**Eleven surfaces still reach the Python container.** `ANON_V1_PATHS` also lists `/v1/chat`
(`routing-policy.ts:24`) but that entry is now unreachable: `edgeTierRoute` intercepts it at
`request.ts:206` before `isAnonymousV1` is consulted.

---

## 2. Per-surface analysis, with evidence

### 2.1 `GET /healthz` — pure process metadata, zero I/O
- **Does today**: returns `ServiceMetadata(status="ok", service="animichi-runtime", git_commit, git_branch, started_at, app_env, observability_enabled, db_adapter, session_store)` — `apps/agent/src/animichi/interfaces/services/service_metadata.py:34-44`.
  `db_adapter`/`session_store` are `type(...).__name__` of objects already held in memory (`service_metadata.py:42-43`) — **no query runs**. `git_commit`/`git_branch`/`started_at` are resolved once at module import (`apps/agent/src/animichi/interfaces/routes/health.py:26,62-68`).
- **Destination**: **native edge tier**. It has no data dependency at all.
- **Data deps**: none. Target trivially has them.
- **Real callers besides the smoke**: `apps/web/src/lib/agent-warmup.ts:7,31` (fires on chat mount) and `apps/web/src/features/chat/use-backend-health.ts:14-16` (one-shot health probe, reads `response.ok` only — body-independent).
- **Risk if it regresses**: **highest in the set.** A red `healthz_ok` fails `Smoke the release` (`cd.yml:145-149`), which blocks `promote-production` (`cd.yml:167`) and the receipt (`cd.yml:150-163`).
- **Trap**: `agent-warmup.ts:9-27` exists *solely* to wake the container ("Cloudflare Containers scale to zero … 24.5s cold against 0.9s warm"). The moment `/healthz` is edge-native, that hook wakes nothing. It must be deleted in the same card, and the cost — the first `/v1/photo-search` after 10 min idle pays the cold start until §3 Card G lands — must be recorded, not discovered.

### 2.2 `GET /` — a hardcoded banner that lies
- **Does today**: `RootMetadata(service, status, app_env, endpoints={healthz:"/healthz", runtime:"/v1/runtime", feedback:"/v1/feedback"})` — `service_metadata.py:46-55`. Fully hardcoded; not derived from any route table. `/v1/runtime` is a **retired** path (`workers/edge/test/route-inventory.test.ts:41-46` asserts it is absent from the inventory), so the banner advertises a 404.
- **Destination**: **delete outright.**
- **Callers**: none. The zone routes `/v1/*`, `/img/*`, `/tiles/*`, `/healthz` to the edge and nothing else (`infra/src/web-routes.ts:52-56`); the apex is a Custom Domain onto `apps/web`. `GET /` on the edge script is reachable only on `*.workers.dev`. The CD smoke's `/` probe targets `$WEB_URL` — the *web* worker (`staging-smoke-check.sh:97`, `cd.yml:149` passes two distinct origins).
- **Risk**: low.

### 2.3 `POST /v1/feedback` — **destination genuinely unclear**
- **Does today**: `apps/agent/src/animichi/interfaces/routes/feedback.py:37-71` → `application/submit_feedback.py:81-113`. Validates non-blank `query_text`; if `session_id` is supplied, requires auth and ownership; writes `feedback(session_id, query_text, intent, rating, comment)` via `infrastructure/persistence/repositories/feedback.py:49-59,168-179`; reads `sessions` for the ownership check.
- **Data deps**: `feedback` (write), `sessions` (read). Both are `agent_svc`-granted (`migrations/neon/20260826000004_agent.sql:95` and `:195`), and the edge tier already holds an `agent_svc` connection that queries `sessions` directly (`workers/edge/src/agent/admission/session-owner.ts:5,14`). So the *target already has the data*.
- **Callers**: a complete typed client exists — `apps/web/src/features/chat/feedback.ts:17-28` — and **nothing in `apps/web/src` calls it.** I verified this independently: `git grep -n -E 'submitFeedback|feedbackUrl' origin/main -- apps/web/src e2e` returns only the three lines inside `feedback.ts` itself.
- **Why unclear**: the surface is dead *from the UI* but alive *in intent* — an unwired client plus a live table plus a `type:debt`-free route is the signature of a feature that was built and not shipped, not of a mistake. I will not invent a plan for it.
- **Evidence that settles it**: (a) does any row exist in `public.feedback` on the staging or production Neon branch? A non-empty table means it shipped once and the caller was removed by regression. (b) is there an open issue or a line in the frontend rebuild spec that owns the feedback UI? If both are negative, delete route + client + table grant together; if either is positive, port it in the same shape as §2.4.
- **Risk if it regresses**: low today (nothing calls it), medium if the UI is meant to return.

### 2.4 `GET /v1/conversations` — **live**, and already half-broken
- **Does today**: `apps/agent/src/animichi/interfaces/routes/conversations.py:84-93` → `SELECT id AS session_id, title, first_query, created_at, updated_at FROM sessions WHERE user_id = :user_id ORDER BY updated_at DESC LIMIT 30` (`infrastructure/persistence/repositories/_session_state.py:189-198`).
- **Destination**: **native edge tier.**
- **Data deps**: `sessions` only. The edge tier already reads and writes that exact table (`session-owner.ts:5,14,25`), under the same `agent_svc` grant.
- **Callers**: live — `apps/web/src/features/chat/use-conversation-list.ts:47`, rendered by `ChatSidebar.tsx:154`, mounted through `ChatPage.tsx:211` at `apps/web/src/routes/chat.tsx`.
- **Pre-existing defect this card inherits**: the native tier's only write to `sessions` is
  `INSERT INTO sessions (id, user_id) … ON CONFLICT (id) DO UPDATE SET user_id = sessions.user_id`
  (`session-owner.ts:14-16`). It never sets `title` or `first_query`
  (grep for `first_query` across `workers/edge/src/agent` and `packages/pi-session-neon/src`
  returns nothing). The columns exist and are nullable
  (`migrations/neon/20260826000004_agent.sql:177-178`). So every conversation created since
  #1582 already lists with a null title. Porting the route unchanged ports the bug; the card
  must decide whether the intake starts writing a title or the contract admits null.
- **Risk**: high — visible sidebar.

### 2.5 `PATCH /v1/conversations/{session_id}` — dead
- **Does today**: `conversations.py:96-114`; `SELECT … FROM sessions WHERE id` then `UPDATE sessions SET title=…, updated_at=now() … RETURNING id` (`_session_state.py:56-62,216-226`).
- **Destination**: **delete.** No rename UI exists. I verified independently: `git grep -n -E '"PATCH"|method: .PATCH' origin/main -- apps/web/src` returns **zero lines**; `ChatSidebar.tsx:78` renders `conversation.title` read-only.
- **Risk**: low.

### 2.6 `GET /v1/bangumi/{bangumi_id}/guide` — dead, superseded
- **Does today**: `apps/agent/src/animichi/interfaces/routes/bangumi.py:22-99` — one `bangumi` row + all its `points`, a bounding box, and city-name localization from a bundled JSON (`agents/geo_names.py:14-28`). Plain equality/order-by, no PostGIS.
- **Destination**: **delete.** The mounted anime route uses the catalog worker's oRPC instead: `apps/web/src/routes/anime/$bangumiId.tsx:53-67` → `apps/web/src/api/hooks/use-anime-overview.ts:9-14` → `GET /catalog/public/anime-overview/{id}` (`packages/contract/src/contract.ts:179`), whose handler owns `bangumi`+`points` (`workers/catalog/src/router.ts:47-58,90-93`, schema `workers/catalog/src/db/schema.ts:63,73`).
- **Callers**: none in `apps/web/src` or `e2e` (verified by grep for `search/preview|/guide|bangumi/nearby`).
- **Risk**: low. Target already has the data and is already the shipped path.

### 2.7 `GET /v1/bangumi/nearby` — dead
- **Does today**: `bangumi.py:104-121` → `ST_DWithin(location_or_fallback(...), ST_MakePoint(lng,lat)::geography, radius_m)` grouped over `bangumi`×`points`, `LIMIT 10` (`infrastructure/persistence/expressions.py:42-77`).
- **Destination**: **delete.** Catalog already serves the equivalent as `POST /catalog/nearby` (`packages/contract/src/contract.ts:160`) over real PostGIS (`workers/catalog/src/db/expressions.ts:26-35`, `workers/catalog/src/adapters/outbound/nearby-points.ts:44-60`), and that is the path the agent's own `searchNearby` tool takes (`packages/agent/src/search-nearby.ts`, client at `packages/agent/src/catalog-client.ts:9-11` over `env.CATALOG`, wired at `workers/edge/src/agent/host/native-bootstrap.ts:39`).
- **Risk**: low.

### 2.8 `GET /v1/search/preview` — dead
- **Does today**: `apps/agent/src/animichi/interfaces/routes/search_preview.py:42-116` — an in-process IP rate limiter (`:29`, a `defaultdict(list)` that resets on restart), one `title ILIKE` lookup, then the same `bangumi`+`points` read as §2.6, truncated to 5.
- **Destination**: **delete.** No caller anywhere.
- **Caution for whoever executes it**: this path is the *synthetic fixture* several edge tests use to exercise gateway behaviour — `workers/edge/test/container-retry.test.ts:133,174`, `entry-v1-routing.test.ts:12,58`, `gateway-error.test.ts:49`, `rate-limit-ac6.test.ts:71-90`, `turnstile-arm.test.ts:187`. Those tests must be repointed at a surviving path, not deleted.
- **Side effect**: with all three of §2.6–2.8 gone, `PUBLIC_V1_PATHS` (`routing-policy.ts:18-21`) is empty, and `isPublicV1`/`publicAgentV1Response`/`publicReadKey` become dead on the `/v1` side. `publicReadKey` is still used by the `/catalog/public/…` branch (`request.ts:161`) — do not delete it.

### 2.9 `POST /v1/photo-search` — **live, and the real blocker**
- **Does today**: `apps/agent/src/animichi/interfaces/routes/photo_search.py:230-296`. Builds a `TurnOutcome`, runs turn admission, resolves an optional BYOK model (`photo_search.py:83-95`), then `application/search_photo.py`: decodes the image, checks a per-tier quota, calls a **vision model** — `pydantic_ai.Agent(model, output_type=RecognizedTitles)` over `BinaryContent` (`apps/agent/src/animichi/agents/photo_vision.py:87-97`) — then a catalog resolve pipeline, issues a candidate offer, records usage, settles the turn.
- **Data deps**: writes `turn_reservations` and `daily_usage` (`migrations/neon/20260826000004_agent.sql:169,75`); reads catalog over HTTP to the catalog Worker (`apps/agent/src/animichi/clients/catalog_client.py:1-14`); **plus two in-process stores** — the per-tier quota and `InMemoryPhotoOfferStore` (`apps/agent/src/animichi/infrastructure/photo_offers.py:23-58`, a plain dict, 10-minute TTL, explicitly documented as "In-process only … a shared store is a later ops decision", `photo_offers.py:1-7`).
- **Destination**: **native edge tier — as a feature build, not a move.**
- **Does the target have it?** Partly. It has admission (`workers/edge/src/agent/admission/`), settlement writing `daily_usage` (`workers/edge/src/agent/settlement/settlement-accounting.ts:55-60`), BYOK across three families (`workers/edge/src/agent/byok/byok-family.ts:59-84`), and a catalog client. It has **no vision path and no offer store**: `git grep -ln -i photo origin/main -- packages/agent workers/edge/src workers/catalog/src` returns only route tables, env allowlists and copy — `packages/agent/src/tools.ts` exports ten tools and photo search is not among them.
- **Callers**: live — `apps/web/src/features/chat/photo-search.ts:138,144` from `PhotoSearchUpload.tsx:127`, mounted via `ComposerDock.tsx:60` in the chat composer.
- **Risk**: high. This is a shipped user-facing feature with zero TS implementation.

### 2.10 `POST /v1/photo-search/confirm` — live, and coupled to §2.9's in-process state
- **Does today**: `photo_search.py:297-311` → `application/confirm_photo_offer.py`; looks the offer up in the same in-process dict and returns 204 or a typed rejection.
- **Data deps**: **none durable.** That is the problem: the offer only exists in the process that issued it. Porting it means the offer namespace has to acquire a real home first (a Neon table under `agent_svc`, or the session Durable Object).
- **Callers**: live — `apps/web/src/features/chat/selection/photo-offer-pick.ts:22` via `PhotoSearchUpload.tsx:107`.
- **Risk**: high, and it cannot be sequenced *after* §2.9 — the two share the namespace, so they flip together.

### 2.11 `POST /v1/sessions/adopt` — live, login-critical
- **Does today**: the edge resolves the anonymous cookie and forwards (`workers/edge/src/identity/session-adopt.ts:39-40`). The container does the work: `apps/agent/src/animichi/interfaces/routes/adopt_sessions.py:98-121` rejects any client-supplied `session_id`, requires a non-anonymous user, then `UPDATE sessions SET user_id=:to, updated_at=now() WHERE user_id=:from RETURNING id` plus, per adopted session, a marker `INSERT INTO turn_reservations … turn_key = 'adopt:'||session_id … ON CONFLICT DO NOTHING` to invalidate pre-adoption turn capabilities (`infrastructure/persistence/repositories/_session_adoption.py:23-49,65-72`).
- **Data deps**: `sessions` (write), `turn_reservations` (write). Both `agent_svc`; the edge tier already writes `sessions` (`session-owner.ts:14`) and the admission stack already owns turn state.
- **Callers**: live — `apps/web/src/lib/auth/session-adoption.ts:26,101` from `use-auth-callback.ts:253`, mounted at `apps/web/src/routes/auth/callback.tsx`.
- **Risk**: high — it is on the Neon Auth login callback path; a regression silently orphans every anonymous conversation at sign-in.

---

## 3. Couplings #1317 does not mention

These are not surfaces, but each one turns the pipeline red if the card is executed literally.

1. **`apps/agent/docker/test-postgres/Dockerfile` is shared infrastructure, not agent code.**
   Built by five CI lanes and one local gate: `.github/workflows/pr-verification.yml:178` (the
   affected matrix for `catalog`, `edge-worker`, `@animichi/agent`, `@animichi/test-postgres`,
   `migrator`, `@animichi/pi-session-neon` — see `:177`), `:361`, `:429`, `:481`, and
   `scripts/local-gates/db-fresh-schema.sh:46`. The image tag contract lives in
   `packages/test-postgres/postgres-image.env:8`. The repo's own audit already carved it out:
   `docs/specs/2026-09-05-repo-smell-audit.md:426` — "注意 `apps/agent/docker/test-postgres/Dockerfile` 不随 agent 删".

2. **`packages/eval` reads `apps/agent` at runtime, and that read is inside `pnpm test`.**
   `packages/eval/package.json:11` makes `test` = unit tests **and** `test:fixture-drift`;
   `:13` makes `test:fixture-drift` = `scripts/export-fixtures.sh` + the drift gate, and
   `packages/eval/scripts/export-fixtures.sh:36-42,51-55,64` runs `uv run python -m animichi.tests.eval.*`
   inside `apps/agent`. Two more runtime reads that are not scripts:
   `packages/eval/src/gate/case-strata.ts:34` resolves the **canonical dataset directory** at
   `apps/agent/src/animichi/tests/eval/datasets/`, and `packages/eval/src/pins.ts:62` reads
   `apps/agent/uv.lock`. #1317's "Keep: `packages/eval` fixtures and oracles (frozen)" is not
   achievable by leaving files alone — the package has to stop reaching across.

3. **`packages/contract` generates into `apps/agent`.** `packages/contract/package.json:34`
   (`emit:agent-python`) writes `apps/agent/src/animichi/interfaces/boundary/agent_models.py`
   (`packages/contract/scripts/emit-agent-python.ts:12`). Deleting the target orphans the emitter
   and its drift test.

4. **Removing a Durable Object class is a `[[migrations]]` tag, not a config deletion.**
   `RuntimeContainer` is declared new in `workers/edge/wrangler.toml` tag `v1` (`:189-191`), and
   the file already has the precedent for retirement — tag `v5`, `deleted_classes = ["RunSweeper"]`
   (`:205-207`). Deleting the `[[containers]]` block and the `CONTAINER` binding (`:149-163`,
   `:301-314`, and the staging block) without a `v6` `deleted_classes = ["RuntimeContainer"]`
   in all three rings is the same mistake #1589 warns about for `MigrationContainer`.

5. **`make check` does not have "a uv arm" — it *is* the Python arm.**
   `Makefile:119` is `check: lint typecheck test test-integration`, and all four targets are
   `cd apps/agent && uv run …` (`Makefile:99-118`, `:68`, `:82`). Meanwhile uv survives the
   deletion regardless: `pr-verification.yml:553` installs semgrep and `:618` installs sqlfluff
   through `uv tool install`.

6. **The `agent` workspace member is what routes `pnpm lint`/`typecheck` into the Makefile.**
   `apps/agent/package.json` declares `"lint": "make -C ../.. lint"` and
   `"typecheck": "make -C ../.. typecheck"`. It is excluded by name from the affected matrix
   (`pr-verification.yml:110`) and the pre-push gate (`scripts/local-gates/pre-push-affected.sh:40,47,56`).

7. **`agent-eval-nightly.yml` is a wholly Python workflow** — `uv sync` in `apps/agent` and two
   `uv run pytest` steps (`.github/workflows/agent-eval-nightly.yml:82-92`). It is not named in #1317.

8. **`codecov.yml` ignores a Python file** — `codecov.yml:30-31`, naming
   `apps/agent/src/animichi/application/turn_outcome_port.py`.

---

## 4. Stale claims in #1317's own text

| Claim in the card | Reality |
|---|---|
| "**Blocked by W3-5 (#1303): the Python baseline must have been produced by the double run first**" | #1303 is closed **as superseded, with no baseline produced**. Owner comment 2026-09-07: "**Verdict for the W3 exit: not met.** W4 (#1317) must not start on this evidence." Owner 2026-09-08: the Python-vs-TS paired comparison is *dropped*, the TS run becomes the baseline. Owner 2026-09-09: 被 `docs/specs/2026-09-09-agent-on-pi-harness-spec.md`（#1533）取代 — the SUT moved from deployed staging to an in-process Model+Harness and the 662-case double run is void; the baseline is recast by #1560. The blocker was **dissolved, not satisfied**. |
| "the `container` position of `AGENT_TURN_ROUTE` (the flag becomes edge-only or is removed — say which)" | The flag does not exist. `workers/edge/test/agent-turn-route-config.test.ts:24-34` pins its absence in all three rings. |
| "the uv CI arm in **`ci.yml`**" | There is no `.github/workflows/ci.yml`. The workflows are `pr-verification.yml`, `release-build.yml`, `cd.yml`, `agent-eval-nightly.yml`. |
| "… / **`components.json`**" | No file named `components.json` exists anywhere in the tree. |
| "the container image build + **`stage-services`** container deploy in `cd.yml`" | There is no `stage-services` job. The staging job is `stage` (`cd.yml:45`) and it publishes with `.github/scripts/release/publish-services.sh`, which deploys `catalog users edge web` (`publish-services.sh:6-8`) — **no container step at all**; the container application is reconciled as a side effect of the edge Worker deploy. `stage-services` appears only as a *future* job name in `docs/specs/2026-09-05-cicd-redesign-spec.md:308`. |
| "`make check` green with **no uv arm**" | See §3.5 — `make check` is 100% Python, and uv stays in CI for semgrep and sqlfluff. |
| "Keep: `packages/eval` fixtures and oracles (frozen)" / "move the oracle fixtures' regeneration story to *frozen at W3-5*" | W3-5 never produced a Python baseline (row 1), so there is no "frozen at W3-5" state to point at. And freezing is not a docs change — see §3.2. |
| AC1: "`rg -n 'apps/agent\|uv run\|RuntimeContainer\|\[\[containers\]\]' .` empty outside `docs/archive` + the spec" | Unachievable as written: `[[containers]]` is legitimately present in `workers/migrator/wrangler.toml` until #1589 lands, and `uv run` legitimately survives in `pr-verification.yml`'s semgrep/sqlfluff steps and `.pre-commit-config.yaml:127`. |
| "Delete `apps/agent/` and everything **only it needed**" | The Dockerfile at `apps/agent/docker/test-postgres/` is needed by five other lanes (§3.1) — the card gives no carve-out, and the repo's own audit already wrote one (`docs/specs/2026-09-05-repo-smell-audit.md:426`). |
| Constraints: "**One PR**" | Not satisfiable. Eleven live surfaces, one of which (photo search) has no TS implementation and needs a schema migration. |

---

## 5. The card sequence

Scopes are taken from `commitlint.config.js` `SCOPES` (`agent|web|chat|catalog|users|auth|edge|contract|db|infra|delivery|eval|e2e|repo|deps`).
`migrator` is not one, as noted. Headers are ≤72 characters, imperative, lowercase after the colon.
Format follows #1564 / #1575: **Epic · Track · Authority**, one-paragraph **Outcome**, **Scope**,
checkbox **Acceptance criteria** each carrying a test type, **Primary references**.

**Dependency graph** (an arrow means "must merge after"):

```
A ─────────────────────────────┐
B ─────────────────────────────┤
C ─────────────────────────────┤
D ─────────────────────────────┤
E ─────────────────────────────┼──> I ──> J ──┐
H ─────────────────────────────┤              ├──> N
F ──> G ───────────────────────┘              │
K ────────────────────────────────────────────┤
L ────────────────────────────────────────────┘
```

A, B, C, D, F, K, L have no predecessors and can run concurrently. **N is the deletion and is last.**

---

### Card A (#1596) — `fix(edge): answer healthz without the container` (69 chars)

**Epic:** #1259 · **Track:** edge · **Authority:** `.github/scripts/staging-smoke-check.sh:88,92`
is the only automated proof a staging deploy works, and it reads `/healthz` from the edge origin;
today that request is forwarded into the Python container (`workers/edge/src/gateway/request.ts:137,154-157`).

**Outcome.** `GET /healthz` is answered by the edge Worker itself with a body the existing smoke
still accepts (`.status == "ok"`), and `GET /` is retired from the gateway and from the path
inventory. Neither landing surface touches `env.CONTAINER` afterwards. `useAgentWarmup` — which
exists only to wake the container and has no other effect (`apps/web/src/lib/agent-warmup.ts:9-31`)
— is deleted in the same change, and the resulting cold-start cost on the first `/v1/photo-search`
after an idle window is recorded here and closed by Card G. This card must reach staging before
any card that removes container plumbing.

**Scope.** Replace `containerLanding` (`request.ts:154-157`) with a native response for the
`healthz` asset; drop the `banner` asset from `landingClass` (`request-class.ts:41`) so `/` falls
through to `notFoundResponse`; remove `{ method: "GET", path: "/" }` from
`packages/contract/src/agent-paths.ts:40` and regenerate the OpenAPI/Python emissions; delete
`apps/web/src/lib/agent-warmup.ts` and its call site (`ChatPage.tsx:43,246`). Leave
`fetchContainerResilient` in place — `/v1` still uses it.

**Acceptance criteria**
- [ ] **(unit)** `GET /healthz` returns 200 with `status: "ok"` from a gateway test whose `Env` has **no** `CONTAINER` binding; restoring the container forward turns the test red.
- [ ] **(unit)** `GET /` classifies as `not-found`; a test asserts neither `/` nor `/healthz` reaches `fetchContainerResilient` (spy on the fetch seam, not a source grep).
- [ ] **(unit)** `route-inventory.test.ts` pins `/` as absent from `AGENT_PATHS`, in the same shape it already pins `/v1/runtime` (`workers/edge/test/route-inventory.test.ts:41-46`).
- [ ] **(unit)** `packages/contract` composition drift against the committed `agent-openapi.json` is green after the emitter runs.
- [ ] **(api)** `bash .github/scripts/staging-smoke-check.sh <staging edge> <staging web>` passes against the deployed staging edge with the container application stopped.
- [ ] **(browser)** the chat page still reports backend health (`useBackendHealth`) and renders no warm-up request in the network log.

**Primary references** — `.github/workflows/cd.yml:145-149`; `apps/agent/src/animichi/interfaces/services/service_metadata.py:34-55`; `infra/src/web-routes.ts:52-56`.

---

### Card B (#1597) — `refactor(edge): retire three uncalled catalog reads` (52 chars)

**Epic:** #1259 · **Track:** edge · **Authority:** none of the three has a caller in `apps/web/src`
or `e2e` (verified by grep for `search/preview|/guide|bangumi/nearby`), and the catalog Worker
already owns the data and already serves the shipped path
(`apps/web/src/routes/anime/$bangumiId.tsx:53-67` → `GET /catalog/public/anime-overview/{id}`).

**Outcome.** `GET /v1/search/preview`, `GET /v1/bangumi/{bangumi_id}/guide` and
`GET /v1/bangumi/nearby` are gone from the inventory, the edge route tables, the rate policy and
the Python routers. `PUBLIC_V1_PATHS` becomes empty and the `/v1` public branch is removed;
`publicReadKey` stays, because the `/catalog/public/…` branch still uses it (`request.ts:161`).

**Scope.** Delete the three entries from `packages/contract/src/agent-paths.ts:49-51`; delete
`PUBLIC_V1_PATHS` and `isPublicV1` (`routing-policy.ts:18-21,47-49`) and the
`publicAgentV1Response` branch (`request.ts:208,212-218`); remove their rate-policy cells; delete
`apps/agent/src/animichi/interfaces/routes/search_preview.py` and the two `bangumi.py` handlers
with their tests. **Repoint, do not delete**, the edge tests that use `/v1/search/preview` as a
synthetic gateway fixture: `container-retry.test.ts:133,174`, `entry-v1-routing.test.ts:12,58`,
`gateway-error.test.ts:49`, `rate-limit-ac6.test.ts:71-90`, `turnstile-arm.test.ts:187`.

**Acceptance criteria**
- [ ] **(unit)** `route-inventory.test.ts` asserts all three are absent from `AGENT_PATHS` and that `classifyRatePolicy` returns `limiter: "none"` for each — the shape already used for `/v1/runtime`.
- [ ] **(unit)** the repointed gateway tests still fail when their behaviour under test is mutated (retry backoff, error envelope, rate cell) — mutation evidence per test, not just green.
- [ ] **(api)** each of the three paths answers 404 from the deployed staging gateway, not 200 from the container.
- [ ] **(unit)** the Python suite is green with the three routers and their unit tests removed, at the unchanged `--cov-fail-under`.

**Primary references** — `workers/catalog/src/router.ts:47-58,90-93`; `packages/contract/src/contract.ts:160,179`.

---

### Card C (#1598) — `refactor(chat): retire the unwired conversation rename` (55 chars)

**Epic:** #1259 · **Track:** chat · **Authority:** no rename UI exists —
`git grep -n -E '"PATCH"|method: .PATCH' origin/main -- apps/web/src` returns zero lines, and
`ChatSidebar.tsx:78` renders the title read-only.

**Outcome.** `PATCH /v1/conversations/{session_id}` is removed from the inventory, the edge rate
policy and the Python router. Conversation titles become read-only by contract as well as in fact.

**Scope.** `packages/contract/src/agent-paths.ts:44`; the rate-policy cell and its tests
(`workers/edge/test/rate-limit-bypass.test.ts:126-152`, `rate-policy.test.ts:76`,
`auth-rate-limit-scope.test.ts:45`); `conversations.py:96-114` and `_session_state.py:216-226`;
`apps/agent/src/animichi/tests/unit/test_conversation_rename.py`.

**Acceptance criteria**
- [ ] **(unit)** the inventory no longer carries the path and `classifyRatePolicy("PATCH", "/v1/conversations/x")` is `none`.
- [ ] **(api)** `PATCH /v1/conversations/{id}` answers 404 on deployed staging.
- [ ] **(unit)** contract drift against `agent-openapi.json` is green.

---

### Card D (#1595) — `/v1/feedback` — **decision required before a card is written**

Do not write this card yet. See §2.3: the client is complete and unwired, the table is live and
`agent_svc`-granted. Two mutually exclusive outcomes, and the evidence that picks one:

- **Delete** (`refactor(chat): retire the unwired feedback surface`) — if `public.feedback` is
  empty on both the staging and production Neon branches **and** no open issue or spec line owns a
  feedback UI. Scope: route, use case, repo, `apps/web/src/features/chat/feedback.ts`, the table's
  `agent_svc` grant (`migrations/neon/20260826000004_agent.sql:95`), and the edge tests at
  `workers/edge/test/anonymous.test.ts:72`, `turnstile-arm.test.ts:146`, `rate-limit-bypass.test.ts:118-122`.
- **Port** (`feat(chat): submit feedback from the edge tier`) — if either check is positive. Then it
  follows Card E's shape exactly: it needs the same `sessions` ownership read the edge tier already
  performs (`session-owner.ts:5`) plus one insert.

Either way it must be settled before Card I; it cannot be left to the deletion card.

---

### Card E (#1599) — `feat(edge): list conversations from the gateway` (47 chars)

**Epic:** #1259 · **Track:** edge · **Authority:** the sidebar is live
(`apps/web/src/features/chat/use-conversation-list.ts:47` → `ChatSidebar.tsx:154` →
`ChatPage.tsx:211` → `apps/web/src/routes/chat.tsx`) and it is one of two remaining live reads
still crossing into the container.

**Outcome.** `GET /v1/conversations` is served by the native tier over the same `sessions` table
the edge already reads and writes (`workers/edge/src/agent/admission/session-owner.ts:5,14`), with
the same 30-row, `user_id`-scoped, `updated_at DESC` semantics
(`apps/agent/.../_session_state.py:189-198`). The card also settles the title gap: since #1582 the
native intake inserts only `(id, user_id)` (`session-owner.ts:14-16`) and never writes `title` or
`first_query`, so every conversation created on the edge tier already lists untitled. The card
either starts writing a title at intake or makes the contract admit null explicitly — it does not
port the gap silently.

**Scope.** Add a `list` kind to `EdgeTierRoute` (`routing-policy.ts:60-63`) and a `GET`
`/v1/conversations` branch to `edgeTierRoute`; mark the inventory entry
`runtime: "edge"` (`packages/contract/src/agent-paths.ts:43`); implement the read alongside the
existing history views (`workers/edge/src/agent/views/`); delete `conversations.py:84-93` and
`_session_state.py:189-198`.

**Acceptance criteria**
- [ ] **(integration)** against a real PostgreSQL (`@animichi/test-postgres`): the 30-row cap, `user_id` scoping, `updated_at DESC` ordering, and that another user's rows are never returned.
- [ ] **(unit)** `turnRoutePolicy().select("GET", "/v1/conversations")` returns the new kind, and `route-inventory.test.ts` pins the `runtime: "edge"` marker.
- [ ] **(unit)** mutation evidence: dropping the `user_id` predicate turns the integration case red; restoring turns it green.
- [ ] **(api)** authenticated request against deployed staging returns the contract-declared body; unauthenticated returns 401 without reaching the database.
- [ ] **(browser)** `ChatSidebar` lists a conversation created through the native `/v1/chat` turn, with the decided title behaviour visible.

**Primary references** — `packages/contract/src/session-history-contract.ts`; `migrations/neon/20260826000004_agent.sql:175-197`.

---

### Card F (#1600) — `feat(db): add the photo offer namespace` (39 chars)

**Epic:** #1259 · **Track:** db · **Authority:** the offer namespace is a process-local dict today
and says so — `apps/agent/src/animichi/infrastructure/photo_offers.py:1-7`, "In-process only …
a shared store is a later ops decision". A Worker has no process to be local to, so Card G cannot
land without a durable home.

**Outcome.** An `agent_svc`-owned table exists in the `migrations/neon` Atlas chain holding a photo
offer (offer id, identity, signals, candidates, `expires_at`) with the same 10-minute TTL semantics
and bounded-namespace eviction the in-process store implements
(`photo_offers.py:20,36-58`). No reader ships in this card, so nothing changes behaviourally and
the pipeline stays green.

**Scope.** One Atlas migration under `migrations/neon/`, grants in the shape of
`migrations/neon/20260826000004_agent.sql:169` (`turn_reservations`), a Drizzle/type declaration if
the edge tier's data layer needs one. No route, no handler.

**Acceptance criteria**
- [ ] **(integration)** the migration applies and rolls forward cleanly on a disposable PostgreSQL through the existing Atlas chain harness, and `atlas migrate validate` is green over `migrations/neon`.
- [ ] **(unit)** a grant test asserts `agent_svc` holds `SELECT/INSERT/UPDATE/DELETE` and that no other service role does.
- [ ] **(integration)** the staging apply through the migrator reports the new head with zero pending, per the existing preflight (`.github/scripts/release/schema-preflight.sh`).

**Primary references** — #1589's `deleted_classes` note is not relevant here; `migrations/AGENTS.md:84` for the `agent_svc` ownership row.

---

### Card G (#1604) — `feat(chat): serve photo search from the edge tier` (49 chars)

**Blocked by:** Card F. **Epic:** #1259 · **Track:** chat · **Authority:** photo search is a shipped
composer feature (`apps/web/src/features/chat/components/PhotoSearchUpload.tsx:127,107` via
`ComposerDock.tsx:60`) and has **no** TypeScript implementation —
`packages/agent/src/tools.ts` exports ten tools and photo search is not one of them.

**Outcome.** `POST /v1/photo-search` and `POST /v1/photo-search/confirm` are both `EdgeTierRoute`s.
The turn runs a vision model through the existing provider layer, resolves candidates through the
catalog client the native tier already binds
(`workers/edge/src/agent/host/native-bootstrap.ts:39`), persists the offer to Card F's table, and
settles through the existing admission/settlement stack that already writes `daily_usage`
(`workers/edge/src/agent/settlement/settlement-accounting.ts:55-60`). Confirm reads the same table.
The two flip together because they share the namespace.

**Scope.** A vision capability in `packages/agent` (the Python original is
`apps/agent/src/animichi/agents/photo_vision.py:87-97` — a structured-output agent over
`BinaryContent`); the resolve pipeline (`apps/agent/src/animichi/agents/photo_search.py`); the
per-tier quota, currently in-process (`photo_search_runtime.py:60`) and driven by
`PHOTO_SEARCH_QUOTA_ANON`/`PHOTO_SEARCH_QUOTA_MEMBER` (`container-env.ts:43`); BYOK model
resolution, which the edge already has per family (`byok/byok-family.ts:59-84`); two new
`EdgeTierRoute` kinds; deletion of `apps/agent/.../routes/photo_search.py` and its stack.

**Acceptance criteria**
- [ ] **(integration)** a real image through the native route against a real PostgreSQL produces an offer row, a `daily_usage` row and a settled turn; the confirm route then returns 204 and a second confirm of the same offer is refused.
- [ ] **(integration)** an offer issued by one Worker isolate is confirmable from another — the exact property the in-process store did not have.
- [ ] **(unit)** the quota ceiling refuses the (n+1)th request per tier, with the clock mocked.
- [ ] **(unit)** mutation evidence: removing the offer-expiry predicate turns a case red; removing the BYOK-before-platform preference turns another red.
- [ ] **(api)** anonymous and authenticated photo searches against deployed staging both succeed, and a BYOK-keyed request reaches the caller's provider (verified through the existing egress allowlist behaviour, `workers/edge/src/agent/egress/provider-allowlist.ts`).
- [ ] **(browser)** the composer upload → candidate pick → confirm flow completes end to end against staging.

---

### Card H (#1601) — `feat(auth): adopt anonymous sessions at the edge` (48 chars)

**Epic:** #1259 · **Track:** auth · **Authority:** adoption is on the Neon Auth callback path
(`apps/web/src/lib/auth/session-adoption.ts:26,101` ← `use-auth-callback.ts:253` ←
`apps/web/src/routes/auth/callback.tsx`) and is the last write the edge forwards into the container
(`workers/edge/src/identity/session-adopt.ts:39-40`).

**Outcome.** `handleSessionAdopt` performs the adoption itself instead of forwarding: one
`UPDATE sessions SET user_id` scoped to the resolved anonymous identity, plus the per-session
`turn_reservations` marker insert that invalidates pre-adoption turn capabilities
(`apps/agent/.../_session_adoption.py:23-49,65-72`). The container's `adopt_sessions` router is
deleted. The client-supplied-`session_id` refusal (`adopt_sessions.py:69-88`) moves with it — it is
an anti-forgery rule, not an implementation detail.

**Scope.** `workers/edge/src/identity/session-adopt.ts`; the admission database seam it needs is
already bound (`workers/edge/src/agent/admission/session-owner.ts`); delete
`apps/agent/src/animichi/interfaces/routes/adopt_sessions.py`,
`application/adopt_sessions.py`, `_session_adoption.py`.

**Acceptance criteria**
- [ ] **(integration)** real PostgreSQL: sessions owned by the anonymous id are re-pointed at the account, a marker row per adopted session appears in `turn_reservations`, re-running the adoption is idempotent, and a session owned by a third party is untouched.
- [ ] **(unit)** a request carrying a client-supplied `session_id` in query, header or body is refused before any write; the 1024-byte body probe bound is preserved.
- [ ] **(unit)** an anonymous caller (no verified account) is refused; mutation evidence that removing the check turns it red.
- [ ] **(api)** a real sign-in against deployed staging adopts the anonymous conversation and the sidebar shows it under the account.
- [ ] **(browser)** the login-wall e2e (`e2e/web-chat-save-login-wall.spec.ts:92`) is green against the native implementation.

---

### Card I (#1605) — `refactor(edge): remove the container binding and plumbing` (57 chars)

**Blocked by:** A, B, C, D, E, G, H. **Epic:** #1259 · **Track:** edge · **Authority:** once every
surface above has landed, `env.CONTAINER` has no caller.

**Outcome.** The edge Worker carries no container. `[[containers]]`, the `CONTAINER` Durable Object
binding, the `RuntimeContainer` class and the `ContainerProxy` re-export are gone from all three
rings, retired by a `deleted_classes` migration tag rather than a bare config deletion. The
container env-forwarding allowlist, the port-ready budget and the container fetch bound go with
them.

**Scope.** `workers/edge/wrangler.toml:149-163` (default), `:301-314` (production) and the staging
equivalents; a new `[[migrations]]` tag `v6` with `deleted_classes = ["RuntimeContainer"]` in each
ring, following the existing `v5`/`RunSweeper` precedent (`:205-207`); `workers/edge/src/entry.ts:3,12,22,40-88`
(the class, the `ContainerProxy` export and `outboundByHost`); `workers/edge/src/container/`
(`container-env.ts`, `port-ready-budget.ts` — #1239's `withPortReadyBudget`);
`workers/edge/src/gateway/container-fetch.ts` (179 lines) and the `fetchContainerResilient` call
sites; `forwardV1` and `catalogOutbound` in `gateway/forward.ts:60-80,110-123`; the `CONTAINER`
field in `workers/edge/src/env.ts:10`; the container test files
(`container-env.test.ts`, `container-fetch-timeout.test.ts`, `container-retry.test.ts`,
`entry-container-env.test.ts`, `denied-egress.test.ts`).
**Keep:** `env.CATALOG` — the native tier calls it directly (`native-bootstrap.ts:39`), so
`catalog.internal` interception is not what makes catalog private any more; and the native BYOK
egress guard (`workers/edge/src/agent/egress/`), which is a separate mechanism from
`DENIED_EGRESS_HOSTS`.

**Acceptance criteria**
- [ ] **(unit)** a wrangler-configuration contract test asserts no `[[containers]]`, no `CONTAINER` binding and no `RuntimeContainer` class in the default, staging and production rings; reintroducing any one fails.
- [ ] **(unit)** a `[[migrations]]` tag names `RuntimeContainer` in `deleted_classes` in every ring, and no later tag reintroduces it.
- [ ] **(unit)** the deployed entry's **module graph** (not a source grep) contains no `@cloudflare/containers` import — same assertion #1589 specifies for the migrator.
- [ ] **(unit)** `Env` no longer declares `CONTAINER`; typecheck across the whole workspace is green.
- [ ] **(api)** deployed staging answers every surviving `/v1` path and `/healthz` with the container application deleted from the account.

**Primary references** — [Durable Objects migrations (`deleted_classes`)](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/); #1589 (same mechanism, migrator side).

---

### Card J (#1606) — `ci(delivery): drop the agent image from the release snapshot` (60 chars)

**Blocked by:** Card I. **Collides with #1589 — see §7.** **Epic:** #1356 · **Track:** delivery.

**Outcome.** A release build no longer builds or pushes `animichi-agent`, the snapshot manifest no
longer names it, the sealed edge configuration no longer requires an immutable digest, and the CD
identity receipt no longer expects a container application for the edge Worker.

**Scope.** `.github/workflows/release-build.yml:81-91` (the agent build/push step) and the
`AGENT_IMAGE` env at `:105,108`; `.github/lib/release/config.mjs:18` (`['edge','migrator']` digest
requirement) and `:13` (the `containers` reseal); `.github/lib/release/snapshot.rb:35`
(`images.keys.sort == %w[agent migrator]`); `.github/scripts/release/record-receipt.mjs:11-18,27`
(`observeContainers`, `manifest.images[unit === 'edge' ? 'agent' : unit]`);
`.github/scripts/release/verify-config.mjs:16`; and the pinning tests
`.github/test/release-build.test.rb:46-47,58`, `release-snapshot.test.rb:24,63`.

**Acceptance criteria**
- [ ] **(unit)** `ReleaseSnapshot.validate_images` rejects a manifest naming an `agent` image; the workflow test asserts exactly one (or zero — see §7) `docker/build-push-action` step remains.
- [ ] **(unit)** `sealedConfig('edge', '')` succeeds and emits no `containers` key; passing a digest fails.
- [ ] **(unit)** `record-receipt` produces an edge entry with an empty `containers` array; mutation evidence that reintroducing the lookup turns a test red.
- [ ] **(api)** one real `Release build` run publishes a snapshot with no agent image, and one real `CD / staging` run deploys it, smokes green and records a receipt.

---

### Card K (#1602) — `ci(repo): move the test-postgres image out of the agent tree` (60 chars)

**No predecessors.** **Epic:** #1259 · **Track:** repo · **Authority:**
`docs/specs/2026-09-05-repo-smell-audit.md:426` — "注意 `apps/agent/docker/test-postgres/Dockerfile`
不随 agent 删". Five CI lanes and one local gate build it.

**Outcome.** The test-Postgres image is built from `packages/test-postgres/`, whose package already
owns the image tag, the readiness wait and the Atlas chain
(`packages/test-postgres/package.json:5`, `postgres-image.env:8`). Nothing under `apps/agent`
remains on any lane that is not a Python lane.

**Scope.** Move `apps/agent/docker/test-postgres/` under `packages/test-postgres/`; update
`.github/workflows/pr-verification.yml:178,361,429,481`, `scripts/local-gates/db-fresh-schema.sh:46`,
`packages/test-postgres/postgres-image.env:8`, `packages/test-postgres/AGENTS.md:85`,
`docs/ops/neon-test-infra.md:30`, `docs/testing-strategy.md:181`, and the contract tests that pin
the literal build command: `.github/test/pr-verification-affected.test.rb:13,15,17,19,69`,
`pr-verification-browser.test.rb:51`, `scripts/local-gates/db-fresh-schema.test.sh:94`.
**Search for both names** — the old path and the new one — before declaring the list complete.

**Acceptance criteria**
- [ ] **(unit)** the workflow contract tests pin the new path in every lane that builds the image, and the old path appears nowhere.
- [ ] **(integration)** `catalog`, `edge-worker`, `migrator`, `@animichi/pi-session-neon` and `@animichi/test-postgres` integration suites are green against the relocated image with an identical tag.
- [ ] **(unit)** `scripts/local-gates/db-fresh-schema.test.sh` is green.

---

### Card L (#1603) — `refactor(eval): freeze the oracle fixtures in the package` (57 chars)

**No predecessors.** **Epic:** #1259 · **Track:** eval · **Authority:** `packages/eval` reaches into
`apps/agent` at three runtime points and inside its own `pnpm test` — see §3.2.

**Outcome.** `@animichi/eval` has no path into `apps/agent`. The oracle fixtures are committed
bytes with no regeneration path, the canonical dataset directory lives inside the eval package, and
the pydantic-evals version pin no longer reads `apps/agent/uv.lock`. This is what "frozen" has to
mean operationally; #1317's "frozen at W3-5" wording additionally has to change, because W3-5 never
produced a Python baseline (§4, row 1).

**Scope.** `packages/eval/package.json:11,13` (remove `test:fixture-drift` from `test`);
`packages/eval/scripts/export-fixtures.sh:36-42,51-55,64` and
`scripts/local-gates/eval-fixture-drift.sh` (delete); `packages/eval/src/gate/case-strata.ts:34`
(copy the datasets into `packages/eval/` and repoint); `packages/eval/src/pins.ts:60-62` (inline the
resolved version); `packages/eval/AGENTS.md:32`; the uv arm of the affected matrix
(`pr-verification.yml:147-165`), which exists solely for this drift gate.

**Acceptance criteria**
- [ ] **(unit)** `pnpm --filter @animichi/eval test` is green with `apps/agent` renamed away on disk — proving no runtime path remains.
- [ ] **(eval)** the committed oracle fixtures still reproduce the same statistical-gate verdicts on the existing recorded inputs; a deliberately perturbed fixture turns the gate red.
- [ ] **(unit)** the affected-matrix contract test asserts no uv setup step for `@animichi/eval`.

---

### Card N (#1607) — `refactor(repo): delete the python agent and its ci lane` (55 chars)

**Blocked by:** I, J, K, L (and D, whichever branch). **Epic:** #1259 · **Track:** repo.

The Python verification lane and the tree it verifies must go in **one** PR: deleting
`apps/agent` while `pr-verification.yml`'s `agent` job still runs `uv run pytest` inside it
(`.github/workflows/pr-verification.yml:330-390`) is a guaranteed red, and deleting the lane first
leaves the tree unverified.

**Outcome.** `apps/agent` is gone, along with everything that existed only to build, test, verify,
generate into or document it.

**Scope.** `git rm -r apps/agent`; the `agent` job (`pr-verification.yml:330-390`) and its
contract test (`.github/test/pr-verification-agent.test.rb`, referenced at
`pr-verification.yml:245`); `.github/workflows/agent-eval-nightly.yml` (wholly Python, `:82-92`);
the `@animichi/agent-python` exclusions (`pr-verification.yml:110`,
`scripts/local-gates/pre-push-affected.sh:40,47,56`); the Python halves of the Makefile
(`Makefile:59-119,146,156-157,247` — note `check`, `lint`, `typecheck`, `test`, `test-integration`
lose their entire bodies, and `dev-local` at `:240,247` starts the container's uvicorn);
`codecov.yml`'s `ignore` entry; `packages/contract/package.json:34` and
`scripts/emit-agent-python.ts`; the Python semgrep rules and fixtures
(`.semgrep/py-*.yaml`, `.semgrep/tests/fixtures/*/py-*.py`) and the ruff/semgrep pre-commit hooks
scoped to Python (`.pre-commit-config.yaml:58-65,122-127`); `.claude/rules/python-types.md`;
`AGENTS.md` (7 refs), `CONTEXT-MAP.md` (3), `README.md`/`README.ja.md`/`README.zh.md` (3 each),
`docs/DOCS_POLICY.md`, `docs/ARCHITECTURE.md`, `docs/ops/deployment.md`, `docs/ops/secrets.md`,
`docs/testing-strategy.md`, `docs/agents/domain.md`. **Keep** `migrations/`, the `agent_svc` role
(`infra/database-access/index.ts:96`), and the relocated test-Postgres image from Card K.

**Acceptance criteria**
- [ ] **(unit)** a root-allowlist / references gate (`scripts/local-gates/check-agents-refs.sh`, run at `pr-verification.yml:326`) is green with no `apps/agent` path anywhere outside `docs/archive` and the two specs that record the history.
- [ ] **(unit)** the workflow contract tests assert no `uv sync`, no `uv run pytest` and no `apps/agent` path in any workflow; `uv tool install` for semgrep and sqlfluff is explicitly permitted and pinned by name, since it is unrelated (`pr-verification.yml:553,618`).
- [ ] **(unit)** `pnpm -r typecheck` and `pnpm -r lint` are green across the whole workspace — not the affected subset, because contract-package changes break combinations the path filter misses.
- [ ] **(integration)** a full `pr-verification` run is green with the `agent` job absent from the required set, and the `aggregate` job (`name: PR Verification`, the required check) no longer names it in `needs` (`pr-verification.yml:654-656`).
- [ ] **(api)** one `Release build` → `CD / staging` cycle is green end to end on the resulting main, smoke included.

---

## 6. The `GET /healthz` ordering constraint, stated exactly

`.github/scripts/staging-smoke-check.sh:88` requests `$BASE_URL/healthz` and `:92` requires
`.status == "ok"`. `$BASE_URL` is the **edge** worker origin (`cd.yml:149`). Today that request is
forwarded into the container (`request.ts:137,154-157`). Therefore:

1. **Card A must merge before Card I.** Not "before the deletion" — before the *container binding*
   removal. Any PR that removes `[[containers]]` or the `CONTAINER` binding while `containerLanding`
   is still the healthz handler produces a Worker that cannot answer `/healthz`, and the
   `Smoke the release` step (`cd.yml:145-149`) fails closed, which blocks `promote-production`
   (`cd.yml:167`) and prevents the staging receipt from being written (`cd.yml:150-163`).
2. **Card A must have been *deployed to staging*, not merely merged, before Card I merges.** The
   smoke probes a live origin. Since every push to main produces a snapshot
   (`release-build.yml:3-4`) and CD deploys a *selected* artifact
   (`cd.yml:4-9`, `.github/scripts/release/resolve.rb`), "merged" and "deployed" are two events
   here, and only the second one satisfies the constraint. Card A's fifth AC is written as an
   `(api)` check against the deployed staging origin for exactly this reason.
3. The production smoke runs the same script against `https://animichi.com` (`cd.yml:281`), so the
   same ordering protects the promote step.
4. `staging-smoke-check.sh`'s *other* probe — `$WEB_URL/` for the `app-splash` marker (`:97,101`) —
   targets the **web** worker, not the edge. Retiring the edge's `GET /` banner (Card A) does not
   touch it. Do not conflate the two.

---

## 7. Collision with #1589 (delete the migrator's Atlas batch container)

Both cards remove one of exactly two images from a snapshot whose validator hardcodes that there
are two. They touch the same lines.

**Shared edit sites**

| File:line | Today | #1589 alone | #1317 Card J alone | Both |
|---|---|---|---|---|
| `.github/lib/release/snapshot.rb:35` | `images.keys.sort == %w[agent migrator]` | `%w[agent]` | `%w[migrator]` | `[]` — at which point the whole `images` key, `validate_images`, `inspect-images.rb`, `registry-login.sh` and `docker/setup-buildx-action` are dead weight and should be **deleted**, not emptied |
| `.github/lib/release/config.mjs:18` | throws unless `edge`/`migrator` carry a `@sha256:` digest | drop `migrator` | drop `edge` | delete the check |
| `.github/lib/release/config.mjs:13` | reseals `containers[]` with the image | unchanged | unchanged | dead — no config has `containers` |
| `.github/workflows/release-build.yml:81-102` | two `docker/build-push-action` steps | one remains | one remains | none — and then `:59-80` (registry login, buildx, ESC registry credential) and `:111` (`inspect-images.rb`) go too |
| `.github/scripts/release/record-receipt.mjs:11-18,27` | `observeContainers` per unit | edge only | migrator only | delete `observeContainers` and `containerIdentity` |
| `.github/lib/release/observations.mjs:13-21` | `containerIdentity` | kept | kept | delete, with `.github/test/release-container-observation.test.rb` |
| `.github/scripts/release/verify-config.mjs:16` | `manifest.images[...] ?? ''` | kept | kept | delete the image argument |
| `.github/test/release-build.test.rb:46-47,58-59` | asserts exactly `%w[agent migrator]` and both Dockerfile paths | one row | one row | assert **no** build-push step exists |
| `.github/test/release-snapshot.test.rb:24-25,63,68` | fixture manifest with both digests | one | one | the fixture loses `images` |

**Recommendation**

- Sequence **#1589 first.** It is smaller, already unblocked by a recorded staging proof (its
  Authority section cites CD run 34679826305), and independent of everything in §5.
- Then Card J becomes "**delete** the container release machinery", not "remove one entry" — a
  cleaner, more reviewable change than two successive edits that each leave a one-element list.
- Do **not** run them concurrently. They conflict textually in nine files and semantically in
  `snapshot.rb:35`, where a naive merge of `%w[agent]` and `%w[migrator]` resolves to a
  syntactically valid, silently wrong assertion.
- The CD identity receipt is the shared blast radius. Both cards change what `record-receipt.mjs`
  writes, and `verify-receipt.rb` reads it in the production job (`cd.yml:203-207`). A receipt
  written by the old script and verified by the new one, or vice versa, is a promote-time failure
  in the ring where failures are most expensive. Land each one through a full
  `Release build → CD / staging` cycle before starting the other.
- Note the one thing #1589 does **not** remove: `record-receipt.mjs:38-43` reads
  `release/migrator/bundle/contract.json` for the Prisma hash. That is the native migration
  contract, not the container, and it survives both cards.

---

## 8. Why the card should be re-scoped, not sequenced as written

1. **Its blocker was dissolved, not satisfied.** #1317 says the Python baseline must exist first.
   It does not. #1303's own thread records the owner declaring the W3 exit **not met** (2026-09-07),
   then dropping the paired comparison (2026-09-08), then closing the card as superseded by
   `docs/specs/2026-09-09-agent-on-pi-harness-spec.md` / #1533 with the baseline recast by #1560
   (2026-09-09). Anything in #1317 that says "frozen at W3-5" is describing a state that was never
   reached. The card's premise needs rewriting before its scope can be trusted.

2. **One of the eleven surfaces is a feature build.** Photo search (§2.9, §2.10) is live in the
   composer, calls a vision model, and has no TypeScript implementation of any kind. It also needs
   a schema migration, because its offer namespace is a process-local dict that a Worker cannot
   have. That is Cards F+G — a feature epic wearing a deletion card's clothes.

3. **The repo has already ruled that container work must be split into revertible cards.**
   `docs/specs/2026-09-05-repo-smell-audit.md:347`: "翻转本身是一张独立卡,不并进 #1317——删容器与
   切生产是两个可回滚点,合成一个就没有回滚." The same argument applies with more force to eleven
   surfaces than it did to one flag.

4. **The card's own "everything only it needed" is wrong about at least one asset**, and the audit
   already wrote the carve-out (`:426`). A deletion card whose scope statement is known to
   over-reach should not be executed as a scope statement.

5. **"One PR" is not satisfiable.** 617 Python files, eleven HTTP surfaces, four of them live, one
   requiring a migration, plus a CI lane, a release pipeline change and a documentation sweep. The
   Quality Ratchet requires `ac_total == ac_with_test` and Codecov patch ≥95% on the diff; a diff
   of that size cannot carry per-AC tests honestly.

**Concrete recommendation.** Convert #1317 into an umbrella under #1259 titled roughly
"W4: retire the Python agent's remaining HTTP surfaces, then delete it", carrying Cards A–N as
sub-issues, and rewrite its body to drop the four stale claims in §4. Keep the card number — its
Spec §五 W4 exit criterion (`docs/specs/2026-09-01-agent-ts-rewrite-spec.md:103`, "repo 无 Python
agent 残留") is still the right exit; it is the single-PR shape and the dissolved prerequisite that
are wrong.

**One thing I did not settle**: `/v1/feedback` (§2.3, Card D). Two Neon queries and one issue
search decide it, and I will not guess.
