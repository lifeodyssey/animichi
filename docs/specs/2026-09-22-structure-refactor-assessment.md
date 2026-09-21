# 2026-08-06 结构设计稿对今日树的裁决 — #829

- Status: Assessment — 只读裁决，不含实现。本文不改任何源码、测试、配置或既有 spec。
- Date: 2026-09-22
- 基线：`origin/main` @ `f6ef75126`（"fix(catalog): count the egress ceiling over redis tcp (#1825)"）
- 被裁决的语料：`docs/specs/2026-08-06-structure-refactor-index.md` 及其索引的五份包级结构设计、
  `2026-08-06-monorepo-target-layout.md`、`2026-08-06-greenfield-language-and-data-plane.md`，
  以及父 spec [#829](https://github.com/lifeodyssey/animichi/issues/829) 的 23 条 user story。
- 方法：设计稿的每一条主张都对树核验。**设计稿与树冲突时以树为准**，两边都引。
  否定性结论（「X 不存在」）一律换多个关键词复核后才写。

---

## 一、总判词

**#829 已经执行过，不是一份待拆的 spec。** 它自己的 Process 段写着「下一步 `/to-tickets`」，
而 `/to-tickets` 在 2026-08-06 当天就跑了：#829 的第二条评论列出完整票板（#830–#844），
第四条追加可选票（#852–#860），本地关账板 `docs/iterations/refactor-skeleton-2026-08/GOAL.md`
把它们编成 W0–W8 八个波次，其中 **W0–W6 全部 `[x]` 关账**（2026-08-06 至 08-09 合入约 30 个 PR），
W7（prod 最小权限 DSN，#855）与 W8（git 日折叠，#851/#858）在 2026-08-09 **显式延期**并写入变更日志。
#829 至今 OPEN 的原因就是这两波延期，不是从未拆分。

在这之上，树又走了一年中最远的一段：Prisma 8 接管数据库层、Atlas 退役、原生 Pi agent 重写、
`apps/agent` 整包删除（#1756）。结果是 23 条 story 里 **14 条 LANDED、7 条 DEAD、2 条 LIVE**；
包级设计稿的结构性搬家里，users / edge / web 基本走完，**catalog 还剩四个切片没走**，
而那四个切片**全部被在途的 #1832 压住**。

给协调者的一句话：**#829 该关，不该拆。** 真正可派工的只有 web 两张纯搬家卡；
catalog 的四项要等 #1832 合入后才谈得上派工。把它当"未拆分的 spec"去派实现者，
是让人拿 2026-08-06 的图纸去改 2026-09-22 的楼。

---

## 二、#829 的 23 条 user story 逐条裁决

判词口径：**LANDED** = 树里已成立 · **DEAD** = 目标物已不存在 · **LIVE** = 仍未建且仍想要 ·
**UNCLEAR** = 判不了。「files it would touch」只对 LIVE 填。

| # | Story（摘要） | 包 | 判词 | 证据 | 会碰的文件 | 占用 |
|---|---|---|---|---|---|---|
| 1 | PlanItinerary 切通 domain→application→adapters，handler 不持 SQL | catalog | **LANDED** | `git ls-tree -r origin/main -- workers/catalog/src` 列出 `application/plan-itinerary.ts`、`domain/itinerary/plan.ts`、`adapters/outbound/route-points.ts`；票 #838 CLOSED（PR #874） | — | — |
| 2 | 单一 CatalogReadGateway，删双写路径 | agent | **DEAD（主语消失）+ 意图已在新地址** | `git ls-tree -r origin/main -- apps/agent` 空；`git log origin/main -- apps/agent` 头一条 `cecfc816a refactor(repo): delete the python agent and its ci lane (#1756)`；`git ls-files '*.py' \| wc -l` = 1（只剩 `scripts/git-squash-daily.py`）。`git grep CatalogReadGateway origin/main` 只命中 `GOAL.md`。新地址：`packages/agent/src/catalog-client.ts` 只导出 `createCatalogClient(fetch)`，全文无 POST/PUT/DELETE/upsert/save | — | — |
| 3 | HandleUserMessage 作为 application use case，`agents/` 记为框架适配器 | agent | **DEAD（主语消失）+ 意图已在新地址** | `git grep -l "HandleUserMessage\|handle_user_message" origin/main` 只命中 `GOAL.md` 与两份 2026-08-06 设计稿，无代码命中。新地址：`workers/edge/src/agent/` 已按 `admission/ host/ intake/ recovery/ selection/ settlement/ views/` 分层，`packages/agent/src/harness.ts` 是框架侧 | — | — |
| 4 | ownership/claim/status 作纯规则，无库可测 | users | **LANDED** | `workers/users/src/domain/ownership.ts`、`domain/saved-route-status.ts`、`domain/saved-route-idempotency.ts`；票 #834 CLOSED（PR #866） | — | — |
| 5 | SavedRouteRepo port + 薄 handler | users | **LANDED** | `workers/users/src/adapters/neon-saved-route-repo.ts` + `application/{list,save,save-idempotent,delete}-saved-route*.ts`；设计点名的上帝文件 `src/api/routes.ts` 已不存在（`git ls-tree origin/main -- workers/users/src/api` 空）；票 #835 CLOSED（PR #873） | — | — |
| 6 | listSessions 作为 SessionSummary 只读投影 | users | **DEAD** | `git grep -n "listSessions\|SessionSummary" origin/main` 的全部命中都在 `docs/specs/2026-08-06-*.md`，**零代码命中**；会话列表现由 `workers/edge/src/agent/views/conversation-list.ts` 提供 | — | — |
| 7 | edge 按关切分目录，无巡礼 `domain/` | edge | **LANDED** | `workers/edge/src/` 下有 `identity/ gateway/ protect/ proxy/`（各带 README.md）加 `agent/`；`git ls-tree -r origin/main -- workers/edge/src/domain` 空。story 列的第五项 `container/` 随容器绑定一并删除（`git log origin/main -- apps/agent` 第二条 `646be1564 refactor(edge): remove the container binding and its plumbing (#1737)`） | — | — |
| 8 | UI→hooks→clients 单向；至少一个 feature 脱离 lib+features 双栖 | web | **LANDED（且升级为机器门禁）** | `apps/web/tests/unit/state-ownership/architecture.test.ts` 头注：「AC1 — import boundaries: route/component → feature → API/platform, never reverse … the #842 map-primitive edges」——依赖方向由测试全树扫描强制，不再是评审约定。双栖已解一组：`git ls-tree -r origin/main -- apps/web/src/lib` 无 `chat/` 无 `route-detail/`，而 `features/route-detail/` 有 13 个文件。**残余双栖见 §三 web W3/W5**，属独立 LIVE 项，不推翻本条 AC | — | — |
| 9 | 包改名 maintenance→jobs，schedule 常量单源 | jobs | **DEAD** | `git ls-tree origin/main -- workers/maintenance` 与 `-- workers/jobs` 均空；索引与 target-layout §1.4 自己已标 RETIRED (#1316)「空壳从未落地」 | — | — |
| 10 | PATH-DELTA 追踪目标 vs 实际路径 | repo | **LANDED** | `docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md` 存在；票 #833 CLOSED（PR #861）。**但内容已陈旧**，见 §六 | — | — |
| 11 | CONTEXT-MAP / 包 CONTEXT.md 与有无 domain 对齐 | repo | **LANDED** | `git ls-files \| grep -E 'CONTEXT(-MAP)?\.md$'` → `CONTEXT-MAP.md` + `apps/web`、`packages/agent`、`packages/contract`、`workers/catalog`、`workers/edge`、`workers/users` 六份 | — | — |
| 12 | 包 CI 步骤进 `.github/actions/` composite，薄化 1–2 个 `pipeline-*` caller | ci | **DEAD（前提消失）** | `git ls-tree origin/main -- .github/workflows/` 全部内容是 `cd.yml pr-verification.yml release-build.yml verify-deploy-evidence.yml`——**一个 `pipeline-*` 都不剩**。`.github/actions/` 现为 `hydrate-release` + `setup-workspace`。票 #844 当年 CLOSED（PR #868），其产物随 CI/CD 重设计（ADR 0006/0007）整体替换 | — | — |
| 13 | 保留 `pipeline-*` 命名因 required check 依赖它 | ci | **DEAD（前提消失）** | 同上：无 `pipeline-*` 工作流。required checks 现为 `PR Verification` / `Security`（AGENTS.md「PR 合并前的检查」段与 `docs/ops/review-gate.md`） | — | — |
| 14 | ROLE + GRANT 矩阵写进 Atlas migrations，而非 Pulumi 表资源 | db | **DEAD（如其所写）；意图一分为二后落地** | 三段弧线，缺一不可读懂：① **Atlas 退役** — `git grep -i atlas origin/main -- .github/workflows/cd.yml` 只剩一行注释里的拒绝码名 `atlas_leftovers_present`，schema apply 已不走 Atlas；`docs/adr/0008-platform-over-handwritten.md` 记 2026-09-12 的原则裁定。② **GRANT 矩阵确实进了迁移链** — `packages/pi-session-neon/migrations/app/20260913T1711_data_plane_baseline/access.ts` 持 `MUTABLE_GRANTS`/`SELECT_ONLY_GRANTS`/`APPEND_ONLY_GRANTS`/`AGENT_LEDGER_GRANTS` 并对 `information_schema.role_table_grants` 做精确集断言——**story 的意图成立，只是载体从 Atlas 换成 Prisma**。③ **角色创建反向搬进了 Pulumi** — `infra/database-access/index.ts:138` `new neon.Role(...)`，正是 story 反对的方向；反转理由写在同文件 16–25 行：Neon 控制面只为 API 创建的角色存密码，SQL 创建的角色 `reveal_password` 返回空、`reset_password` 报 422，所以密码只能由 Pulumi 建角色来获得（ADR 0003 / #912） | — | — |
| 15 | staging 应用这些迁移并接入最小权限 DSN | db | **LANDED** | `infra/database-access/{index.ts,runtime-secrets.ts,Pulumi.staging.yaml}` + 六个 `infra/topology-runtime-secret*.test.ts`；GOAL.md W2 关账（#926/#927/#928/#929/#932，ADR 0003） | — | — |
| 16 | schema apply 走既有 deploy 的 Atlas migrate 路径 | ops | **DEAD（如其所写）；意图已换载体** | Atlas 已退（同 #14 ①）。现由 `workers/migrator` 把 Prisma 链打进 Worker、在 GitHub OIDC 后面应用（AGENTS.md monorepo layout 段）。story 反对的「独立 Neon migrate 产品」仍未被采用，这一层意图成立 | — | — |
| 17 | 运行时密钥绑定（谁拿哪条 LOGIN DSN）归 IaC/secrets 面 | infra | **LANDED** | `infra/database-access/runtime-secrets.ts` 导出 `edgeRuntimeSecretNames`（`infra/database-access/index.ts:5` re-export）；`infra/topology-runtime-secret-bindings.test.ts` 等六个拓扑测试守住绑定。载体是 CF Secrets Store 而非 ESC（ADR 0003 取代 #674 的 ESC-first 方案） | — | — |
| 18 | Train-1 路径搬家先绿，再上 Train-2 竖切 | 流程 | **LANDED（流程已执行完毕）** | GOAL.md §3 的 W0→W6 顺序即此纪律；W0/W1/W3 关账行列出 14 个已合 PR（#861–#880） | — | — |
| 19 | greenfield 新名只用在本波竖切路径上；全量 rename 留后 | repo | **LANDED 后被自身超越** | W4 直接做了**全量** rename 而非只竖切（GOAL.md W4 关账：#881/#890/#891/#892/#894）。greenfield 文 §2 已被逐行批注 `#890 已落地` / `#891 已落地`。树侧核验：`aliases.bangumi_id`、`cluster_version.bangumi_id`、`itinerary_snapshots`、`series_edges.{from,to}_bangumi_id`、`points.bangumi_id` 全部到位（`packages/pi-session-neon/migrations/app/20260913T1711_data_plane_baseline/catalog-tables.ts`）。**残余 `work_id` 不是欠账**：仅存于 `ingest_jobs`、`raw_anitabi`、`raw_bangumi`、`raw_payload_history`、`catalog_provenance`，前四张被 greenfield §3.1 明文豁免（「`ingest_jobs` / `raw_*` / `media_assets` **保留**（平台表）— 非粉丝语言」），末一张是设计稿之后新建的表。详见 §七第 1 条 | — | — |
| 20 | 无新用户可见 API 行为；不放宽 coverage/typecheck 门禁 | 评审 | **LANDED** | `apps/web/vitest.config.ts:69` `thresholds: { statements: 98, branches: 95, functions: 98, lines: 99 }`——远在放宽的反方向；AGENTS.md 记 TypeScript 7.0.2 + tsgolint `--deny-warnings` 全包。（观察：`eslint-disable` 2 文件、`@ts-ignore` 3 文件、`ts-expect-error` 2 文件、`continue-on-error` 6 文件——AGENTS.md 允许 owner 批准的例外，未逐条核验批准记录，不作本条判词依据） | — | — |
| 21 | `TODO(refactor-skeleton):` 可搜索标记，而非静默半搬 | repo | **LANDED** | `git grep -c "TODO(refactor-skeleton)" origin/main` 命中 5 个代码位：`infra/src/buckets.ts`、`workers/catalog/src/api/{preview,search,spots,work-points}.ts`，另三处在 iteration 文档 | — | — |
| 22 | Pulumi 分段 / src 骨架，无巡礼 domain | infra | **LANDED** | `infra/src/` 十个按关切分的模块（`access-identity-provider.ts buckets.ts config.ts hardening.ts neon-auth.ts outputs.ts staging-access.ts staging.ts web-routes.ts` + README）加独立 `infra/database-access/`；`git ls-tree origin/main -- infra/src/domain` 空；票 #843 CLOSED（PR #876） | — | — |
| 23 | edge/web/jobs/infra 不要空 demo `domain/` | repo | **LANDED**（但有一处同型缺陷，见 §七第 2 条） | `git ls-tree -r origin/main -- workers/edge/src/domain apps/web/src/domain infra/src/domain` 三者皆空；jobs 包整体不存在 | — | — |

**计数（23 行，逐行可数）：LANDED 15 · DEAD 8 · LIVE 0 · UNCLEAR 0。**

- LANDED 15：1 · 4 · 5 · 7 · 8 · 10 · 11 · 15 · 17 · 18 · 19 · 20 · 21 · 22 · 23
- DEAD 8：2 · 3 · 6 · 9 · 12 · 13 · 14 · 16

其中四条带分裂判词（2、3 的主语消失但意图在新地址成立；14、16 如其所写已死但意图换载体落地），
表格把两半都写出来；每条的**主判词仍唯一**，所以合计正好 23。

**story 层没有 LIVE。** 仍未建且仍想要的东西全在**包级设计稿**那一层——web W3/W5 与 catalog
四个切片，见 §三，派工形态见 §五。#829 的 story 本身是粗粒度验收条款，它们的 AC 已被满足；
设计稿的搬家表才是细粒度的、还有余项的那一层。

---

## 三、包级设计稿的结构性搬家逐项裁决

### 3.1 Catalog（`2026-08-06-catalog-structure-refactor-design.md` S0–S8）

树的实况：`domain/ application/ adapters/outbound/` 都已存在且在用，`api/` 存活下来但**变成了薄入站层**
——这是对设计 §8 验收第 1 条（「无长期 `src/api/`」）的一次**有意替代**，不是半途而废：
`api/geocode.ts` 21 行、`api/nearby.ts` 40 行，各自只接线 `application/*` + `adapters/outbound/*`，
`grep -cE 'sql`|SELECT |INSERT |UPDATE |\$queryRaw'` 在七个 `api/*.ts` 上的结果是
`geocode 0 · nearby 0 · preview 0 · search 0 · snapshot 0 · spots 1 · work-points 0`——SQL 已经出去了。

| 切片 | 判词 | 证据 | 会碰的文件 | 占用 |
|---|---|---|---|---|
| S0 设计文 | **LANDED** | 文档已 ACCEPTED 并在树内 | — | — |
| S1 greenfield 语言 | **LANDED** | #891（见 story 19） | — | — |
| S2 纯 domain 抽出 | **LANDED（差两个模块）** | `domain/{itinerary/plan.ts, clustering/cluster.ts, geo.ts, geocode/collapse.ts, transit/*}` 已就位。设计 §2.1 点名的 `lib/alias.ts`（85 行，纯）与 `lib/series.ts`（100 行，纯）**仍在 `lib/`** | `src/lib/alias.ts` `src/lib/series.ts` → `src/domain/model/`；改导入方 `src/api/search.ts`、`src/application/{geocode-place,resolve-bangumi}.ts`、`src/db/schema.ts`、`src/enrich/enrich.ts`、`src/router.ts`、`src/import/{import-snapshot,switch}.ts`、`src/publish/candidate-export.ts` + 8 个测试 | **BLOCKED BY #1832**（它改 `api/search.ts`、`router.ts`、`enrich/enrich.ts`、`publish/candidate-export.ts`、`import/snapshot-source.ts`） |
| S3 PlanItinerary 竖切 | **LANDED** | 同 story 1 | — | — |
| S4 Search + work-points 竖切 | **LIVE** | `application/` 下**没有** `search-points.ts`；`api/search.ts` 仍 192 行，兼用例与入站于一身（`git ls-tree -r origin/main -- workers/catalog/src/application` 只列 6 个用例） | `src/api/{search,work-points,preview}.ts` → `src/application/{search-points,list-points-for-bangumi,miss-preview}.ts` + `src/adapters/outbound/` 已有的 `title-alias.ts`/`bangumi-*.ts` | **BLOCKED BY #1832**（三个文件里两个在其 diff 内） |
| S5 Resolve 竖切 | **LANDED** | `application/resolve-bangumi.ts` + `adapters/outbound/{title-alias,bangumi-search}.ts` | — | — |
| S6 其余读路径 | **LANDED（差一个）** | geocode / nearby / anime-overview 已各有 application 用例。**缺 `application/get-point.ts`**：`api/spots.ts` 113 行且是唯一还带 SQL 的 api 文件 | `src/api/spots.ts` → `src/application/get-point.ts` + outbound repo；改导入方 `src/publish/spot-quality-gate.ts`、`src/router.ts` + 5 个测试 | **BLOCKED BY #1832**（`router.ts` 在其 diff 内） |
| S7 ingest/enrich/publish 归位 | **LIVE** | `src/{ingest,enrich,publish}/` 共 40 余文件仍在 src 顶层，未进 application/adapters | `src/ingest/**`（23 文件）`src/enrich/**`（2）`src/publish/**`（15）`src/import/**`（6）`src/scheduled/**` | **BLOCKED BY #1832**（其 diff 覆盖这四个目录的大部分） |
| S8 入站收尾 + 删空壳 | **部分被替代，残项 LIVE** | 设计要删 `api/`；树把 `api/` 留作薄入站层并配了机器门禁 `test/dependency-rule.worker.test.ts`（头注直引本设计的父稿 §3）。**残项**：`src/adapters/inbound/.gitkeep` 是空壳目录；`src/lib/` 仍有 7 文件 | `src/adapters/inbound/.gitkeep`、`src/lib/{errors,optional,rows,timing,upstream}.ts` | **BLOCKED BY #1832** |

> **catalog 的结论**：八个切片里五个已落地或被有意替代，四项残留**全部落在 #1832 的 diff 面上**。
> #1832 是一次横扫 catalog 的 Prisma 切换（32 个源文件 + 20 余测试），在它合入前
> 任何 catalog 结构卡都会撞车。合入后这四项可以 `rebase --onto` 直接派。

### 3.2 Users（`2026-08-06-users-structure-refactor-design.md` U-S0–U-S5）

| 切片 | 判词 | 证据 |
|---|---|---|
| U-S0 文档对齐 | **LANDED** | `workers/users/CONTEXT.md` 存在 |
| U-S1 纯规则抽出 | **LANDED** | `src/domain/{ownership,saved-route-status,saved-route-idempotency}.ts` |
| U-S2 SavedRouteRepo port + SQL 搬家 | **LANDED** | `src/adapters/{neon-saved-route-repo,neon-atomic-commit,neon-idempotency-store}.ts` |
| U-S3 SessionSummaryReader + 投影语义 | **DEAD** | 其对象 `listSessions` 零代码命中（story 6） |
| U-S4 拆 application + 删 `api/routes.ts` | **LANDED** | `git ls-tree origin/main -- workers/users/src/api` 空；`src/application/` 四个用例文件 |
| U-S5 greenfield 语言/表 | **LANDED** | `saved_routes` 等，#890 |

残项只剩 `src/lib/errors.ts`（设计 §1.2 想把它归入 adapter error map）——一个文件的归属问题，
不值一张卡；且 **BLOCKED BY #1831**（它改 `workers/users/src/` 的 adapters/db/index/router）。

### 3.3 Edge（`2026-08-06-edge-gateway-structure-design.md` E0–E5）

| 切片 | 判词 | 证据 |
|---|---|---|
| E0 设计 | **LANDED** | — |
| E1 package-ize（deps/wrangler/CI 脚本迁入） | **LANDED** | 根 `package.json`（`git show origin/main:package.json`）的 dependencies 只剩 commitlint/oxlint/tsx/wrangler/yaml 等编排物，**无 hono/jose/containers**；`workers/edge/{package.json,wrangler.toml,tsconfig.json}` 各就位；根脚本 `"test:worker": "pnpm --filter edge-worker test"` 正是设计搬家表最后一行写的目标 |
| E2 `src/` + `test/` 搬家 | **LANDED** | 生产 ts 全在 `workers/edge/src/**`（`git ls-tree --name-only origin/main -- workers/edge/` 顶层无 `.ts`）；测试分在 `test/` 与六个专用测试目录 |
| E3 path 工具合并 + policy 常量收敛 | **LANDED** | `src/gateway/{routing-policy,rate-policy,request-class,read-key}.ts` 分工到位；设计要合并的 `env.ts`/`entry-env.ts` 现只剩 `src/env.ts` 一份 |
| E4 greenfield path | **LANDED** | 随 #891 的 contract 改名同波 |
| E5 AGENTS/CONTEXT 路径 + 删 husk | **LANDED** | `workers/edge/{AGENTS.md,CONTEXT.md,CLAUDE.md}`；四个关切目录各带 README.md |

设计列的 `container/` 目录**不该建**：容器绑定已随 #1737 删除。
设计未预见的是 `src/agent/`（原生 Pi tier，53 文件）成了本包最大的子树——
这不是设计的欠账，是设计之后的新事实。

### 3.4 Web（`2026-08-06-web-ui-structure-design.md` W0–W6）

| 切片 | 判词 | 证据 | 会碰的文件 | 占用 |
|---|---|---|---|---|
| W0 文档 + CONTEXT.md | **LANDED** | `apps/web/CONTEXT.md` 存在并引用本设计 | — | — |
| W1 钉死 api 层纪律 | **LANDED（机器门禁）** | `apps/web/tests/unit/state-ownership/architecture.test.ts` 全树扫描 import 边界，头注点名 #842 | — | — |
| W2 `lib/chat` + route-detail → features | **LANDED** | `apps/web/src/lib` 下无 `chat/`、无 `route-detail/`；`components/` 下亦无 `route-detail/`；`features/route-detail/` 13 文件 | — | — |
| W3 landing/auth/legal 进 features | **LIVE** | `components/{auth,home,legal}/` 与 `components/Splash.tsx` 仍在，而 `features/{auth,splash}` 并存——双栖 | `src/components/{auth,home,legal}/**`、`components/Splash.tsx` → `src/features/{auth,landing,legal}/`；导入方 `src/routes/{__root.tsx,index.tsx,privacy.tsx,auth/callback.tsx}`、`src/features/chat/lib/work-title.ts` + 15 个测试 | **BLOCKED BY #1818**（它改 `apps/web/src/routes/__root.tsx`，而该文件 10–13 行 import 了 `../components/{NotFound,RootError,Splash,theme-bootstrap}`） |
| W4 maps 三源收敛 | **LANDED（经设计自带的 `_dev` 条款）** | 设计 §3.1 写「若某文件仍是实验且无路由引用 → 删或移 `_dev`，不留三套真源」。树已满足：生产单一源是 `features/bubble-map`（被 `features/chat/components/{RouteTrailMap,SearchMap,SearchResult,PlaceMapMarker}.tsx` 使用）；`features/map-spike` 只被 `routes/_dev/map-spike.tsx` 引用，`features/maplibre` 只被 `routes/_dev/map-canary.tsx` 引用。**不是三套真源，是一套生产 + 两只 `_dev` 金丝雀** | — | — |
| W5 platform 收 auth/byok/turnstile | **LIVE** | `src/lib/{auth,byok,turnstile}/` 仍在 `lib/` 下；`src/platform/` 只有 `geo.ts` | `src/lib/{auth,byok,turnstile}/**`（11 文件）→ `src/platform/`；导入方约 90 个文件（`src/api/orpc.ts`、`src/components/{auth,settings}/**`、`src/features/{auth,chat}/**`、`src/routes/{index,settings,auth/callback}.tsx`、`src/lib/i18n/locale-storage.ts` + 约 70 个测试） | **FREE** — #1818 在 `apps/web` 只碰 `router.tsx`、`routes/__root.tsx`、`server/csp-*.ts`、`start.ts` 与 csp/startup-smoke 测试；这些文件**都不**导入 `lib/{auth,byok,turnstile}`（已逐一核验）。同包不同文件，需与 #1818 owner 串行排卡 |
| W6 greenfield 类型/path/MSW | **LANDED** | 随 #890/#891 同波 | — | — |

### 3.5 Agent（`2026-08-06-agent-structure-refactor-design.md` S0–S7）

**整篇 DEAD。** 它的 Package 行写死 `apps/agent only（src/animichi/）`，
其 §1 inventory 的每一个路径——`agents/animichi_runner.py`、`interfaces/public_api.py`、
`infrastructure/supabase/repositories/*`、`clients/catalog_client.py`——都随 #1756 消失。
`git ls-files '*.py' | wc -l` = 1，仓库里已无 Python 包。

「`packages/agent` 是不是它换了地址的同一件事」——**不是**。两者层级不同：
设计要在一个 Python 单体里切出 domain/application/infrastructure 四圈；
今天的 `packages/agent` 是一个**平台无关的 TS 领域库**（43 个平铺文件，无分层目录），
而设计里 application/interfaces 那一层的职责落在了 `workers/edge/src/agent/`（按 admission/host/
settlement/views 分关切）。设计的**意图**（只读 catalog 入口、用例与框架适配器分离）在新地址成立；
设计的**搬家表**一行都不可执行。

### 3.6 Monorepo 目标树（`2026-08-06-monorepo-target-layout.md` §1.2 逐行）

| 设计行 | 判词 | 证据 |
|---|---|---|
| 根 edge 运行时 deps → `workers/edge/package.json` | **LANDED** | 见 E1 |
| 根 `wrangler.toml` → `workers/edge/` | **LANDED** | `git ls-tree origin/main -- wrangler.toml` 空；`workers/edge/wrangler.toml` 在 |
| 根 `Dockerfile` → `apps/agent/` | **DEAD** | `git ls-tree origin/main -- Dockerfile` 空；去向 `apps/agent` 亦空。今日唯一 Dockerfile 在 `apps/anitabi-egress/` |
| 根 `db/` → `migrations/neon/` | **DEAD** | `git ls-tree origin/main -- db` 与 `-- migrations` **均空**。取代者：`packages/pi-session-neon/migrations/{app,snapshots}`——AGENTS.md 称其为「the one Prisma 8 chain … the whole migration authority (#1636)」 |
| 根 `supabase/` → `migrations/supabase/` | **DEAD** | 根 `supabase/` 仍在（`.gitignore README.md config.toml functions migrations templates`），但它已被重新定性为**只读历史**：`gh issue view 1000` = `CLOSED \| refactor: remove Supabase compatibility surface`，AGENTS.md 称 supabase 迁移目录「is an archived historical migration dir (issue #1000), not a live surface」。把只读历史搬进一个活的 `migrations/` 目录已无意义 |
| 根 `e2e/` → `tests/e2e/` | **DEAD（被超越，但无明文翻案记录）** | `git ls-tree origin/main -- tests/e2e` 空，`e2e/` 仍在根。AGENTS.md 的 monorepo layout 表把 `e2e/` 连同 `e2e/AGENTS.md` 列为规范位置，DOCS_POLICY 的 canonical 表同样写 `e2e/AGENTS.md`——当前决定是 `e2e/` 留在根。**但找不到一条显式推翻 §1.2 这一行的记录**，判 DEAD 靠的是 AGENTS.md 的现行表述而非一次裁定 |
| `fixtures/` · 仅 agent 的 `docker/` → `apps/agent/` | **DEAD** | `git ls-tree origin/main -- fixtures docker` 空；去向亦空 |
| `packages/contract` 保留、不改顶层名 | **LANDED** | `packages/contract/` 在 |
| `apps/` + `workers/` 双顶栏 | **LANDED** | `apps/{anitabi-egress,web}` · `workers/{catalog,edge,migrator,users}` |

---

## 四、在途 PR 占用图（判定 FREE/BLOCKED 的依据）

`for p in 1831 1832 1835 1818 1828 1817; do gh pr diff $p --name-only; done` 的归并：

| PR | 标题 | 占用面 |
|---|---|---|
| **#1832** | refactor(catalog): write ingest through prisma | `workers/catalog/src/` 的 `api/{search,snapshot,work-points}.ts` · `db/**` · `enrich/**` · `import/**` · `ingest/**`（12 文件）· `publish/**`（6）· `scheduled/**` · `index.ts` · `router.ts` · `lib/{json,pg-error}.ts` + 20 余测试 |
| **#1831** | refactor(users): move the query layer onto prisma | `workers/users/src/{adapters,db}/**` · `index.ts` · `router.ts` + 全部 users 测试；另碰 `workers/edge/test/migration-boundary.test.ts`、`pnpm-workspace.yaml`、`.github/workflows/pr-verification.yml` |
| **#1818** | feat(web): add a nonce-based CSP to documents | `apps/web/src/{router.tsx, routes/__root.tsx, server/csp-*.ts, start.ts}` + csp/startup-smoke 测试 · `e2e/{helpers/turnstile.ts,native-recovery-driver.ts}` · `workers/edge/host-integration-test/session-adoption.browser.ts` |
| **#1835** | ci(repo): lint what each package ships, and pin the scope | 根 `package.json` · `packages/contract/{package.json,AGENTS.md,test/**}` · `test/repo-config/lint-scope.test.rb` |
| **#1828** | fix(catalog): count the daily run in the egress ceiling | `apps/anitabi-egress/**` · `workers/catalog/src/{cron-config,operational-config}.ts` · `test/repo-config/anitabi-egress-*.test.rb` · `docs/ops/{anitabi-egress,secrets}.md` |
| **#1817** | docs(repo): record the orca delivery handoff and its lessons | `docs/iterations/orca-2026-09-19/**` — 与 `docs/specs/` 无交集 |

**本文档自身**落在 `docs/specs/2026-09-22-structure-refactor-assessment.md`，与六个 PR 全部无交集。

---

## 五、可派工卡片（FREE + LIVE，按可派度排序）

只有两张。catalog 的四项虽是真 LIVE，但全被 #1832 压住，列在第三节作为**解锁后的队列**。

### 卡 1 — `refactor(web): move the cross-cutting clients into platform`

**可派度：FREE，现在就能开。**

**范围。** 把 `apps/web/src/lib/{auth,byok,turnstile}/` 三个目录整体搬到 `apps/web/src/platform/`，
并更新全部导入方。这是 web 结构设计 W5 的原文（「`lib/auth|byok|turnstile` → `platform/auth|byok|turnstile`」），
理由是这三者是跨 feature 的平台能力而非某个产品面的私货——`lib/auth` 被 `api/orpc.ts`、
`features/chat`、`features/auth`、三个 route 同时消费，正是设计说的「跨面能力」。
搬完后 `src/lib/` 只剩 `exif-strip.ts`、`json-ld.ts`、`landmark-shot.tsx`、`search-params.ts`、
`i18n/locale-storage.ts`、`runtime-config/`——那一批的归属**不在本卡范围**，留原地。

**纯搬家，零行为变更。** 不许借机改认证逻辑、不许合并文件、不许动 `platform/geo.ts`。

**验收（逐条机器可判）。**
1. `git ls-tree -r origin/main -- apps/web/src/lib/auth apps/web/src/lib/byok apps/web/src/lib/turnstile` 输出为空。
2. `apps/web/src/platform/{auth,byok,turnstile}/` 下的文件名集合，与搬家前 `lib/` 下的完全一致（11 个文件，不增不减）。
3. `git grep -c "lib/auth\|lib/byok\|lib/turnstile" -- apps/web` 为 0。
4. `pnpm --filter web test` 与 `pnpm --filter web typecheck` 全绿；`pnpm --filter web lint:oxlint` 无 warning。
5. `apps/web/tests/unit/state-ownership/architecture.test.ts` 绿，**且不改 `checker.ts`/`scan.ts`**。
   本卡对该门禁是**层级中性**的，已核验：`apps/web/tests/unit/state-ownership/scan.ts:62-73` 的
   `layerOf()` 把 `api/ lib/ platform/ i18n/ server/` **同映射为 `"base"`**（注释原文：
   「everything else (api, lib, platform, i18n, server) is base」）。`lib/x` 与 `platform/x` 在
   门禁眼里是同一层，所以搬家不产生任何新的方向违规，也不需要动 checker 的目录映射。
   若实现者发现需要改 checker，说明搬的东西超出了本卡范围——停下来问。
6. `apps/web/vitest.config.ts` 的 thresholds 一字未改（`git diff` 对该文件为空）。
7. 本 PR diff 不含 `apps/web/src/{router.tsx,start.ts,server/}` 与 `apps/web/src/routes/__root.tsx`——#1818 持有这四处。

**排期约束。** 与 #1818 同包不同文件，文件级不冲突；但 `apps/web` 的包级 owner 当前是 #1818，
派工前与其 owner 串行排卡，或等 #1818 合入后开工。

---

### 卡 2 — `refactor(web): fold the remaining page shells into features`

**可派度：LIVE，BLOCKED BY #1818。#1818 合入后立即可派。**

**范围。** web 结构设计 W3 的原文四行：
`components/auth/*` → `features/auth/ui/*`；`components/home/*` + `components/Splash.tsx` →
`features/landing/*`（`features/splash/` 已存在，是否并入由实现者按 §3 目标树判断并在 PR 说明理由）；
`components/legal/*` → `features/legal/*`。搬完 `components/` 只应剩真正无业务的壳
（`NotFound.tsx`、`RootError.tsx`、`CatalogSearchResults.tsx`、`theme-bootstrap.ts`），
这正是设计 §3 对 `components/` 的定义（「仅真正无业务的 primitive / 壳」）。

**`components/settings/` 不在本卡内。** W3 的原文只有 auth / landing+home+Splash / legal 三组，
`settings/` 一行都没提。按设计 §3 的口径它确实是产品面、早晚该进 `features/`，但那是一次
本评估没有依据的扩权——**留原地，另开卡**。实现者不要顺手搬它。

**这次搬家会变层，与卡 1 不同。** `scan.ts:65-66` 把 `components/` 判为 `"ui"`、`features/` 判为
`"feature"`，所以本卡把四组文件从 ui 层移进 feature 层。门禁允许 ui→feature，但**拒绝
feature→feature 的深层引用**（`checker.ts:201-205` `crossFeatureViolation`），除非命中
`MAP_PRIMITIVE_EDGES` 或 `SHARED_UI_FEATURE`。两点已预先核验：
① 今天 `features/**` 里对这四组的唯一命中是 `features/chat/lib/work-title.ts:18` 的一行**注释**
（`* components/home/PopularRanking): zh readers…`），不是 import——搬家不凭空造出 chat→landing 的边；
② `checker.ts:73` `SHARED_UI_FEATURE = "features/auth/ui"` 已是门禁认可的共享边界，
而 W3 给 `components/auth` 指定的去向正是 `features/auth/ui/*`——**设计的目标位置与门禁的豁免位置重合**，
不需要新增豁免。

**为何被压住。** `apps/web/src/routes/__root.tsx` 第 10–13 行 import 了
`../components/{NotFound,RootError,Splash,theme-bootstrap}`，而该文件在 #1818 的 diff 内。
搬 `Splash.tsx` 必须改 `__root.tsx`。

**验收（逐条机器可判）。**
1. `git ls-tree -r origin/main -- apps/web/src/components/auth apps/web/src/components/home apps/web/src/components/legal` 输出为空；`apps/web/src/components/Splash.tsx` 不存在。
2. `apps/web/src/components/` 下只剩 `NotFound.tsx`、`RootError.tsx`、`CatalogSearchResults.tsx`、`theme-bootstrap.ts`、`settings/`。
3. `git grep -c "components/auth\|components/home\|components/legal\|components/Splash" -- apps/web e2e` 为 0。
4. `pnpm --filter web test` / `typecheck` / `lint:oxlint --deny-warnings` 全绿。
5. `apps/web/tests/unit/state-ownership/architecture.test.ts` 绿，**且 `MAP_PRIMITIVE_EDGES` 未新增条目**
   （`git diff` 对 `apps/web/tests/unit/state-ownership/checker.ts` 为空）。按上面①②两条核验，
   本卡不该需要新豁免；若实现者发现需要，PR 说明必须写清是哪条边、为什么——
   该文件头注已写明「No feature→UI reverse-edge allowlist exists」。
6. 不新增 `apps/web/src/domain/`（#829 story 23）。
7. `apps/web/vitest.config.ts` thresholds 未改。

**前置。** #1818 合入后从新的 `origin/main` 开分支，或 `rebase --onto` 到 #1818 的 head。

---

### 解锁后的队列（catalog，全部 BLOCKED BY #1832）

#1832 合入前**不要派**。合入后按此序，每张一 PR：

| 序 | 建议标题 | 内容 | 主要验收 |
|---|---|---|---|
| 1 | `refactor(catalog): move the pure alias and series kernels into domain` | `lib/{alias,series}.ts` → `domain/model/`（设计 §2.1 点名） | `git ls-tree -- workers/catalog/src/lib/alias.ts` 空；`test/dependency-rule.worker.test.ts` 绿 |
| 2 | `refactor(catalog): give the point read its own use case` | `api/spots.ts` → `application/get-point.ts` + outbound repo（S6 残项） | `api/spots.ts` 的 `grep -cE 'sql\`\|SELECT '` 为 0 |
| 3 | `refactor(catalog): cut the search read into a use case` | `api/{search,work-points,preview}.ts` → `application/`（S4） | `application/search-points.ts` 存在；`api/search.ts` < 60 行 |
| 4 | `refactor(catalog): settle the data-platform stages into layers` | `ingest/ enrich/ publish/ import/ scheduled/` 归位（S7/S8）+ 删 `adapters/inbound/.gitkeep` 空壳 | `git ls-tree -- workers/catalog/src/adapters/inbound` 不只含 `.gitkeep` |

第 4 项规模很大（40 余文件），派工前应先拆；本评估不代拆——那需要它自己的 grilling。

---

## 六、应被 supersede 或标注为历史的文档

DOCS_POLICY 的规则：`docs/specs/` 只放「Active, non-superseded」，superseded 一律单向进
`docs/archive/specs/`。但**归档这批文件有一条硬约束**，先说清：

`scripts/local-gates/check-spec-references.sh` 要求 `docs/specs/` 下每个文件被至少一个
`docs/archive/` 之外的活文件按 basename 引用。实测引用图（`git grep -l -F "<basename>"`，
排除自身与 archive）：

| 文档 | 被谁引用 | 归档影响 |
|---|---|---|
| `2026-08-06-structure-refactor-index.md` | `CONTEXT-MAP.md`、`PATH-DELTA.md`、`monorepo-target-layout.md`、`scripts/check-skeleton-w0-docs.sh` | **它是另外三份的唯一引用者** |
| `2026-08-06-catalog-structure-refactor-design.md` | **只有** index | 随 index 归档即断引用 |
| `2026-08-06-users-structure-refactor-design.md` | **只有** index | 同上 |
| `2026-08-06-agent-structure-refactor-design.md` | **只有** index | 同上 |
| `2026-08-06-edge-gateway-structure-design.md` | index、`monorepo-target-layout.md`、`2026-09-05-repo-smell-audit.md`、`workers/edge/test/doubles/{guard,turnstile}-doubles.ts` | 有代码引用，安全 |
| `2026-08-06-web-ui-structure-design.md` | index、`monorepo-target-layout.md`、`apps/web/CONTEXT.md` | 有活引用 |
| `2026-08-06-monorepo-target-layout.md` | `CONTEXT-MAP.md`、`PATH-DELTA.md`、四份 CA 设计、`check-skeleton-w0-docs.sh` | 引用面宽 |
| `2026-08-06-greenfield-language-and-data-plane.md` | `CONTEXT-MAP.md`、`ADR-0002`、`RENAME-EXPAND-CONTRACT.md`、五份设计、`packages/contract/CONTEXT.md`、`workers/catalog/CONTEXT.md` | 引用面最宽 |

**建议（按证据强度排序，均需 owner 拍板，本文不执行）：**

1. **`2026-08-06-agent-structure-refactor-design.md` → 归档。**
   理由最硬：它的 Package 行锁死 `apps/agent only`，全篇 inventory 的路径已随 #1756 删除，
   `git ls-files '*.py' | wc -l` = 1。它描述的是不存在的代码，正是 DOCS_POLICY「Review Check」
   第三问要挡的。归档时需同步删掉 index 第 1 节的该行（否则引用断裂）。

2. **`2026-08-06-structure-refactor-index.md` → 原地加一段 Status 批注，不归档。**
   它是 catalog/users/agent 三份设计的唯一引用者，归档会连带三份一起失去活引用。
   批注内容应写：本索引所列切片由 #829 战役 W0–W6 于 2026-08-06/09 执行完毕，
   剩余未落地项见本评估文档。

3. **`2026-08-06-catalog-structure-refactor-design.md` → 原地批注 §8 验收第 1 条。**
   「无长期 `src/api/`」已被有意替代：`api/` 现为薄入站层且由
   `workers/catalog/test/dependency-rule.worker.test.ts` 机器守卫。
   不批注的话，下一个读它的实现者会去删一个正确的层。

4. **`2026-08-06-monorepo-target-layout.md` §1.1/§1.2 → 原地批注。**
   目标树里 `apps/agent/`、`migrations/{neon,supabase}/`、`tests/e2e/` 三项已不成立（§3.6）。
   这份文件还在被四份 CA 设计和 `CONTEXT-MAP.md` 引用，不宜归档。

5. **`2026-08-06-users-structure-refactor-design.md` → 原地批注 U-S3。**
   SessionSummaryReader 的对象 `listSessions` 已零代码命中。

6. **`docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md` → 需要一次刷新。**
   `scripts/check-skeleton-w0-docs.sh` 第 17 行 `require_grep … 'migrations/neon'`
   断言它仍写着 `migrations/neon`——那个目录已不存在（§3.6）。
   见 §七第 3 条：该脚本本身已不在任何门禁里跑。

`2026-08-06-{edge-gateway,web-ui}-structure-design.md` 与 `greenfield-…` 三份**不建议动**：
edge/web 两份的未落项正是 §五两张卡的依据（卡片要引用它们），greenfield 仍是发布语言的活规范。

---

## 七、顺带发现的缺陷（**本评估不修**，留给协调者定夺）

1. **`work_id` 的假阳性陷阱（记为反例）。** 只搜 `work_id` 会得到「greenfield rename 没做完」的
   结论——这是错的。命中的五张表里 `ingest_jobs`/`raw_anitabi`/`raw_bangumi`/`raw_payload_history`
   被 greenfield §3.1 明文豁免为平台表，`catalog_provenance` 是设计稿之后新建的。
   必须同时读**设计自己的豁免条款**才判得对。这正是「一个关键词的否定性结论最容易出错」的实例。

2. **`workers/catalog/src/adapters/inbound/.gitkeep` 是空壳目录。**
   #829 story 23 反对的是空 `domain/`，严格说不违反该条；但它是同一个反模式——
   一个用 `.gitkeep` 占住、里面一个实现都没有的层。归属在上面 catalog 队列第 4 项。

3. **`scripts/check-skeleton-w0-docs.sh` 是一个已不运行且断言已陈旧的脚本。**
   `git grep -n "check-skeleton-w0" origin/main -- Makefile .github scripts/local-gates .pre-commit-config.yaml`
   输出为空——它不在 Makefile、不在 CI、不在 local-gates、不在 pre-commit。
   而 `test/repo-config/retired-migration-authority-refs.test.rb:39` 已把它列为豁免，
   理由写作「it asserts that a dated iteration record still says what it said」——
   仓库其实已经把它当历史记录而非门禁看待了。它第 17 行断言 `PATH-DELTA.md` 含 `migrations/neon`，
   而该目录不存在。**它 `require_file` 的三份 2026-08-06 文档因此不构成归档阻碍**
   （真正的阻碍是 `check-spec-references.sh`，见 §六）。

4. **`packages/contract/src/models.ts` 第 7、33 行是指向已删文件的陈旧注释。**
   两行分别写 `backend/agents/runtime_models.py  (PilgrimagePointModel, RouteModel)` 与
   `Mirrors PilgrimagePointModel in runtime_models.py.`——那个文件随 #1756 消失，
   `PilgrimagePointModel` 这个名字今天在代码里已不存在。读到它的人会以为契约还镜像着一个
   Python 模型。同类还有 `workers/catalog/src/enrich/enrich.ts:11` 提到的 `route_snapshots`
   （表已改名 `itinerary_snapshots`）。这是仓库已经吃过亏的一类——陈旧自述会骗过评审席。

---

## 八、门禁适用性

两个脚本**都适用**于一份新增的 `docs/specs/` 文件，位置在 `scripts/local-gates/`（不是 `scripts/` 根）。

- **`bash scripts/local-gates/check-docs-paths.sh`** — 适用。它扫每个被跟踪文件里的
  `docs/…` 串是否能对仓库根解析。本文引用的所有 `docs/` 路径均取自 `git ls-tree`/`git ls-files` 实证。
  实测结果附在 `/private/tmp/animichi-lane-829assess/report.md`。

- **`bash scripts/local-gates/check-spec-references.sh`** — 适用，且**本文一旦 commit 就会让它变红**。
  该脚本要求 `git ls-files 'docs/specs/'` 里的每个文件被至少一个 archive 之外的活文件按 basename 引用。
  本车道的约束是「只写这一个新文档，不改任何既有文档」，因此没有任何文件能引用它，
  也不能往 `scripts/local-gates/spec-reference-exceptions.txt` 加条目。
  **这不是绕过，是如实报告**：协调者集成本文时必须二选一——
  (a) 从一份活文件（`docs/iterations/README.md`、`CONTEXT-MAP.md` 或 #829 的关账评论所指向的
  `GOAL.md`）链过来；或 (b) 在 `spec-reference-exceptions.txt` 写一行
  `docs/specs/2026-09-22-structure-refactor-assessment.md|<canonical owner>`。
  未跟踪时与 commit 后的两次实测输出都记在报告里。

---

## 九、变更日志

| 日期 | 变更 |
|---|---|
| 2026-09-22 | 初稿：#829 的 23 条 story 与五份包级设计稿对 `origin/main@f6ef75126` 的逐项裁决；in-flight PR 占用图；两张 FREE 卡 + catalog 解锁队列；文档 supersede 建议 |
