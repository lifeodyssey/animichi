# Neon Local Phase-0 Findings

Status: **EXECUTED WITH A NO-GO FOR THE ASYNCPG PROXY PATH.** The lead ran five Python probes plus manual and Node probes on 2026-07-17. Account-plan, kill/orphan, concurrency, and CI observations remain pending and are not inferred below.

Security rule: record database hosts, mapped ports, branch IDs/names, timings, versions, and status classes only. Never paste an API key, password, complete DSN, Authorization header, or raw container environment.

## Environment used by the lead

| Field | Value |
|---|---|
| Date / operator | 2026-07-17 / lead |
| Git commit | Not recorded in the run log |
| `neondatabase/neon_local` image ID/digest | `latest` tag recorded; immutable digest not recorded |
| `ATLAS_VERSION` | `0.30.0` |
| Neon plan | PENDING |
| `test-base` branch ID | Verified by API; value intentionally not recorded |
| Database host only | Neon AP Southeast 1 direct endpoint; local proxy `127.0.0.1:32768`–`32772` |
| Current raw-Postgres testcontainers wall time | PENDING |

## Phase-0 checklist coverage

| ID | Draft v4.1 Phase-0 item | Coverage / lead action | Result | Evidence |
|---|---|---|---|---|
| P0.1 | `GenericContainer(neon_local)` starts with API key, project ID, and resolved `test-base` parent ID; readiness and start-to-ready time recorded | **SCRIPT:** `spike_phase0.py`; bounded asyncpg `SELECT 1` over the mapped PG port | PASS | Five starts; ready in 10.8–28.7 s |
| P0.2 | asyncpg self-signed TLS; PostGIS geo query; `vector(1024)` round-trip; HNSW exists | **SCRIPT:** `spike_phase0.py`; explicit `SSLContext` disables hostname and CA verification only for the local proxy | PASS, UNRELIABLE PATH | PostGIS 3.6, vector 0.8.1, 1024 dimensions, HNSW passed before later proxy disconnects |
| P0.3 | `pg.Pool` connects with `ssl.rejectUnauthorized=false` and round-trips | **SCRIPT:** `spike_phase0_serverless.mjs`, invoked against the Python runner's same container | NOT PROVEN | Final Node evidence proves the `neon()` HTTP arm, not `pg.Pool` stability |
| P0.4 | Ephemeral branch exists; parent is `test-base`; generated name format recorded | **SCRIPT:** `spike_phase0.py`; before/after API branch-set delta plus exact parent verification | PASS | Parent verified; generated `br-<words>-<suffix>` names recorded in the run log |
| P0.5a | Clean stop deletes the ephemeral branch | **SCRIPT:** normal `spike_phase0.py`; polls the branch-by-ID endpoint for 404 | PASS | API returned 404 after every recorded clean stop |
| P0.5b | `docker kill` / Ryuk behavior and orphaning; TTL alternative noted | **SCRIPT:** `spike_phase0.py --kill-test`; uses literal `docker kill`, checks API deletion, then explicitly deletes an observed orphan. **MANUAL:** record whether Neon offers a suitable branch TTL for the generated name pattern | PENDING | PENDING |
| P0.6 | `neonConfig.fetchEndpoint` raw driver query and transaction/batch round-trip through the same container | **SCRIPT:** `spike_phase0_serverless.mjs`; raw `neon()` query plus two statements sharing one `txid_current()` | PASS | Raw `neon()` query and same-transaction batch passed |
| P0.7 | `pg_backend_pid()` stability, prepared reuse, and session `SET` persistence | **SCRIPT:** `spike_phase0.py`; three PID samples, one prepared statement used twice, custom GUC read on a later query | OBSERVED ONCE | One sustained run passed; the proxy later disconnected unpredictably, so this is not a supported fixture path |
| P0.8 | `SET LOCAL ROLE agent_svc` works through the proxy | **SCRIPT:** `spike_phase0.py`; checks `pg_has_role(..., 'SET')` then changes role inside a transaction | INCONCLUSIVE | Proxy closed before the assertion in recorded runs |
| P0.9 | Seed and FK-closed `TRUNCATE ... RESTART IDENTITY` cycle through the serverless driver, without `CASCADE` | **SCRIPT:** `spike_phase0_serverless.mjs`; verifies the 11 baseline tables, conditionally includes Phase-A `route_anime` when present, truncates, and reapplies the two seed statements to 18/43 rows | PARTIAL | Missing FK closure failed loudly, proving the no-`CASCADE` closure requirement; full cycle timing was not recorded |
| P0.10a | Wrong project ID fails actionably rather than hanging | **MANUAL:** forward a deliberately invalid `NEON_PROJECT_ID` to a one-off Neon Local container, keep the real key and parent ID out of command output, cap observation at 120 seconds, and record only exit/status class and elapsed time | PENDING | PENDING |
| P0.10b | Revoked API key fails actionably rather than hanging | **MANUAL:** use a dedicated revoked credential supplied as `NEON_REVOKED_API_KEY`, forward it as container `NEON_API_KEY`, cap at 120 seconds, and record no log text that contains credentials | PENDING | PENDING |
| P0.10c | Insufficient-scope API key fails actionably rather than hanging | **MANUAL:** repeat with a dedicated `NEON_INSUFFICIENT_SCOPE_API_KEY`; record only status class and elapsed time | PENDING | PENDING |
| P0.11 | Pinned Atlas apply succeeds and fully-qualified revisions relation is found | **SCRIPT:** `neon-test-base.sh` requires Atlas 0.30.0 and applies `db/migrations`; `spike_phase0.py` enumerates matching relations outside assumptions about schema name | PASS | Six migrations / 147 statements applied in 4m40s; provisioner must use the `public` revisions schema |
| P0.12 | N=20 latency table, pool/connect cost, projected 59-test wall time, ≤2× arm-default decision, pool-scope decision | **SCRIPT + MANUAL:** Python emits connect, start-ready, p50/p95, and a 59-query lower bound. Lead records current suite wall time, full projected suite time, ratio, and decisions below | PARTIAL | p50 814 ms, p95 1140 ms, 59-query lower bound 48.0 s; raw-suite comparison remains pending, but proxy instability independently selects offline Docker |
| P0.13 | Two simultaneous containers use different mapped ports and independent branches | **MANUAL:** start two one-off containers concurrently with identical forwarded credentials/parent, record their mapped ports and API branch IDs, run one isolated marker query per branch, then stop both and verify both IDs deleted | PENDING | PENDING |
| P0.14 | Current-plan behavior at branch cap is reject vs billed overage | **MANUAL / ACCOUNT-LEVEL:** record the plan shown in Neon Console, standing count before the test, behavior at the documented cap, any billing warning/charge, and cleanup. Do not infer this from pricing copy alone | PENDING | PENDING |
| P0.15 | Minimal GitHub Actions job starts Neon Local with repo secret/variable and runs one query | **MANUAL / CI:** scratch workflow only; same image/env/readiness query, fork-gated, non-gating, with secret masking confirmed. Paste the run URL, not logs containing environment | PENDING | PENDING |
| P0.16 | Provisioner rejects wrong name, project mismatch, branch-ID mismatch, and name-on-ID mismatch before DDL | **SCRIPT:** `scripts/neon-test-base.sh --self-test` covers five pure identity rows without network; actual provision/refresh repeats project and branch-by-ID API checks immediately before obtaining the connection URI | PENDING | PENDING |

## Metrics and decisions

| Metric | Observation |
|---|---|
| Container start → ready | 10,815–28,695 ms across five recorded starts |
| asyncpg connect | 11.2–24.8 ms on successful attempts |
| Simple query N | 20 |
| Simple query p50 / p95 | 813.65 / 1,139.79 ms in the one sustained run |
| `pg.Pool` connect + first query | NOT PROVEN |
| Current raw-Postgres testcontainers suite | PENDING s |
| Projected Neon Local ~59-test suite | ≥48.005 s query-only lower bound; excludes startup, migration, and disconnect retries |
| Projected/current ratio | Not computable without the raw-suite wall time |
| Local default arm decision | Offline Docker; asyncpg proxy instability is a no-go independent of the incomplete ratio |
| Pool scoping decision | Do not pool through Neon Local; CI asyncpg uses the claimed branch's direct cloud endpoint |

## Draft v4.1 documentation gaps

| Gap | Finding | Consequence |
|---|---|---|
| Auto-created branch name format | `br-<words>-<suffix>` observed; fixture ownership now uses an atomic rename claim | Never infer ownership from the generated name alone |
| Clean stop deletion | Every recorded clean stop reached API 404 | API fallback remains necessary for stop failure/orphan handling |
| `docker kill` / Ryuk orphan behavior | PENDING — not executed | Decides whether Phase C needs a cleanup note/cron; record explicit cleanup of any orphan |
| Fully-qualified Atlas revisions relation | Bare URL used Atlas's own schema; the repository contract is `public.atlas_schema_revisions` via `--revisions-schema public` | BYO/read-verify checks the repository-selected public ledger |
| Plan cap semantics: reject or bill | PENDING | Determines whether quota pressure is a clear CI failure or silent cost |

## Go / no-go by dependent piece

| Piece | Decision | Evidence / fallback if NO-GO |
|---|---|---|
| Python asyncpg through Neon Local | NO-GO | Offline Docker locally; direct claimed-branch endpoint in the Neon integration arm |
| Catalog serverless driver / batch | GO | Raw `neon()` query and same-transaction batch passed through the HTTP arm |
| node-postgres `pg.Pool` | NOT PROVEN | Preserve the raw-PG path until a dedicated probe passes |
| Session state / prepared statements | NO-GO THROUGH PROXY | One pass does not overcome repeated mid-operation disconnects |
| Service-role switching | INCONCLUSIVE | Proxy disconnected before the assertion; validate on a supported direct path |
| Local default arm | OFFLINE DOCKER | Proxy instability and observed latency both reject Neon Local as Python default |
| CI viability | PENDING | Do not begin Phase C without a green scratch run |

## Commands used

Run from the repository root. Values remain in the environment and must not be pasted into this file.

```bash
ATLAS_VERSION=0.30.0 scripts/neon-test-base.sh --self-test

NEON_API_KEY="$NEON_API_KEY" \
NEON_PROJECT_ID="$NEON_PROJECT_ID" \
ATLAS_VERSION=0.30.0 \
scripts/neon-test-base.sh provision test-base

cd apps/agent
NEON_API_KEY="$NEON_API_KEY" \
NEON_PROJECT_ID="$NEON_PROJECT_ID" \
NEON_TEST_BASE_BRANCH_ID="$NEON_TEST_BASE_BRANCH_ID" \
uv run --with testcontainers python ../../spikes/neon-local/spike_phase0.py

NEON_API_KEY="$NEON_API_KEY" \
NEON_PROJECT_ID="$NEON_PROJECT_ID" \
NEON_TEST_BASE_BRANCH_ID="$NEON_TEST_BASE_BRANCH_ID" \
uv run --with testcontainers python ../../spikes/neon-local/spike_phase0.py --kill-test
```

The Python runner invokes `spike_phase0_serverless.mjs` before teardown and supplies only `NEON_LOCAL_PORT`, `NEON_LOCAL_DATABASE`, and `NEON_FINDINGS_PATH`; this is how both language probes target the same ephemeral branch.

## Automated run log

The scripts append one row per emitted PASS/FAIL item below.

| Timestamp (UTC) | Mode | Item | Status | Evidence |
|---|---|---|---|---|
| 2026-07-17T08:33:20+00:00 | clean-stop | GenericContainer start and readiness | PASS | image=neondatabase/neon_local:latest; host=127.0.0.1:32768; ready_ms=27145 |
| 2026-07-17T08:33:21+00:00 | clean-stop | Ephemeral branch API identity and name | PASS | parent=test-base; ephemeral_name=br-floral-bonus-ao6dbtmk; branch_exists=true |
| 2026-07-17T08:33:21+00:00 | clean-stop | asyncpg self-signed TLS connection | PASS | connected in 21.8 ms |
| 2026-07-17T08:33:27+00:00 | clean-stop | Ephemeral branch deletion after container exit | PASS | API returned 404 after clean stop |
| 2026-07-17T08:33:27+00:00 | clean-stop | PostGIS, vector(1024), and HNSW | FAIL | not reached: function postgis_version() does not exist HINT:  No function matches the given name and argument types. You might need to add explicit type casts. |
| 2026-07-17T08:33:27+00:00 | clean-stop | N=20 query latency | FAIL | not reached: function postgis_version() does not exist HINT:  No function matches the given name and argument types. You might need to add explicit type casts. |
| 2026-07-17T08:33:27+00:00 | clean-stop | Upstream path session semantics | FAIL | not reached: function postgis_version() does not exist HINT:  No function matches the given name and argument types. You might need to add explicit type casts. |
| 2026-07-17T08:33:27+00:00 | clean-stop | SET LOCAL ROLE agent_svc | FAIL | not reached: function postgis_version() does not exist HINT:  No function matches the given name and argument types. You might need to add explicit type casts. |
| 2026-07-17T08:33:27+00:00 | clean-stop | Atlas revisions ledger discovery | FAIL | not reached: function postgis_version() does not exist HINT:  No function matches the given name and argument types. You might need to add explicit type casts. |
| 2026-07-17T08:33:27+00:00 | clean-stop | Node serverless probe invocation | FAIL | not reached: function postgis_version() does not exist HINT:  No function matches the given name and argument types. You might need to add explicit type casts. |
| 2026-07-17T08:45:23+00:00 | clean-stop | GenericContainer start and readiness | PASS | image=neondatabase/neon_local:latest; host=127.0.0.1:32769; ready_ms=28695 |
| 2026-07-17T08:45:24+00:00 | clean-stop | Ephemeral branch API identity and name | PASS | parent=test-base; ephemeral_name=br-solitary-dawn-aoke8ci5; branch_exists=true |
| 2026-07-17T08:45:24+00:00 | clean-stop | asyncpg self-signed TLS connection | PASS | connected in 22.6 ms |
| 2026-07-17T08:45:34+00:00 | clean-stop | Ephemeral branch deletion after container exit | PASS | API returned 404 after clean stop |
| 2026-07-17T08:45:34+00:00 | clean-stop | PostGIS, vector(1024), and HNSW | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:45:34+00:00 | clean-stop | N=20 query latency | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:45:34+00:00 | clean-stop | Upstream path session semantics | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:45:34+00:00 | clean-stop | SET LOCAL ROLE agent_svc | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:45:34+00:00 | clean-stop | Atlas revisions ledger discovery | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:45:34+00:00 | clean-stop | Node serverless probe invocation | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:48:44+00:00 | clean-stop | GenericContainer start and readiness | PASS | image=neondatabase/neon_local:latest; host=127.0.0.1:32770; ready_ms=25103 |
| 2026-07-17T08:48:48+00:00 | clean-stop | Ephemeral branch API identity and name | PASS | parent=test-base; ephemeral_name=br-misty-voice-aoh0wkum; branch_exists=true |
| 2026-07-17T08:48:48+00:00 | clean-stop | asyncpg self-signed TLS connection | PASS | connected in 24.8 ms |
| 2026-07-17T08:48:57+00:00 | clean-stop | PostGIS, vector(1024), and HNSW | PASS | postgis=3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1; vector=0.8.1; dims=1024; hnsw=True |
| 2026-07-17T08:49:14+00:00 | clean-stop | N=20 query latency | PASS | p50=813.65 ms; p95=1139.79 ms; 59-query lower bound=48005 ms |
| 2026-07-17T08:49:20+00:00 | clean-stop | Upstream path session semantics | PASS | pid_stable=True; prepared_reuse=[2, 3]; session_SET=persisted |
| 2026-07-17T08:49:25+00:00 | clean-stop | Ephemeral branch deletion after container exit | PASS | API returned 404 after clean stop |
| 2026-07-17T08:49:25+00:00 | clean-stop | SET LOCAL ROLE agent_svc | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:49:25+00:00 | clean-stop | Atlas revisions ledger discovery | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:49:25+00:00 | clean-stop | Node serverless probe invocation | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:53:30+00:00 | clean-stop | GenericContainer start and readiness | PASS | image=neondatabase/neon_local:latest; host=127.0.0.1:32771; ready_ms=28609 |
| 2026-07-17T08:53:31+00:00 | clean-stop | Ephemeral branch API identity and name | PASS | parent=test-base; ephemeral_name=br-wild-term-ao4ie6ln; branch_exists=true |
| 2026-07-17T08:53:31+00:00 | clean-stop | asyncpg self-signed TLS connection | PASS | connected in 11.2 ms |
| 2026-07-17T08:53:40+00:00 | clean-stop | PostGIS, vector(1024), and HNSW | PASS | postgis=3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1; vector=0.8.1; dims=1024; hnsw=True |
| 2026-07-17T08:53:45+00:00 | clean-stop | Ephemeral branch deletion after container exit | PASS | API returned 404 after clean stop |
| 2026-07-17T08:53:45+00:00 | clean-stop | N=20 query latency | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:53:45+00:00 | clean-stop | Upstream path session semantics | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:53:45+00:00 | clean-stop | SET LOCAL ROLE agent_svc | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:53:45+00:00 | clean-stop | Atlas revisions ledger discovery | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:53:45+00:00 | clean-stop | Node serverless probe invocation | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:55:08+00:00 | clean-stop | GenericContainer start and readiness | PASS | image=neondatabase/neon_local:latest; host=127.0.0.1:32772; ready_ms=10815 |
| 2026-07-17T08:55:09+00:00 | clean-stop | Ephemeral branch API identity and name | PASS | parent=test-base; ephemeral_name=br-icy-glitter-ao6meo4x; branch_exists=true |
| 2026-07-17T08:55:09+00:00 | clean-stop | asyncpg self-signed TLS connection | PASS | connected in 12.7 ms |
| 2026-07-17T08:55:24+00:00 | clean-stop | Ephemeral branch deletion after container exit | PASS | API returned 404 after clean stop |
| 2026-07-17T08:55:24+00:00 | clean-stop | PostGIS, vector(1024), and HNSW | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:55:24+00:00 | clean-stop | N=20 query latency | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:55:24+00:00 | clean-stop | Upstream path session semantics | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:55:24+00:00 | clean-stop | SET LOCAL ROLE agent_svc | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:55:24+00:00 | clean-stop | Atlas revisions ledger discovery | FAIL | not reached: connection was closed in the middle of operation |
| 2026-07-17T08:55:24+00:00 | clean-stop | Node serverless probe invocation | FAIL | not reached: connection was closed in the middle of operation |

---

## Phase-0 EXECUTION VERDICT (2026-07-17, lead-run, 5 python runs + manual probes + node probe)

**PROVEN (adopt):**
1. Container lifecycle = branch lifecycle: start→ephemeral branch (parent verified via API, name recorded), clean stop→auto-DELETE (API 404). Kill/orphan probe still pending.
2. Branches inherit the full parent schema: PostGIS 3.6, vector 0.8.1 (1024 dims), HNSW, PG 18.4.
3. **The serverless-HTTP arm through Neon Local is STABLE**: raw neon() query + transaction batch (shared txid) both pass — this is the arm Neon Local is FOR.
4. TRUNCATE without its FK closure fails loudly (probe hit "referenced in a foreign key constraint") — empirically confirms the spec's no-CASCADE FK-closure design is mandatory.

**REJECTED (redesign Phase A around this):**
5. **The asyncpg wire arm through Neon Local's proxy (Envoy→PgBouncer) is UNRELIABLE**: psql (simple query protocol) is 100% stable across all probes; asyncpg (extended query protocol, even with statement_cache_size=0) dies with "connection was closed in the middle of operation" at unpredictable points (after 48s of queries in one run; after 8 queries in a controlled trial; immediately in others). plaintext → ProtocolViolation; direct_tls → timeout. Root cause localized to the proxy chain's handling of the extended protocol.
   → Phase-A consequence: the python integration arm must NOT query through the local wire proxy. Locally: offline Docker arm (postgis+pgvector image). In CI: use the container for BRANCH LIFECYCLE only and connect asyncpg to the ephemeral branch's DIRECT cloud endpoint (resolved via the Neon API), or create/delete the branch via API in the fixture.

**BUDGET CORRECTIONS:**
6. atlas migrate apply (6 migrations, 147 stmts incl. 2.6MB gazetteer): **4m40s** over the wire (spec said 1-3min). All timeouts ≥10min.
7. Wire-path query latency (one sustained run): p50=814ms, p95=1140ms per query from this machine to ap-southeast-1 — ~10x the spec's assumption. Local default arm = offline Docker (per the spec's own ≤2x decision rule).

**OPS NITS:**
8. Ledger location empirical: bare-URL atlas defaults to its OWN schema (atlas_schema_revisions.atlas_schema_revisions); preview.yml uses --revisions-schema public. The provisioner MUST pass --revisions-schema public to match (it did not — fixed requirement).
9. After migrations create service roles, `neonctl connection-string` requires explicit `--role-name neondb_owner --database-name neondb` (multi-role branches refuse to guess).
10. `statement_cache_size=0` is NECESSARY for any asyncpg through PgBouncer, but NOT SUFFICIENT for the local proxy (see 5).
