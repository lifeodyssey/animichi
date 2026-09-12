# Evidence inventory — platform over hand-written, repo-wide

Produced 2026-09-12 against `origin/main` (`e697aa84`), as the evidence base for
[ADR 0008](../../adr/0008-platform-over-handwritten.md). Buckets are that ADR's:
Buckets cover every **in-scope** hand-written mechanism. Language ports are excluded — see the excluded section at the end.

**A** = an adopted dependency or platform feature already does this · **B** = it does part of it and
the gap is real, adjudicated per case in #1593 · **C** = the platform genuinely lacks it, hand-written
is correct.

A snapshot, not a worklist. Cards come from it one at a time.

## 0. What ADR 0006 fixed

| dir | files now | lines now | ADR 0006 (2026-09) | delta |
|---|---|---|---|---|
| `.github/scripts` | 18 | 772 | 108 / 10,586 | **−90 files / −9,814** |
| `.github/actions` | 2 | 37 | 11 / 851 | **−9 / −814** |
| `scripts/local-gates` | 20 | 2,264 | 39 / 4,559 | **−19 / −2,295** |
| `.github/workflows` | 4 | 1,176 | 5 / 949 | −1 / +227 |

The "affected router written three incompatible times" is now one platform-native implementation
(`pr-verification.yml:100-121`, `pnpm ls -r --filter "...[$merge_base]"` + `dorny/paths-filter@v4`).
**The evidence base for a repo-wide ADR is now mostly outside `.github/`.**

## A — the platform already does this

| what | path:line | lines | already-adopted equivalent |
|---|---|---|---|
| Hand-written router, path-template→regex, CORS, cookie parsing, behind one `app.all("*")` | `workers/edge/src/app.ts:57` · `gateway/routing-policy.ts:38-42` · `request-class.ts` · `agent-tier-route.ts` · `gateway/request.ts:122-132` · `rate-policy.ts:82-86` (byte-duplicate of `routing-policy.ts:38-42`) · `proxy/tiles.ts:74-95` · `identity/anonymous-id.ts:36-42` + `turnstile-pass.ts:6-12` | ~393 | `hono` 4.13.7 — a **direct dependency**, imported in exactly one place and used only as `new Hono().all("*")`. `workers/catalog`, `workers/users` and `workers/migrator` all use its router properly |
| Regex TypeScript scanner counting function/class/file lengths | `workers/catalog/scripts/enumerate-1050.ts:1-226` | 226 | `oxlint` `max-lines` / `max-lines-per-function` / `max-classes-per-file` — verified to exist and fire on the installed 1.75.0. The script is referenced by no gate |
| Regex line-parsing of `wrangler.toml`/`.jsonc` + hand-rolled `posixJoin` | `workers/catalog/scripts/worker-entry-exports.ts:5-8,33-43` + `check-worker-entry-exports.ts` | 126 | `smol-toml` (devDep of `workers/edge`, `packages/agent`), `jsonc-parser` (devDep of `apps/web`), and `node:path` `join` — **imported at line 2 of the sibling file** |
| Per-spec Playwright setup copy-pasted into 11 specs | `e2e/web-chat-anonymous.spec.ts:26` + 10 siblings | ~80 | `@playwright/test` `test.extend<T>()` — zero hits across `e2e/**` |
| 45 `ruby <file>` + 12 `bash <file>` lines as the only runner for two test suites | `.github/workflows/pr-verification.yml:232-310` | ~57 | minitest discovery / `bats -r`. A new test file nobody adds to the list silently never runs |
| Manual `isinstance`-chain parsing of Neon Admin API JSON | `apps/agent/.../tests/neon_api.py:42-99` | 58 | `pydantic.BaseModel` / `TypeAdapter`, used pervasively in the same codebase |
| Hand-rolled mutation lifecycle (idle/saving/saved/failed) | `apps/web/src/api/hooks/use-saved-route.ts:74-127` | 54 | `@tanstack/react-query` `useMutation` + `@orpc/tanstack-query` `.mutationOptions()`. `useMutation` appears nowhere in `apps/web`; every sibling hook already uses `useQuery` + `.queryOptions()` |
| Unit test asserting the lockfile specifier matches `package.json` | `apps/web/tests/unit/lockfile-pin.test.ts:38-48` | 49 | `pnpm install --frozen-lockfile`, already run by `setup-workspace/action.yml:12`. Line 45 hardcodes a version, so a legitimate bump fails a web unit test |
| Bearer-token admin guard, written twice | `workers/catalog/src/import/admin-routes.ts:54-85` · `api/snapshot.ts:42-47` | 38 | `hono/bearer-auth` `bearerAuth()` |
| Raw `http.client.HTTPSConnection` with manual status branching | `apps/agent/.../tests/neon_api.py:165-181` | 17 | `httpx` — adopted, used in every other outbound path here |
| Manual `AbortController` + `setTimeout` + `Promise.race` deadline | `workers/edge/src/protect/guard-call.ts:45-63` | 19 | `AbortSignal.timeout()` — used correctly by the same package at `protect/turnstile.ts:86` |
| Hand-rolled "constant-time" compare | `workers/catalog/src/lib/timing.ts:1-13` | 13 | `timingSafeEqual` from `hono/utils/buffer`. **Ours is weaker**: line 9 returns early on length mismatch, leaking the length its own doc comment says it protects |
| Hand-rolled lat→Mercator-Y projection | `apps/web/src/features/map-spike/geometry.ts:14-25` | 12 | `maplibre-gl` `MercatorCoordinate.fromLngLat()` |
| `docker ps`/`docker inspect` shell-out for a container IP | `packages/agent/integration-test/catalog-postgres.ts:32-39` | 8 | `testcontainers` `getIpAddress()` — same file imports `GenericContainer` correctly one function above |
| Hand-rolled email-format regex | `apps/web/src/features/auth/ui/use-magic-link-form.ts:20-24` | 5 | `zod` `z.string().email()`, used in the same feature |
| Three regexes to read `compatibility_date` from `wrangler.toml` | `workers/edge/bundle-smoke/wrangler-bundle.ts:31-35` | 5 | `smol-toml` — devDep of this package, **already imported by the sibling file in the same directory** |
| `sed` regex to read a Pulumi stack-config value | `infra/database-access/reset-staging-baseline.sh:19-22` | 4 | `js-yaml`, declared in `infra/database-access/package.json:21`. Returns `""` silently on quoting drift |

## B — semantics insufficient; adjudicate in #1593

Do not action any row here. Each needs the five admission facts #1593 requires.

| what | path:line | lines | equivalent | the gap |
|---|---|---|---|---|
| Hand-rolled bash test framework repeated across 15 files | `scripts/local-gates/test-stub.sh:1` · `stub-env.sh:1` · 9 × `scripts/local-gates/*.test.sh` · 2 × `.github/scripts/*.test.sh` · `scripts/delivery/migrate-through-worker.test.sh:1` · `workers/edge/scripts/check-edge-ratelimit-namespace.test.sh` · `.claude/hooks/check-pr-comments.test.sh` | **2,215** | `bats-core` | **Moved out of A on review.** `minitest` is adopted and runs 43 equivalent gate tests, but it executes **Ruby** — it provides neither bash discovery nor bash assertion semantics, so it is not an adopted equivalent under A's own test. `bats-core` is the direct equivalent and is **not adopted**. Largest single item in the inventory; goes to #1593 rather than being decided by the principle |
| OpenAPI breaking-change engine | `packages/contract/src/openapi-diff.ts` · `openapi-schema-diff.ts` · `operation-set.ts` · `openapi-vet.ts` · `openapi-changes.ts` | **830** | `oasdiff` | Not adopted, so not A under this ADR's reading. Could not confirm oasdiff covers our rule that a `/v2/…` path requires the superseded operation to carry `deprecated: true` **and** `x-sunset` |
| ~~From-scratch Atlas apply engine, ledger, quote-aware SQL splitter~~ **CLOSED 2026-09-12** | `workers/migrator/src/http-apply.ts` · `sql-split.ts` · `ledger.ts` · `preflight-ledger.ts` · `chain.ts` · `sql.ts` (+5 modules the first count missed; ≈812 not 644) | ≈812 | Atlas CLI + its own ledger and advisory lock | **Not** "Workers cannot exec a subprocess" — the connectivity spec refuses that claim. The cause was that **5432 from the migrator container never completed TLS to Neon**, so Option 2 abandoned the port, and that spec's decision 5 then required the Worker to keep writing `atlas_schema_revisions` with Atlas v0.30 semantics. **Resolved by retiring Atlas**: Prisma 8 owns the database layer and `ControlClient.migrate` replaces these modules. See ADR 0008 §5 entry 1 |
| Exact per-identity rate counter on a DO | `workers/edge/src/protect/rate-limiter.ts` + `edge-guard.ts` | 364 | Cloudflare `RATE_LIMITER` binding | Already used for the coarse tier, whose own comment calls it best-effort. No single-key atomic strongly-consistent count |
| zod/oRPC → Pydantic code generator | `packages/contract/scripts/emit-agent-python.ts:1-346` | 346 | `datamodel-code-generator` over the emitted OpenAPI | Not adopted; and `agent-openapi.json` is hand-built from an inventory with no component schemas for it to consume |
| Regex classification of `pulumi preview` stdout | `scripts/local-gates/infra-check.sh:44-179` | 179 | `pulumi preview --json` | Could not confirm the JSON carries severity structurally; and structured severity still would not separate "credentials absent locally" (green) from a real error |
| Reference-integrity checkers over bare `docs/...` tokens in prose | `scripts/local-gates/check-docs-paths.sh` + `check-agents-refs.sh` | 221 | `lychee --offline`, markdown-link-check | These check bare tokens in comments and quoted spans, not `[text](path)` links. Second hand-rolled generation, per the script's own comment |
| SSE producer with bounded post-disconnect grace | `apps/agent/.../routes/chat_stream.py` | 156 | `sse-starlette` `EventSourceResponse`, used correctly for framing at `chat.py:246` | Library ties producer lifetime to response iteration; cannot express "run 250 ms past disconnect, then detach for later settlement" |
| Container lifecycle poll/timeout state machine | `workers/migrator/src/runner.ts:39-192` | 154 | `@cloudflare/containers` `Container` | Currently dead (tests only). Could not verify the library ships an equivalent bounded monitor |
| Live-vs-live pixel diff + cluster boxes | `e2e/visual/diff.ts:1-124` | 124 | `@playwright/test` `toHaveScreenshot` | Playwright compares against a committed baseline; tier 2 compares two buffers from the same run. Cluster boxes have no equivalent |
| Manual `X-BYOK-*` header parsing as free functions | `apps/agent/.../byok_models.py:89-195` | 107 | `pydantic.BaseModel` + FastAPI `Depends()` | Documented at `_deps.py:194-206`: a `Depends()`-resolved parameter lands in the dict `logfire.instrument_fastapi()` captures, putting the BYOK key on a span |
| `CompactToolReturns` | `apps/agent/.../history_compaction.py:127-212` | 86 | `pydantic_ai_harness.compaction.ClearToolResults` (adopted) | Harness `placeholder` is a static string with no hook for per-tool summarization or for rescuing an argument before discard |
| Recursive hand-written JSON validation | `packages/eval/src/gate/baseline-record.ts:68-183` | ~80 | `zod` `.strict().safeParse()` | zod is not declared in `packages/eval/package.json` |
| Bounded `SELECT 1` retry after container start | `packages/test-postgres/src/postgres-startup-wait.ts:1-73` | 73 | `testcontainers` `Wait.*`, already composed at `test-postgres.ts:45-50` | Documented (#1324): postgis binds TCP before accepting sessions (SQLSTATE 57P03). Both wait strategies settle on container-external signals. `@testcontainers/postgresql` is **not installed** |
| Head-of-response timeout via manual race | `workers/edge/src/gateway/container-fetch.ts:89-159` | ~70 | `AbortSignal.timeout()` | Ordering the library cannot express: the 504 must resolve **before** `abort()`, or fetch's rejection wins. Pinned by `container-fetch-timeout.test.ts` |
| Manual row-shape narrowing over drizzle | `workers/users/src/adapters/neon-saved-route-repo.ts:17-53` + `neon-idempotency-store.ts:9-40` | 69 | `drizzle-orm` typed query builder | Statements are typed but executed via `db.execute()`, whose neon-http result is `{rows: unknown[]}` |
| Focus trap + Escape-to-close | `apps/web/src/features/auth/ui/LoginModal.tsx:15-64` | 50 | `animal-island-ui-tailwind` `Modal` (Radix) | `ModalProps` exposes no `onOpenAutoFocus`; and the package's ESM bundle vendors its own `react-dom`, crashing against React 19 — why `apps/web/AGENTS.md` bans its React components |
| Durable "pending" park + hourly cron drain | `workers/catalog/src/ingest/jobs.ts:54-57,90-97` + siblings | ~44 | `ExecutionContext.waitUntil` | No delivery guarantee, retry or persistence across eviction. Queues/Workflows would close it but are not adopted |
| Two local copies of the affected-package selector | `scripts/local-gates/pre-push-affected.sh:38-46` + `oxlint-changed.sh:11-26` | 94 | `pnpm --filter "...[<ref>]"`, used natively by CI | Both cite pnpm/pnpm#12626 — the selector answers nothing from a nested worktree. Residual duplication is between the two local variants |
| JSON body shape check | `workers/migrator/src/preflight-metadata.ts:55-76` | 22 | zod | zod is not a `workers/migrator` dependency |
| RFC 9562 UUIDv7 generator | `workers/users/src/adapters/neon-atomic-commit.ts:71-92` | 22 | Neon `uuidv7()` (already the column default) | `db.batch()` over neon-http has no round trip between statements; `randomUUID()` is v4 |
| Async submit state machine | `apps/web/src/features/auth/ui/use-magic-link-form.ts:61-80` | 20 | React 19 `useActionState` | Documented invariant (#437/#465): `onSendCommitted` must fire synchronously at dispatch |
| DO mutex serializing `/migrate` | `workers/migrator/src/apply-lock.ts:16-28` | 13 | Atlas's Postgres advisory lock | Different reach: DO-scoped vs DB-scoped |
| Import-free env-pair validation | `packages/contract/src/access-service-token.ts:90-104` | 13 | zod `.superRefine()` | Deliberately import-free for its consumers — a footprint constraint, not an expressiveness gap |
| Promise-chain single-flight queue | `workers/edge/src/agent/host/session-agent.ts:38,73-82` | 12 | DO `blockConcurrencyWhile` / input gating | Would block alarms and the deliberately-concurrent fast-path reads; input gating does not serialize await-crossing continuations |
| "Drain until 3 quiet ticks" after mocked registration | `infra/testing/harness.ts:88-92` | 5 | `@pulumi/pulumi` `runtime.setMocks` | Registration under mocks is fire-and-forget RPC with no settled signal |

## C — the platform genuinely lacks it

Correct as written. Each must name what the platform lacks, in the code.

| what | path:line | lines | what is missing upstream |
|---|---|---|---|
| SSRF pre-flight + DNS-pinning transport + response cap | `apps/agent/.../egress_guard.py` + `egress_transport.py` | **498** | httpx/FastAPI/pydantic-ai ship no SSRF, DNS-rebinding or TOCTOU protection |
| GitHub OIDC verify + claims allowlist | `packages/contract/src/oidc-github.ts` + `workers/migrator/src/policy.ts` | 244 | Workers have no OIDC federation — **the ADR 0006 §3.5 calibration exception** |
| Regex HTML canonicalization | `e2e/visual/canonicalize.ts:1-188` | 188 | `e2e/package.json` declares no HTML parser |
| Exact binomial CI (Clopper-Pearson) | `packages/eval/src/gate/clopper-pearson.ts` | 166 | `logfire`'s evals module ships no baseline/regression/CI machinery (verified against its `.d.ts`) |
| SSRF host classification for the TS tier | `packages/agent/src/host-address.ts` | 161 | workerd exposes no DNS resolver |
| Lossless JPEG EXIF-stripping walker | `apps/web/src/lib/exif-strip.ts` | 162 | Survey recorded in the file header: Node-stream-only, unmaintained, or lossy |
| Zero-dependency PNG chunk codec | `e2e/visual/png.ts` | 160 | No PNG package in the workspace; Playwright's bundled `pngjs` is not a published subpath |
| Hand-written i18n core | `apps/web/src/i18n/*` + `lib/i18n/locale-storage.ts` | 164 | Zero i18n/intl dependency in `apps/web` |
| Bounded backoff with `Retry-After` | `workers/catalog/src/ingest/retry.ts` | 131 | No retry library adopted; Workers `fetch` has none |
| Stratified paired bootstrap | `packages/eval/src/gate/paired-bootstrap.ts` | 129 | No adopted dep has one |
| Smoke probe on response-body semantics | `.github/scripts/staging-smoke-check.sh` | 118 | `curl --retry` retries transport/status, not body semantics |
| BYOK redaction before `console.*` | `workers/edge/src/agent/egress/secret-scrub.ts` | 108 | No Workers-side request-layer redaction middleware exists |
| Container egress denylist as IP-literal globs | `workers/edge/src/container/container-env.ts:59-140` | ~82 | `deniedHosts` is hostname glob — no CIDR, no DNS |
| Root-directory allowlist gate | `scripts/local-gates/check-root-allowlist.sh` | 81 | No linter enforces it |
| Container cold-start fetch retry | `workers/edge/src/gateway/container-fetch.ts:14-87` | 74 | `@cloudflare/containers` retries container **start**, never the subsequent `tcpPort.fetch()` |
| Regenerate-and-diff drift checks | `scripts/local-gates/contract-drift.sh` + `eval-fixture-drift.sh` | 75 | No tool does "regenerate X, diff against the committed copy" |
| Single-key snapshot pointer | `workers/catalog/src/publish/pointer.ts` | 56 | R2 has only atomic single-key PUT |
| Cycle-safe deep equality | `apps/web/src/features/chat/tool-steps.ts:44-72` | 29 | No deep-equal among adopted deps |
| TOML extraction for `pyproject.toml` | `test/repo-config/lint-scope.test.rb:34-58` | ~24 | No TOML gem in the Ruby toolchain |
| `Range:` header parsing | `workers/edge/src/proxy/tiles.ts:138-156` | 19 | R2 takes `{offset,length}`; Workers has no Range parser |
| Periodic SSE keep-alive | `workers/edge/src/agent/views/watch-response.ts:27-43` | 17 | AI SDK `createUIMessageStream` has no heartbeat |
| jsdom `matchMedia`/`ResizeObserver` stubs | `apps/web/tests/setup/viewport-hermetic.ts` | 16 | jsdom implements neither |
| Cron-string → job-kind lookup | `workers/catalog/src/import/schedule.ts:22-29` | 8 | `ScheduledController` exposes only the cron string |

## Excluded from A/B/C — recorded decisions

These are hand-written because a recorded ADR says so. They carry no bucket: C means *the platform
genuinely lacks it*, and the reason these exist is a decision, not an absence. ADR 0008 states it is
not retroactive over them.

| what | path | lines | the decision |
|---|---|---|---|
| Release admission, tar-slip validation, source closure | `.github/lib/release/*.rb` | ~400 | [ADR 0007](../../adr/0007-selected-release-artifacts.md) — "Repository policy adds admission checks…" on top of GitHub's artifact primitives |
| OIDC-minted migration handshake | `scripts/delivery/migrate-through-worker.sh` | 137 | [ADR 0006](../../adr/0006-platform-over-handwritten-ci.md) decision 6 — CI never holds a database credential, even short-lived |

The GitHub OIDC verifier (`packages/contract/src/oidc-github.ts` + `workers/migrator/src/policy.ts`)
deliberately **stays in C**, even though ADR 0006 §3.5 also records it. It is both: Cloudflare Workers
genuinely have no OIDC federation, *and* the ADR records the resulting split (Pulumi Cloud does have
federation, so we use theirs). It is C's calibration example, which is why it belongs there rather
than here.

## Excluded from A/B/C — language ports

ADR 0008 does not reach these, so they carry no bucket. Classifying them as C would be wrong: C means
*the platform genuinely lacks it*, and no platform is being asked for anything here. What is being
reproduced is another **language's** behaviour, deliberately, so two implementations of the same gate
produce diffable numbers.

| what | path | lines | why it exists |
|---|---|---|---|
| CPython MT19937, bit-for-bit | `packages/eval/src/gate/python-random.ts` | 148 | The TS gate's bootstrap must be comparable against the Python one's |
| Shewchuk exact summation (`math.fsum`) | `packages/eval/src/gate/python-sum.ts` | 98 | Naive `+=` drifts enough to flip a bisection step in `clopper-pearson.ts` |
| Python `format(v,'.Nf')` round-half-even | `packages/eval/src/gate/python-number-text.ts` | 86 | `toFixed` rounds half-away-from-zero; worked example in-file: `0.15625` → Python `"0.1562"`, JS `"0.1563"` |

**These have a closing window, which is the part that matters.** `stats-oracle.ts:9-13` names its source
as the Python side's own answers, produced by `stats_oracle.py` running the real `stats.py`/`gate.py`;
#1607 deletes `apps/agent` and takes that source with it. So whether the ports have served their
purpose must be decided **before #1607 merges**, and #1603 is where it lands.

## Two things the principle does not reach

**A language port, not a platform duplication.** `packages/eval/src/gate/**` is ~1,736 TS lines
twinning ~656 Python lines so the two gates produce diffable numbers. Nothing upstream is being
duplicated. ADR 0008 says so explicitly.

**Test mass.** ~124,000 lines of test code against ~62,000 of source (`apps/agent` alone: 54,761 vs
25,012), and several tests exist only to keep hand-copied literals in sync. That is a cousin of this
principle, not this principle.
