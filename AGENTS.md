# Animichi — AGENTS.md

Canonical repo guide for agentic coding tools. Claude Code reaches this via `CLAUDE.md`
(`@AGENTS.md`); the 30+ AGENTS.md-native tools read it directly. Keep it under ~200 lines —
stack-specific rules live in per-package `AGENTS.md` files and in `.claude/rules/` (below).

Animichi is an anime pilgrimage search + route-planning service. **Hybrid microservices**:
TypeScript Cloudflare Workers (the edge Worker's gateway + native Pi agent tier, catalog, users,
migrator) + a TanStack web app. The Python PydanticAI agent was retired with its CI lane (#1607).
Data plane = Neon;
auth = **Neon Auth (Better Auth) integrated in `apps/web`** (SD-31); the edge verifies Neon Auth
JWTs only (AUTH-2 #950 hard cut — Supabase verification deleted); the users worker trusts only the
edge-forwarded identity. **Do not add Supabase-auth or self-verification code**.

## Monorepo layout

- `workers/catalog/`   — TS Worker: anime catalog API + data platform (ingest/enrich/publish). → `workers/catalog/AGENTS.md`
- `workers/users/`     — LIVE Hono/oRPC user-data Worker over Neon; verifies nothing itself (no `jose`) — it trusts the edge-forwarded identity; 13 `test/*.worker.test.ts` files + CI lane. → `workers/users/AGENTS.md`
- `packages/agent/`    — Platform-independent TS agent domain library (`@animichi/agent`), consumed by edge. → `packages/agent/AGENTS.md`
- `packages/contract/` — Shared oRPC/zod contract; cross-service source of truth. → `packages/contract/AGENTS.md`
- `packages/eval/`     — Node native Pi task and preserved statistical oracles with `logfire/evals`. → `packages/eval/AGENTS.md`
- `packages/pi-session-neon/` — Native Pi session storage (`NeonStorage`/`NeonSessionRepo`) and the data plane's one Prisma 8 chain (`migrations/`), the whole migration authority (#1636). → `packages/pi-session-neon/AGENTS.md`
- `packages/prisma-geography/` — Private Prisma 8 PostGIS geography extension pack; control/runtime descriptors and disposable-DB evidence. → `packages/prisma-geography/AGENTS.md`
- `packages/test-postgres/` — Test-only Postgres data plane (image, readiness wait, clean DB, the Prisma chain, the five service roles) shared by every database-backed suite. → `packages/test-postgres/AGENTS.md`
- `apps/web/`          — TanStack Start SSR app; **the only browser surface** (legacy `frontend/` retired, #537). → `apps/web/AGENTS.md`
- `workers/edge/`      — CF edge worker (`workers/edge/src/entry.ts`): the gateway (auth, `/v1` routing, the image/tile proxies incl. the private `docs-assets` arm at `/img/docs/*`; no page fallback — unmatched paths 404) **and**, the native Pi agent tier (`workers/edge/src/agent/`: authenticated admission → `SessionAgent` → Neon settlement) — most of the package's source is now that tier. → `workers/edge/AGENTS.md`
- `workers/migrator/`  — TS Worker that applies the one Prisma chain (bundled into the Worker) behind GitHub OIDC; `supabase/` is an archived historical migration dir (issue #1000), not a live surface. → `workers/migrator/AGENTS.md`
- `e2e/`               — Playwright browser suite for `apps/web`. → `e2e/AGENTS.md`
- `infra/`             — Pulumi Cloudflare IaC. → `infra/AGENTS.md`

## Package managers

- **pnpm 12** workspace for all TypeScript (`pnpm-workspace.yaml`). **uv** only installs the pinned
  semgrep lint tool. **Bundler** runs the Ruby contract suites: install `.ruby-version`'s Ruby
  (rbenv, mise and asdf read it), then `bundle install` and `bundle exec ruby <file>` — the
  `contracts` job's form; it refuses other Rubies.
- **Every setting lives in `pnpm-workspace.yaml`** — pnpm 11 moved them here out of `.npmrc` and
  removed the `package.json#pnpm` field; pnpm 12 rejects a key it does not recognise and ignores a
  kebab-case one. Keys are camelCase, and the workspace file is the only settings surface — there is
  no `.npmrc`. CI installs with `--frozen-lockfile`.
- **Catalogs are the version surface.** Every external dependency two or more importers declare is
  defined once in the default `catalog:` and referenced as `catalog:`; `catalogMode: strict` refuses a
  `pnpm add`/`pnpm update` that asks for a version outside a catalog entry. Add the catalog entry
  first, then reference it — `test/repo-config/pnpm-workspace-settings.test.rb` fails otherwise.

## Core commands (from repo root)

- `make check-full`    — every package's lint + typecheck + test + test:integration, the fresh-schema
  apply and the catalog spike. **Run before AND after a change that spans packages**; a single
  package's own scripts are the loop for anything narrower.
- `make dev-local`     — the web app, one command (never start services individually). Login is Neon Auth (AUTH-2 #950).
- `make local-login`   — browser magic-link login for local dev.
- `make e2e-setup` then `make e2e` — Playwright E2E (details in `docs/testing-strategy.md`).
- `pnpm run test:worker` — edge worker tests. Per-package commands live in that package's `AGENTS.md`.

## Cross-stack guardrails (apply everywhere)

- **1-10-50**: functions ≤10 lines, classes ≤50, files ≤300; ≤2 indent levels (early-return / extract).
- **No `any`** in TypeScript — model the shape.
- **Never request a third-party upstream from a test, a script, or a development machine.**
  `api.anitabi.cn` and `image.anitabi.cn` are reached only by the deployed egress service, and only
  in the shapes `docs/api-reference/anitabi-api.md` describes — that document is the authority, and
  anything it does not describe is not permitted. Tests stub the upstream; to see a real response,
  read the pinned document. We are rate-limited by agreement and have already been refused once, so
  an exploratory `curl` spends a relationship rather than a request.
- **No suppression without user approval** — no `eslint-disable` / `@ts-ignore` / `type: ignore` /
  `noqa` / `pragma: no cover` / `continue-on-error` / `skip`. Fix the code; don't silence the rule.
- **TypeScript gate** — TypeScript 7.0.2 direct + type-aware oxlint/tsgolint with
  `--deny-warnings` across every package. ESLint left the repo with `frontend/` (#537).
- **Coverage floors ratchet UP only** — `apps/web` floors live in `apps/web/vitest.config.ts` (mirrored in `apps/web/AGENTS.md`).
- **Test quality**: mock the clock (no timing-dependent asserts); no conditional logic in tests
  (split them); ≤200 lines per test file; ≤5 mocks per test.
- **No local deploy** (`block-local-deploy`, an owner-local rule — see Harness) — CD only: a push to
  `main` builds a complete immutable release snapshot and dispatches CD for that snapshot's own
  artifact ID; a manual dispatch can still select another existing `artifact_id`. CD deploys it to
  staging, then promotes the same digests after the actual production job's GitHub environment
  approval. Main commits may be skipped; there is no tag deployment path.
  Platform activation prerequisites and operator steps → `docs/ops/deployment.md`.

## Commit and PR hygiene

- Historical bloat came from merge-carried branch WIP, PR-per-repair loops, commit-on-agent-stop
  behavior, and no message/title gate. Fix that workflow; a prettier vague subject is not enough.
- A commit is an independently reviewable, reversible outcome — never an agent checkpoint, handoff,
  review reply, formatter pass, or CI retry. Do not commit merely because a sub-agent stopped.
- Keep one issue/card outcome in one PR. Fold related fixes into that PR; do not open another PR for
  its review comments or gate repairs. Before the first push, amend an unpushed commit instead of
  stacking repair commits; after a push, add fixes to the same PR and let GitHub squash-merge it.
- Commit subjects and PR titles use `<type>(<scope>): <short outcome>` (scope optional), imperative
  lowercase after the colon, preferably ≤50 characters and always ≤72. Put `Refs: #…` in the body,
  never PR numbers in the subject. Generic `wip`, `checkpoint`, `fix`, `update`, `changes`, `review`,
  and `polish` subjects are invalid.
- Types: `feat|fix|refactor|perf|test|docs|ci|build|ops|chore|revert`. Scopes:
  `agent|web|chat|catalog|users|auth|edge|contract|db|infra|delivery|eval|e2e|repo|deps`.
- Never add Claude/Anthropic/Codex/OpenAI `Co-Authored-By` trailers or a `Generated with Claude Code`
  footer. Human and Dependabot attribution remains valid.
- `commitlint.config.js` is the machine source of truth for local commit messages and squash-merge
  PR titles: the commit-msg hook (`.pre-commit-config.yaml`) and CI's `commits` job read that one
  file. It pins the type and scope tables above, `header-max-length` 72, and — inherited from
  `@commitlint/config-conventional` — body and footer lines ≤100 characters. Install all hooks with
  `pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push`; never
  bypass them with `--no-verify`. Check a drafted message by hand with `pnpm exec commitlint --edit
  <file>`, or a whole branch with `pnpm exec commitlint --from origin/main` (both need
  `pnpm install`).

## Authoritative docs (read the matching one when doing that work)

- Architecture **why** → `docs/specs/2026-06-13-architecture-adr.md`
- Current **target** for the agent runtime and eval (native Pi harness inside `workers/edge`;
  supersedes SD-4 of the rebuild spec) → `docs/specs/2026-09-09-agent-on-pi-harness-spec.md`
- Web rebuild target (still canonical for `apps/web`) → `docs/specs/2026-07-06-frontend-rebuild-spec.md`
- Current runtime **reference** (native chat, remaining services and verification boundaries) → `docs/ARCHITECTURE.md`
- Deploy runbook → `docs/ops/deployment.md`
- **What we may request from Anitabi** (the pinned upstream document; nothing outside it is
  permitted) → `docs/api-reference/anitabi-api.md`, with the egress service and the agreed rate in
  `docs/ops/anitabi-egress.md`
- **Single Source-of-Truth table + doc-change rules** → `docs/DOCS_POLICY.md` (the one canonical topic→path map)
- Current **campaign tracking** (merged restructure-spec × GOAL; waves P0–P8; ADRs 0003–0005) →
  `docs/specs/2026-08-08-repo-closeout-spec.md`

## Tool routing (repo-specific; global tooling lives in `~/.claude/` — do not repeat it here)

- **Skill-first** — invoke the Skill tool before acting when a request matches: bugs → `/investigate` ·
  ship/PR → `/ship` · qa → `/qa` · review → `/review` · docs → `/document-release` · retro → `/retro` ·
  design system → `/design-consultation` · visual → `/design-review` · architecture → `/plan-eng-review` ·
  quality → `/health` · brainstorm → `/office-hours`. TDD: `/frontend-tdd` (React).
- **Orca card delivery** — backend/Infra/CI-CD Ready for Dev → merged PR follows
  `docs/ops/orca-card-delivery.md`: Codex Sol max with `/implement`, different-model Matt review workers,
  three review rounds maximum, all PR feedback resolved before merge. This scoped owner
  choice overrides the OpenCode-only/fleet and legacy Codex dispatch routing below.
- **Legacy Codex routing (outside the Orca flow)** — delegate code-writing / deep investigation via **`codex:codex-rescue`**; review via
  `/codex:review`; images via `/codex:imagegen`. **Read `.claude/skills/use-codex/SKILL.md` first** —
  short, and skipping it costs whole dispatches. Four facts it exists for: **never run the raw CLI
  concurrently or in a loop** (403/429 is connection contention, not a rate limit — retrying burns
  quota; the owner-local `guard-codex.sh` enforces it and `block-codex-exec-codewrite` blocks raw code edits);
  **Codex cannot commit** — its sandbox refuses every write under `.git`, worktree or clone alike, so
  ask for changes left in the working tree and integrate them into the current semantic outcome;
  **its sandbox has no network**, so build the environment and verify the gates yourself first;
  and **the forwarder returns before Codex finishes**, so arm a `Monitor` keyed on the job log going
  quiet and read the report from `~/.claude/plugins/data/codex-openai-codex/state/*/jobs/*.log`
  rather than the return value. Expect sound judgement and a broken process — inspect and integrate
  its output, then re-run every gate yourself.
- **Web browsing** → `/browse` (gstack). Never `mcp__claude-in-chrome__*`.
- **CodeGraph** — `.codegraph/` is initialized; follow the **global** CodeGraph rules in `~/.claude/CLAUDE.md`
  (spawn an Explore agent for exploration; only lightweight `codegraph_*` lookups in the main session).
- **MCP servers — when to reach for each on this stack** (existence is config; this is the *when*):

  | Server | Use it for |
  |---|---|
  | Neon (`mcp__Neon__*`) | The **data plane** (catalog/user tables). Prisma 8 owns the schema — one chain in `packages/pi-session-neon/migrations/` is the whole migration authority (#1636) — and since #1633 every catalog/users query is a builder plan over that contract. Branch/query Neon. |
  | Cloudflare (`cloudflare-*`) | Workers/Wrangler docs, bindings, builds, observability for the edge/catalog. |
  | context7 | Current library docs for the exact stack (Hono, Prisma 8, oRPC, AI SDK, TanStack Start). Prefer over memory. |
  | serena | LSP-backed semantic code nav/edits when codegraph isn't enough. |
  | logfire | Observability — the agent and Workers share the Logfire dashboard. |

- **Stack skills — invoke the Skill tool when the task matches** (docs fallback = context7 for any lib without a skill: Hono, oRPC, Prisma 8, TanStack Start):

  These are user-scope installations on this machine, not CI dependencies. If a plugin skill is
  missing, install it with `claude plugin install <plugin>@<marketplace>` (for example
  `logfire@pydantic-skills`, `pulumi@pulumi-agent-skills`,
  `better-auth@better-auth-agent-skills`, `cloudflare@cloudflare`); `neon`, `neon-postgres`,
  `ai-sdk` are single-name local/user skills here.

  | Skill | Reach for it when |
  |---|---|
  | `logfire:logfire-instrumentation` · `logfire:logfire-query` | Instrumentation / querying observability. |
  | `cloudflare:workers-best-practices` · `cloudflare:wrangler` · `cloudflare:durable-objects` | Catalog/edge Worker code, `wrangler.toml`, bindings, local `wrangler dev`. |
  | `neon` / `neon-postgres` | Neon data-plane queries, branching, egress tuning. |
  | `pulumi:pulumi-best-practices` · `pulumi:pulumi-component` · `pulumi:pulumi-esc` · `pulumi:pulumi-automation-api` | IaC in `infra/` — Cloudflare R2 / routes / DNS / secrets, stacks, ESC. |
  | `better-auth:create-auth-skill` · `better-auth:better-auth-best-practices` | Auth work as we migrate onto Neon Auth (Better Auth) (`workers/users`, login). |
  | `ai-sdk` | Frontend AI SDK streaming/UI in the TanStack rebuild (`apps/web`). |

## Harness (4-role agent system)

Canonical workflow: `docs/workflow.md` (Matt flow × Policy C, per-stage machine-judgeable triggers).
**Coordinator skill: `.claude/skills/animichi-orca-orchestration/SKILL.md`** (force-added; `.agents/` is a gitignored mirror) — the operating
manual for one delivery tick: the writer/reviewer roster, the launcher's contract, the merge
conditions, and the failure modes each of them was written to prevent. Read it before
dispatching anything. The retired `use-opencode` and `fleet-orchestra` skills are superseded
by it; the `opencode serve` channel they described is no longer how work is dispatched.
Role definitions live in `.claude/agents/`:
- planner — grilling → to-spec → to-tickets (blocking edges); spec dual-review (Fable + Codex GPT Sol xhigh) before owner sign-off.
- executor — dispatched through the Orca headless launcher; see the coordinator skill above
  for the current roster. Brief-driven; publication stays with the coordinator.
- reviewer — card-level final review: read the candidate diff vs brief before merge; **Mutation testing is the only valid green-light proof.**
- tester — Playwright Test Agents pipeline (planner/generator/healer, promotion gates) + staging validation with evidence.
**Quality Ratchet**: every AC carries a test-type (`unit`|`integration`|`eval`|`browser`|`api`) and a test in the PR diff (`ac_total == ac_with_test`); Codecov patch ≥95%. Merge requires resolved review threads + acknowledged bot findings. Two kinds of gate, not interchangeable. **Committed** (every contributor, every CI run): the `commitlint` commit-msg hook, the pre-push affected gate (`scripts/local-gates/pre-push-affected.sh`, running the same package scripts as CI's affected matrix), and the native workflow/action tests under `.github/test` plus repository configuration tests under
`test/repo-config` — CI's `commits`, `affected` and `contracts` lanes mirror those three. **Owner-local**: the hookify rules `block-secrets-in-pr`, `block-local-deploy` and `block-codex-exec-codewrite`, which live beside the tracked files in `.claude/` but are gitignored — enabled and blocking on the owner's machine, absent from a fresh clone and from CI. Never cite one of the three as proof that a repository rule is enforced.

## 升级路径(谁来拍板)

1. **能按原则判的自己定** —— TDD/DDD/SOLID/clean code/KISS/设计模式/官方 best practice 能裁决的问题,
   不问任何人,直接执行并在产出里写明理由。「我不确定」不是升级的理由。
2. **本来要问 owner 的,先问 Fable 5.1**(`advisor` 席位,读得到完整会话上下文)。带着具体选项和代价去问,
   不要抛开放式问题。只有当 Fable 5.1 也认为必须由 owner 拍板时,才停下来等 owner。
3. **只有这五类必须等 owner**:花钱 · 生产/staging 动作 · 密钥 · 范围与优先级 · 明文规则的豁免。

等人回答之前,先把不依赖那个答案的部分全部做完。

## PR 合并前的检查(单一来源)

合并质量的**单一来源**是 `docs/ops/review-gate.md`:native `required_review_thread_resolution`(行级
线程必须 resolve 才能合成)+ `PR Verification`/`Security` 两条 required checks + 全局 hook
`~/.claude/hooks/check-pr-comments.sh`(在 `gh pr merge` 前强制两路评论纪律:线程清零 + qodo/Sonar
顶层发现逐条由人类 ack;还拒绝 bots 尚未发声的抢跑合并)。2026-08-31 起退役:Review Gate 聚合状态、
LLM trusted review 席位、verdict/marker 工件——它们把每次合并耦合到共享模型配额上,配额一空所有 PR
同时红灯且无本地出路。评审纪律(Standards∥Spec、变异红绿证明、fresh-head)保留为 `docs/workflow.md`
stage 5 的流程要求,不再是合并阻塞状态。

## File placement

Never save working files to the repo root. Doc placement + the doc-change checklist → `docs/DOCS_POLICY.md`.

## Agent skills

### Issue tracker

GitHub Issues (`lifeodyssey/animichi`) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five roles map 1:1 to label strings; plus `wayfinder:*` for decision maps. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context monorepo: root `CONTEXT-MAP.md` points at per-package `CONTEXT.md`. System ADRs in `docs/adr/`. See `docs/agents/domain.md`.

Workflow overview (Matt × Policy C): `docs/workflow.md`.
