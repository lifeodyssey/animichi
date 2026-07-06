# 前端重建(Frontend Rebuild)— 主 Spec

Status: DRAFT for Coordinator planning (rev. 5 — SD interview 结论最终版,取代此前 rev 1-4 中"SD-2 讨论中"的暂定框架)
Date: 2026-07-06
Author: Planning agent (based on `2026-07-06-frontend-rebuild-inputs.md` §一~§七 全文,含 SD-1~SD-6 最终结论)
Baseline: `main` (`02cd7fa`), new branch `feat/frontend-rebuild`

唯一权威输入:`docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md`(§六 X1-X15 + §七 SD interview 结论,后者为评审版 Decision Log 权威)。与旧 spec(`2026-06-22-frontend-rebuild-tanstack-design.md` 等)冲突处,以 inputs 文件与本 spec 为准。设计原稿:`docs/design/2026-07-06-design-sync/`。

---

## ① 愿景与范围

Seichijunrei 前端从 Next.js + OpenNext-SSR 全量重建为 `apps/web`(TanStack Start,SPA + 选择性 SSR,Cloudflare Worker 运行时),一次大爆炸切流直接替换生产;后端保持 PydanticAI 容器化 agent(SD-4 终局定案,不再议)+ TS catalog 的混合微服务,新增**第三个** TS 服务 `workers/users` 承载用户域数据(SD-2 定案);新增能力按「全栈纵切」原则由前端 story 自带最小后端 enabler,归属规则终局:catalog 域数据→`workers/catalog` oRPC,用户域数据→`workers/users` oRPC(Neon+Drizzle),agent 不再新增数据端点。8 个迭代(0-7)按巡礼之环的顺序建造——Chat 计划先行(含 SD-3① 的跨库 bug 修复),详情/列表承接保存(含 SD-3④ 的 sessions 迁移),Walk 现场审判(含 conversation_messages 迁移),しおり产出回流,発見页引新人,工作台增效,开放接口对外(含 SDK/MCP 战略)——每个迭代结束都是可独立部署到生产的 releasable 增量。范围覆盖 `docs/design/2026-07-06-design-sync/` 下全部 24 个页面级 HTML 画布(见 §⑥)、SEO/GEO 可执行化、以及 2026-07-06 全天的架构补充意见(X1-X15)与随后的 SD interview 六轮结论(SD-1~SD-6,终局,取代 X12/X13 的临时框架)。

不追求"从第一天就功能对等旧站",追求"每个迭代结束时,线上没有死路 UI、没有裸错误、视觉与画布一致"。

---

## ② Decision Log

### G1-G8(grill-me 定案,2026-07-06)

| # | 决策 | 定案 |
|---|---|---|
| G1 | 基线落点 | 基于 main(02cd7fa)新分支 `feat/frontend-rebuild`,新前端落 `apps/web/`;spike 代码(分支 `docs/frontend-rebuild-plan` 的 `frontend/`,11 个功能 commit)**迁代码不迁历史** |
| G2 | 切流 | **大爆炸**:迭代 0 的 walking skeleton 直接替换生产前端;旧 Next.js `frontend/` 与 OpenNext 链路同迭代删除 |
| G3 | 渲染 | SPA + **选择性 SSR**(`/s/:id`、`/anime/:id` 两族路由)——对旧 spec「纯 SPA」决策(D4)的正式修订 |
| G4 | 后端归属 | **全栈纵切**:需要新后端能力的 story 自带最小 enabler,不做 mock 先行、不做后端先行。**归属细则由 SD interview 终局定案(见下 SD-1~SD-6),取代 X12 的临时框架**:catalog 域数据→`workers/catalog` oRPC;**用户域数据→新建 TS 服务 `workers/users` 的 oRPC 路由(`/v1/users/*`),Neon+Drizzle 承载,契约进 `packages/contract`**;`apps/web` 的 `supabase-js` **仅用于 auth**(取 session/JWT),不直连任何数据表,不用 RLS 作访问路径;**禁止往 agent 服务(`apps/agent`)新增任何数据端点**,agent 只保留会话/编排。**X11 纪律**:自家 `apps/web` 消费"能力面"与"用户数据面"一律走 `/v1` 公开 API(oRPC),不开私有后门;迭代 7 的 SDK/MCP 零改造复用同一契约 |
| G5 | 迭代列车 | Chat 先行,8 个迭代(0-7) |
| G6 | Walk 离线 | 迭代 3 内**一步到位**(service worker + 地图/路线缓存 + 打卡离线队列同步),不拆分、不推迟 |
| G7 | 匿名 Chat | **完全放开**:未登录可完整用 Chat,登录墙只在保存(P5);配套 edge 限流 + Cloudflare Turnstile + 匿名配额 + BYOK;agent skill + A2A/MCP 开放接口进迭代 7 |
| G8 | 素材生产 | fox 小跑 8 帧 sprite + 20 枚产品图标集以 AI 生成管线产出;AC 必须含「用户过目收编后才算完成」 |

### D1-D13(架构决策台账判决,已按 SD interview 最终结论更新)

| # | 决策 | 判决 | 关键事实 |
|---|---|---|---|
| D1 | TanStack Start | 保留 | spike 已跑通;ARCHITECTURE.md/AGENTS.md/deployment.md/CI 全部仍写 Next.js——迭代 0 文档回写一并处理 |
| D2 | animal-island-ui-tailwind | 保留,升 1.0.x 最新 | 兼容性验证进迭代 0 |
| D3 | Capacitor | **推迟**(non-goal,环闭合后) | LOCKED 纸面决策,零代码 |
| D4 | 渲染策略 | **修订**:SPA + 选择性 SSR(= G3) | 原 spec 纯 SPA;`wrangler.toml [assets]` 与 CI 均按旧假设,迭代 0 必修 |
| D5/D6 | monorepo + oRPC 契约 | 保留(main 已落地),**范围扩大(SD-2 定案)** | `packages/contract` 原仅覆盖 agent↔catalog(`/catalog/*` 5 method);**本列车起新增 `workers/users` 服务的 oRPC 契约**(路线/打卡/しおり/分享 token 等用户域 CRUD),同样进 `packages/contract`;`apps/web` 经 oRPC client 调用,**不是** RLS 直连 |
| D7 | Agent Pyodide Worker 化 / TS 重写 | **双双 REJECTED,终局定案(SD-4,2026-07-06,不再议)** | 三代方案自我推翻,代码从未离开第一代(容器化 FastAPI)。**SD-4 知情决定依据**:TS agent SDK 对标调研显示 Vercel AI SDK 约 50-60% 可行但需自养约 100 行重试基建,而 pydantic-ai 的 `ModelRetry`+`output_validator` 护城河更优;容器化 Python + 保温策略为最终架构。**X2 首 token SLO 由此升级为硬性要求(非软目标)** |
| D8 | Neon/Supabase 拆分 | **SD-3 激活,渐进执行(不再是 non-goal)** | Supabase 收缩为纯 auth,数据面归 Neon:① `apps/agent/agent/agents/selected_route.py` 的 `execute_selected_route()` 要求 `SupabaseClient` 读点位、与同会话搜索路径(已读 Neon/CatalogClient)不同步的跨库混读 bug,**Iteration 1 enabler 修复**(修 bug 性质,非新功能);② 新建用户域表一律生在 Neon(经 SD-1 工具链);③ Supabase 侧 catalog 域表(points/bangumi/aliases 等)冻结写入并标注废弃(**不在本列车删除**,留稳定期);④ 既有 `sessions`/`conversation_messages`/`routes` 数据迁移到 Neon 作为 **Iteration 2-3 独立 story**(prod 数据量近零,一次性脚本,非零停机双写);⑤ 远期 Neon Auth 迁移彻底退役 Supabase——**不进本列车**(future wave) |
| D9 | Pulumi IaC | non-goal(main 已有 `infra/`) | **例外**:root `wrangler.toml` 的 R2 bucket 绑定(X1 pmtiles、Iteration 4 用户上传)直接声明,不经 Pulumi |
| D10 | 多环境 | non-goal | 现状单环境 tag→prod |
| D11 | i18n | 保留 | spike 的 Context+字典机制直接沿用 |
| D12 | 测试策略 | 保留 + 补洞 | backend `--cov-fail-under=80` 与 CLAUDE.md 一致;**frontend 覆盖率口径不一致**(CLAUDE.md 写 72/68/62/59,实测 `frontend/vitest.config.ts` 已 85/82/71/80)——两者均为旧 `frontend/` 历史值,随包删除作废,`apps/web` 从迭代 0 实测值起建新地板;agent-eval 由 `if: false` 改判**分层常开**(X8) |
| D13 | tag-based deploy | 保留机制,重写内容 | web job 不得依赖 `frontend-out`/`.open-next` artifact;**新增**:`workers/users` 作为第三个 TS 服务需要与 `workers/catalog` 同等的 CI(`_ts-ci.yml` 新调用)与 `deploy.yml` 部署步骤(S2.8) |

### X1-X15 架构补充意见(主会话追加,2026-07-06 全天)

| # | 意见 | 落点 |
|---|---|---|
| X1 | **地图选型 ADR**:MapLibre GL + Protomaps(pmtiles 存 R2),static-first;**禁用 Mapbox**——所有设计文档中的 "Mapbox"/"Mapbox GL"/"Mapbox Static" 一律读作 "MapLibre GL + Protomaps";pmtiles 的 HTTP range 请求与 Walk 离线 SW 缓存复用同一基础设施 | S0.4(ADR+spike,新增 R2 bucket);S3.6(Walk 离线引用);S1.4/S1.5/S2.2/S5.2 一律 MapLibre,移除 `NEXT_PUBLIC_MAPBOX_TOKEN` CI secret(S0.3) |
| X2 | **Chat 首 token SLO**:warm p95 ≤3s + 容器保温(min instances 或 cron ping,机制留 execution-time 定);**SD-4 后升级为硬性要求**,不是软目标 | S1.2 `-> api`,硬 AC |
| X3 | **BYOK × Logfire scrub**:key 必须从所有日志/trace(Logfire span、structlog 输出)剥除,需测试证明不落任何观测面 | S1.11 硬 AC `-> integration` |
| X4 | **全局日预算熔断**:匿名入口全局日成本超 env 阈值时自动降级弹登录墙 | S1.8 `-> unit/api` |
| X5 | **Edge 认证模型变更显式化**:「edge 强制认证」→「edge 放行匿名+Turnstile+配额标记,容器按新信任规则处理匿名」 | S1.8 enabler + S0.9 文档回写(前瞻声明→S1.8 落地后回填既成状态) |
| X6 | **图片管线客户端化**:resize/压缩/合成全在客户端 canvas,R2 只存成品;分享物默认剥 EXIF,回传维持 opt-in | S4.2/S4.6/S4.7 |
| X7 | **SW/SSR 绕行规则**:SW 对 `/s/:id`、`/anime/:id` 走 network-first,不缓存旧 SSR HTML | S3.6(前瞻规则)、S4.3(`/s/:id` 落地验证)、S5.1(`/anime/:id` 落地验证)`-> browser` |
| X8 | **eval 分层常开**:5 条 smoke 进 PR 门禁(`apps/agent/**` 触发),617 全量 nightly+手动;取代 `if: false` | S0.1;S7.1 依赖 |
| X9 | **D7 双双 REJECTED**(Pyodide 与 TS 重写皆非,SD-4 终局) | 见 D7 行;S0.9 收敛三代文档 |
| X10 | **平台能力适配层(多端纪律)**:`apps/web/src/platform/` 薄接口(camera/geo/haptics/wake-lock/clipboard-share),组件禁止裸调 `navigator.*`;web 打底,Capacitor 后插 | 见下「全局约定」+ S1.3/S2.5/S3.3/S4.2/S4.6 |
| X11 | **SDK 战略(契约即产品)**:①自家 web 一律走 `/v1` 公开 API,禁私有后门(全程纪律,已写入 G4);②oRPC 契约自动出 OpenAPI;③`@seichijunrei/sdk`(npm)= contract client 薄壳;④现有 `apps/agent/agent/clients/python/seichijunrei_client.py` 转正为官方 Python SDK(维持手写薄客户端,不上 codegen);⑤迭代 7 的 MCP server/A2A 必须是 Workers 侧薄适配器,跨运行时调用容器 `/v1`,零业务逻辑(SD-4③ 精确措辞) | ①②已并入 G4;③④⑤展开为 S7.5/S7.6/S7.7,MCP 新增 S7.4 |
| X12 | **用户域 enabler 归属**——**已被 SD-2 终局取代**,不再是"仅记录方向/讨论中" | 见 G4 行、下方 SD-2 |
| X13 | **迁移工具链**——**已被 SD-1 终局取代**(双链 + atlas-provider-drizzle,非"弃 atlas") | 见下方 SD-1 |
| X14 | **edge worker 转正**——**已被 SD-6 核证修正**:worker 已是 TS + 16 测试用例,唯一缺口是未接入 CI | 见下方 SD-6;S0.3 |
| X15 | **catalog 数据质量门**:作品公開页/programmatic SEO 上线前,catalog publish 阶段加行级校验(坐标有效性/去重/話数完整性)+ 数量漂移告警——垃圾数据×SEO 放大器=垃圾页面工厂 | S5.7(新增) |

### SD Interview 结论(2026-07-06,系统设计访谈终局版——评审版 Decision Log 以本节为准,取代 X12/X13/X14 的临时状态)

| 轮次 | 结论 |
|---|---|
| SD-0 域名 | 调研中,`animichi.com` 为基准对照;`CANONICAL_DOMAIN` 保持参数化——**唯一仍未决项**,不影响本 spec 写作 |
| SD-1 迁移链 | **双链 + atlas-provider-drizzle**:Neon 侧 `workers/catalog/src/db/schema.ts`(Drizzle TS schema)为唯一真相 → atlas-provider-drizzle 生成期望态 → `atlas migrate diff/lint/apply`(versioned,`db/migrations`);Supabase 侧 `supabase` CLI 不变;边界与 CI 步骤写入 `docs/ops/migrations.md`(S0.9) |
| SD-2 用户域访问 | **API-first,全走 `/v1`**:用户域 CRUD = `workers/users`(新建 TS 服务)的 oRPC 路由 `/v1/users/*`,契约进 `packages/contract`;`apps/web` 的 `supabase-js` **仅用于 auth**;RLS 不作为访问路径;迭代 7 SDK/MCP 零改造复用同一契约 |
| SD-3 数据面 | Supabase 收缩为纯 auth,数据归 Neon——5 个子点见 D8 行 |
| SD-4 agent 运行时 | Python FastAPI 容器定案,不再议——依据与推论见 D7 行 |
| SD-5 会话状态 | Iteration 1 前端**沿用现状端点**(Supabase `sessions.state` JSONB + `conversation_messages`,best-effort 写,无事务保证);随 SD-3④ 迁 Neon;此不确定性记入 §⑨ 风险登记 |
| SD-6 edge worker | X14 核证修正:`worker/` 已是 TS + **16 个测试用例**(`entry.test.ts` 11 + `auth.test.ts` 5,Planner 用 `grep -c` 核实),唯一缺口是**这些测试从未接入任何 CI job**(Planner 核实:`.github/workflows/ci.yml` 的 `changes` path filter 里没有 `worker/**` 条目,`_ts-ci.yml` 只被 `component: catalog` 调用)→ S0.3 补一个新 CI job;Turnstile/配额在其上追加(S1.8-S1.10) |

**Planner 核证的补充代码级证据**:
- `packages/contract/scripts/emit-openapi.ts` 目前只覆盖 `catalogContract`(agent↔catalog);SD-2 的 `/v1/users/*` 契约是全新增量,不是对现有 `openapi.json` 的扩展。
- `apps/agent/agent/agents/selected_route.py` 第 30-31 行 `if not isinstance(db, SupabaseClient): return _error_result(...)` 与第 33 行 `db.points.get_points_by_ids(point_ids)` 确认 SD-3① 所指的跨库读取路径。

### 全局约定:平台能力适配层(X10)

`apps/web/src/platform/` 建一层薄接口,封装 camera / geo / haptics / wake-lock / clipboard-share 五个原生能力;**产品组件禁止裸调 `navigator.*`**,一律经这层。Web 实现打底,Capacitor 实现留空占位(环闭合后按 D3 后插同一接口,组件代码零改动)。凡涉及相机(対比図)/定位+震动(Walk、Chat 位置权限)/剪贴板+分享(しおり、路线详情跨设备交接)的 story,AC 要求「经由适配层」`-> unit`。

### 全局约定:用户域数据访问路径(SD-2 定案,终局,取代此前"讨论中"状态)

用户自有数据(路线保存、打卡、しおり、分享 token、対比図上传)一律经**新建的 `workers/users` TS 服务**的 oRPC 路由(`/v1/users/*`)访问,数据落 **Neon**(经 SD-1 的 Drizzle+atlas-provider-drizzle 工具链建表),契约进 `packages/contract`。具体规则:
- `apps/web` 的 `supabase-js` **仅用于 auth**(`getSession()`/JWT),不再直连任何数据表,不使用 RLS 作为访问路径。
- 对 `/v1/users/*` 的调用携带 Supabase 签发的 JWT 作为 bearer token,`workers/users` 校验 JWT 后以 `sub` 关联 Neon 侧的 `user_id`。
- `/s/:id` 的 SSR loader 同样经 `/v1/users/*`(其中的公开只读子路由,如按分享 token 查询)做服务端调用,不做客户端 RLS 直连。
- `workers/users` 是继 `workers/catalog` 之后 monorepo 的第二个用户可见 TS 服务;`pnpm-workspace.yaml` 的 `workers/*` 通配已覆盖,无需新增工作区配置;但 `.github/workflows/ci.yml` 需新增 `ci-users` job(复用 `_ts-ci.yml`,`component: users`),`deploy.yml` 需新增部署步骤(镜像 catalog 的部署顺序:先部署 `workers/users`/`workers/catalog`,再部署 root Worker)。

**此结论取代**本 spec 早前版本(rev 1-4)"当前按 RLS 直连方案撰写,可能改判 API-first"的暂定框架——SD-2 已是终局,不再有不确定性。受影响的 story(S1.7 部分、S2.8、S2.9、S3.7、S3.9、S4.5、S4.7)均已按本结论撰写。

### 主会话设定的默认项(可被用户推翻)

- PR #206(atlas CI 修复)列为**迭代 0 前置条件**,不是本列车 story——见 §⑩。
- `animal-island-ui-tailwind` 升级到 **1.0.x 最新**,兼容性验证进 S0.2/S0.5。
- **Zen Maru Gothic 自行 @import 为硬性 AC**。
- D7(REJECTED,终局)、D9/D10(non-goal)、SD-3⑤(远期 Neon Auth 迁移)、Supabase catalog 表的**实际删除**(只标废不删)——均不在本列车动手,只记录/标注。
- Capacitor 推迟到环闭合后;本列车保证不做阻断它的架构选择(X10 适配层正是为此铺路)。
- 域名参数化为 `CANONICAL_DOMAIN`(当前生产值 `seichijunrei.zhenjia.org`;SD-0 仍在调研,不阻塞开发)。
- 设计导出已入库,作为 Tester 视觉基准(oracle)。
- **Planner 补充默认(本 spec 判断,标记供 Coordinator/用户复核)**:
  1. `apps/web` 覆盖率地板从迭代 0 实测值起建,不继承旧 `frontend/` 或 CLAUDE.md 的陈旧数字(D12)。
  2. R2 bucket 采用同一个桶 `seichijunrei-assets`、前缀区分(`/tiles/*` 给 X1 pmtiles、`/uploads/*` 给 Iteration 4 用户上传);presigned 上传 URL 由 root Worker(`worker/app.ts`)新增一个轻量路由签发。
  3. `workers/catalog` 目前**零公网暴露**(`wrangler.toml` 注释明写"无公开 `/catalog/*` 路由");Iteration 5 为满足 catalog 域数据的公开访问需求,须**新增少量公开只读路由**——推荐做法:复用 root Worker 现有的 `isPublicV1` 白名单模式,新增 `isPublicCatalog` 白名单,转发到既有 `env.CATALOG` service binding。此为本列车对 catalog 服务**唯一一次**扩大暴露面,需 eng review 确认。**注意**:这与 `workers/users`(用户域,SD-2)是两个独立的新增服务面,互不替代。
  4. 既有 agent 数据端点(`GET /v1/routes`、`GET /v1/bangumi/*`、`GET /v1/search/preview`)本列车**不强制迁移/不强制砍**——SD 结论解决的是"新用户域能力去哪"(答案:`workers/users`),不要求立刻搬空 agent 里的存量端点,删除与否留后续 wave。

### 用户附加 scope(SEO/GEO + 覆盖矩阵)已按迭代摊派,见迭代列车表与 §⑥。

---

## ③ 迭代列车总览表

| 迭代 | 主题 | Story 数 | 详细度 | 核心交付 | 文件 |
|---|---|---|---|---|---|
| 0 | 地基 | 9 | 全量细化 | apps/web skeleton + 部署链修复(含 worker/** CI 接线,SD-6)+ 地图 ADR + eval 分层 + DS 底座 + spike 搬运 + 删旧前端 + SEO 地基 + 文档回写(含 X5/X9 收敛 + `docs/ops/migrations.md`,SD-1) | `2026-07-06-frontend-rebuild/iter-0.md` |
| 1 | 計画:Chat | 11 | 全量细化 | Chat Phase 1 单列流全态(44 态)+ 匿名放开/配额/Turnstile/BYOK(各自独立 story)+ P5 登录墙 + 首 token 硬性 SLO + `selected_route` 跨库 bug 修复(SD-3①) | `iter-1.md` |
| 2 | 承接:详情+列表 | **9** | 全量细化 | 路线详情 v2 + マイルート本棚 + 保存/列表 enabler(`workers/users` oRPC + Neon,SD-2 定案)+ sessions 数据迁移(SD-3④) | `iter-2.md` |
| 3 | 歩く:Walk | **9** | 开工前细化 | Graduation 转场 + Walk 10 态 + 离线一步到位(含 pmtiles range 复用、SW network-first 前瞻规则)+ 打卡 enabler(`workers/users` oRPC + Neon)+ fox sprite + conversation_messages 数据迁移(SD-3④) | `iter-3.md` |
| 4 | 残す:しおり | 7 | 开工前细化 | しおり版式族(客户端图片管线,默认剥 EXIF)+ /s/:id 公开分享(SSR,经 `/v1/users/*` 公开子路由读)+ 対比図作成(客户端 canvas)+ R2 上传(presign worker 路由) | `iter-4.md` |
| 5 | 発見:作品页+首页 | 8 | 开工前细化 | 作品公開页 A 図鑑型(SSR)+ catalog 新公开 oRPC 路由 + 数据质量门(X15)+ 首页 + programmatic SEO/GEO | `iter-5.md` |
| 6 | 工作台 | 6 | 开工前细化 | Chat Phase 2 桌面双栏(地图常驻/lightbox/SP8/SP9) | `iter-6.md` |
| 7 | 开放接口 | 7 | 开工前细化 | eval gate 解禁 + agent skill + A2A + MCP(均 Workers 侧薄适配器,跨运行时调容器 `/v1`)+ OpenAPI 发布 + npm SDK + Python client 转正 + llms-full.txt | `iter-7.md` |

**依赖链**:Chat 产路线 → 详情/列表承接保存 → Walk 走路线 → 残す留成果 → 発見引新人 → 工作台增效 → 开放接口对外。

**Story 数超「3-8」guideline 的说明**:Iteration 0(9)因 X1 地图 ADR + X8 eval 分层追加必做项;Iteration 1(11)因特别要求「匿名放开+配额+Turnstile+BYOK 各自独立 story」与 44 态全量细化叠加;Iteration 2/3(各 9)因 **SD-3④ 明确要求 sessions/conversation_messages 迁移各自独立成 story**;Iteration 7(7)因 X11/SD-4③ 把 SDK/MCP 战略展开为独立交付。均已按"单执行者一天可完成"逐条核实。

---

## ④ Releasable 定义

每个 story merge 到 main 后必须满足:

1. CI 全绿(lint + typecheck + test + coverage ratchet,不新增抑制注释)。
2. 打 tag 即可部署 prod,无需额外手动步骤。
3. 部署后**无死路 UI**——每个可见入口要么有真实现,要么按设计稿呈现降级态/空态,绝不裸白屏/裸报错。
4. `/healthz` 的 `git_branch` 字段可验证已部署到对应 commit。
5. 视觉与对应画布一致——Tester 用设计原稿逐态截图比对。
6. 三语(ja/zh/en)文案完整。

---

## ⑤ 全局 DoD

在 ④ 基础上叠加:

- 每条 AC 有测试类型注解(`unit|integration|eval|browser|api`)且 `ac_total == ac_with_test`。
- 不新增任何 lint/type 抑制注释。
- 覆盖率阈值只升不降,新代码提升覆盖率时回填阈值配置。
- Lighthouse CI CWV 预算:LCP ≤2.5s、CLS ≤0.1,迭代 0 起生效。
- 素材类 story 含「用户过目收编」人工 AC。
- 每迭代结束 Tester 按对应画布逐态走查。
- **X8**:agent 行为面变更(迭代 7 首当其冲)须先有 5-smoke PR 门禁 + 617 全量 nightly 跑通。
- **X3**:任何携带用户凭据/密钥的请求路径,合并前须有"密钥不落观测面"的 integration test。
- **X10**:任何新增的 camera/geo/haptics/wake-lock/clipboard 调用必须经 `apps/web/src/platform/`,不得裸调 `navigator.*`。
- **SD-2/G4**:任何新增后端能力先问"这是 catalog 域 / 用户自有数据 / 会话编排"三选一;catalog 域进 `workers/catalog`,用户域进 `workers/users`,禁止在 agent 服务新增数据端点。
- **X2/SD-4**:Chat 首 token warm p95 ≤3s 是硬性门禁,不是软目标。

---

## ⑥ 设计稿覆盖矩阵

`docs/design/2026-07-06-design-sync/` 顶层实测 **24 个 `.html`**(见 §⑪ 核实说明,与 inputs 文件行文"21"不一致,已按实测 24 归属)。

### HTML 画布(24)

| # | 文件 | 归属 | 实现/参照 story | 备注 |
|---|---|---|---|---|
| 1 | `Splash 静态版.html` | 实现 | S0.7 | 现行·移动开屏昼/夜两帧,≤800ms,无 JS |
| 2 | `Splash - Seichijunrei.html` | **留档不实现** | — | 动效探索版;fox 小跑记忆点已抽取进 S3.8/S0.7 |
| 3 | `Landing - Seichijunrei.html` | 实现 | S0.6 | spike 已建,Iteration 0 搬运收编 |
| 4 | `首页 - Seichijunrei.html` | 实现 | S5.5 | App Home:搜索/続きから/人気ランキング |
| 5 | `Chat 完整状态.html` | 实现(参照) | S1.1–S1.7 | 可点 demo,7 态 |
| 6 | `Chat 状态总览.html` | 实现(**主交付**) | S1.1–S1.11 | 44 态全量映射;含 C2t 帧(§⑧) |
| 7 | `Chat 初始状态.html` | **留档不实现** | — | 旧版仅 2 态,被 #6 取代 |
| 8 | `DS 补全 - Chat 桌面.html` | **规范画布** | S0.5、S6.* | Token/图标/组件状态矩阵权威源 |
| 9 | `工作台 - 地图常驻方案.html` | 实现 | S6.1–S6.6 | Phase 2 桌面双栏 |
| 10 | `Graduation 转场 - Storyboard.html` | **规范画布**(F0-F5) | 实现于 S3.1 | 纯 storyboard,无可点交互 |
| 11 | `Walk 状态总览.html` | 实现(主交付) | S3.2–S3.5 | 10 态,定稿 W-B′全出血 |
| 12 | `Walk demo.html` | 实现(交互参照) | S3.2–S3.5 | 真打卡 vibrate+撤销、构图对照滑杆 |
| 13 | `路线详情 状态总览.html` | 实现(主交付,当前 v2) | S2.1–S2.6 | 单页活文档 |
| 14 | `路线详情 demo.html` | 实现(交互参照) | S2.1–S2.6 | localStorage `route-demo-v1` |
| 15 | `路线详情 状态总览 v1.html` | **留档不实现** | — | archived;`spec-route-detail.md` 首行裁决 v2 为准 |
| 16 | `しおり share 状态总览.html` | 实现(主交付) | S4.1–S4.4 | 版式族+生成屏+公开页 |
| 17 | `しおり demo.html` | 实现(交互参照) | S4.1–S4.4 | 逐枚勾选实时换版式 |
| 18 | `作品公開页 状态总览.html` | 实现(A 図鑑型)/**留档**(B ポスター型) | S5.1–S5.3(A) | 同文件两变体,只建 A |
| 19 | `作品公開页 demo.html` | 实现(交互参照,A) | S5.1–S5.3 | 泡 tap→zoom→機位 sheet |
| 20 | `マイルート 状态总览.html` | 实现(A 本棚)/**留档**(B 予定表) | S2.7(A) | 同文件两变体,只建 A |
| 21 | `マイルート demo.html` | 实现(交互参照,A) | S2.7 | きょうあり/なし/空态 3 档 |
| 22 | `対比図作成 状态总览.html` | 实现 | S4.6 | CMP-0~4,5 态 |
| 23 | `対比図作成 demo.html` | 实现(交互参照) | S4.6 | 真 getUserMedia+canvas 合成 |
| 24 | `前端全景 - Journey Hub.dc.html` | **索引画布** | — | 纯导航,索引本身滞后,设计侧自维护,非本列车修复对象 |

### md / 结构性文档

| 文件 | 归属 | 说明 |
|---|---|---|
| `docs/user-journey.md` | 规范画布(权威五件套) | 全部迭代场景/情绪依据 |
| `docs/DESIGN.md` | 规范画布(权威五件套) | frontmatter 缺 explore/walk/map-*,S0.5 回填 |
| `docs/spec-chat-page-states.md` | 规范画布(权威五件套) | Iteration 1 状态机来源(44 态) |
| `docs/spec-chat-page-design.md` | 规范画布(权威五件套) | 地图部分按 X1 改读 MapLibre |
| `docs/spec-route-detail.md` | 规范画布(权威五件套) | Iteration 2 唯一来源 |
| `docs/card-user-journey.html` | 规范画布(权威五件套,APPROVED 视觉锚点) | 范围判断权威 |
| `docs/journey-走查.md` | 规范画布(Q1-Q5 权威来源) | 已被 §⑧ 吸收 |
| `docs/ds-审计.md` | 规范画布 | P0 交付物已进 DS 补全画布,已被 S0.5 吸收 |
| `fox-walk-spec.md` | 规范画布 | S3.8 唯一依据 |
| `generative-ui.md` | 规范画布 | Iteration 1/6 Phase1/Phase2 分界依据 |
| `design-project-log.md` | 索引画布(Step 日志) | 溯源用,非交付物 |
| `AI_USAGE.md`(design-sync 根) | 规范画布(上游包 API 手册) | 非本项目产出 |
| `skill/SKILL.md` | 规范画布(像素级样式指南) | 非本项目产出 |

### assets(按目录分组)

| 目录/文件 | 归属 | 消费 story |
|---|---|---|
| `assets/fox/*.svg`(11 姿势) | 实现 | S1.2/S0.7/S3.2;S3.8 新增小跑 sprite |
| `assets/img/*` | 实现 | S0.6/S5.5 装饰;非 DS 补全 S2 的 20 枚图标系统(另一条线) |
| `assets/compare/{anime,real}.jpg` | 实现(参照素材) | S4.6,不随产品发布 |
| `assets/torii.svg` | 实现 | S0.6 页头品牌标志 |
| `assets/fonts.css` | 实现 | S0.5 直接 vendor |
| `assets/index.css`/`assets/core.css` | **不采用** | 一律走 DS bundle token |
| `_ds_bundle.js`/`support.js`/`image-slot.js`/`tweaks-panel.jsx` | **不采用**(画布工具脚手架) | 业务代码禁止 import |

---

## ⑦ Non-goals

- **D7 Agent Pyodide Worker 化 / TS 重写 — 双双 REJECTED**(SD-4 终局,不再议)。
- **D9 Pulumi IaC 扩展**(R2 bucket 例外)、**D10 多环境**:均不做。
- **SD-3⑤ 远期 Neon Auth 迁移**(彻底退役 Supabase auth):future wave,不进本列车。
- **Supabase catalog 域表的实际删除**:本列车只标废冻结(SD-3③),不执行删除。
- **既有 agent 数据端点整体迁移**(`resolve_anime`/`search_bangumi`/`search_nearby` 等工具改经 catalog 读):方向性已确认(原 X12),但不在本列车动手,留后续 backend wave。
- **Capacitor 集成**:推迟到环闭合后,本列车零代码。
- **catalog 独立部署 job 的历史遗留问题**(root Worker 部署仍是手动 workflow):不在本列车修,但 `workers/users` 新增部署步骤会与 `workers/catalog` 使用同一套 CI/部署模式(S2.8)。
- **J16 同行协作**:原设计导出无对应页面,不产出。
- **Chat 规模场景 supercluster GL/mega-map(>500 点)**:按原判"余量设计,推迟实现"。
- **しおり OG 竖图渲染管线的像素级实现细节**:功能性 AC 在 Iteration 4 给出,细节留 Executor 开工前细化。
- **A2A/MCP 协议版本的第三方合规认证**:只做功能性薄适配器,不做协议认证审计。

---

## ⑧ 设计未决项与默认

### 8.1 `spec-route-detail.md` §9 的 2 项「待用户过目」

| 项 | 推荐默认 | 落点 |
|---|---|---|
| 段头徒歩合计 | **显示**:段头格式"件数+徒歩合计+跨度"按现有文案直接采纳,信息密度目标一致 | S2.4 |
| ★目标接 Walk | **本迭代先不接**:详情页★标记仅页内生效,Walk 的待复刻构图清单复用路线自身 scene-thumb 数据,不做跨页状态同步;用户推翻则追加到 S3.4 | S2.4(不接)/S3.4(备选) |

### 8.2 `journey-走查.md` §4 的 Q1-Q5

| # | 问题 | 推荐默认 | 依据 | 落点 |
|---|---|---|---|---|
| Q1 | 路线前提怎么来? | **方案甲**:缺失时 clarify 一次(C2t 帧) | `ds-审计.md` 已裁决"出发时间+地点=必问(说全则跳过)" | S1.3 |
| Q2 | 计划版/完走版しおり? | **是,两种**:平日出计划版(无✓)、完走出記念版(带✓+完成率) | `spec-route-detail.md` §3 已有 CTA 文案证据 | S4.1/S4.2 |
| Q3 | A4 未登录访问 chat? | 已被 **G7** 取代,不再开放 | G7 | S1.8 |
| Q4 | 歩くモード入口三处都做? | **是**,与 releasable "无死路 UI" 直接冲突则必须都做 | ④ | S1.5/S2.3/S5.5 |
| Q5 | 写真から探す保留? | **保留为侧支线,降级优雅**:识别失败走 D1 兜底文案,不阻塞主线 | generative-ui.md 组件目录 | S1.3 |

### 8.3 C2t 帧

**正式采纳为规范**:`ds-审计.md` 已裁决"出发时间+地点必问",C2t 是该决策的具体实现,非孤立提案。落点 S1.3。

### 8.4 舞台毕业模型

**采纳**:已有完整 storyboard(F0-F5,时长/缓动已给出)。落点 S3.1。

### 8.5 D7 的评审期不确定性 — **已解决(RESOLVED)**

SD-4(2026-07-06)终局判定 D7 双双 REJECTED(Pyodide 与 TS 重写皆非)。此前 rev 1-4 记录的"可能修订"不确定性不再存在。

### 8.6 用户域数据访问路径 — **已解决(RESOLVED)**

SD-2(2026-07-06)终局判定 API-first(`workers/users` oRPC + Neon)。此前 rev 1-4 记录的"SD-2 讨论中"不确定性不再存在。

### 8.7(新增)唯一仍未决项:SD-0 域名

`animichi.com` 为基准对照,调研仍在进行。不阻塞任何 story 开工(`CANONICAL_DOMAIN` 参数化贯穿全 spec),只阻塞最终 DNS 切换与 canonical 值定稿。owner=用户。

---

## ⑨ 风险登记

| 风险 | 影响 | 缓解 | 涉及 story |
|---|---|---|---|
| `wrangler.toml [assets]` 断链 + `worker/entry.ts` 硬编码 `.open-next/worker.js` | 不修则无法部署 TanStack 产物 | S0.3 替换为 `cloudflare-module` preset 产物,Hono 路由不变;export 形状需集成测试验证 | S0.3 |
| Zen Maru Gothic 字体缺失 | 全日文产品字体事故 | S0.5 vendor + CI 断言 | S0.5 |
| DS 对比度 FAIL 2 处 | WCAG AA 不达标,与 Walk 户外可读诉求冲突 | 消费这两个 token 的组件加 a11y AC(≥4.5:1) | S0.5、S1.*、S3.* |
| `animal-island-ui-tailwind` 版本漂移 | 升级后组件 API/样式可能破坏性变更 | S0.2 锁 1.0.x 并跑视觉回归 | S0.2 |
| MapLibre+Protomaps 迁移是净新增(X1) | 零经验,pmtiles 生成/托管可能超预期耗时 | S0.4 独立 spike,卡住时先用插画静态底图路径撑到 Iteration 1 | S0.4 → 阻塞 S1.4/S1.5 |
| 容器保温成本 vs SLO(X2,现为硬性)| 常驻实例=持续计费;定时 ping=冷启动仍可能撞上 | 需用户确认预算上限;机制留 S1.2 开工前定 | S1.2,owner=用户 |
| 全局日预算熔断阈值(X4)无具体数字 | 太低误伤、太高失效 | env 变量可配置,不写死;上线前需用户给初始值 | S1.8,owner=用户 |
| BYOK 泄露面不止 Logfire(X3) | 只测一个 sink 会漏测其他日志路径 | S1.11 integration test 覆盖面需 Reviewer 显式核对 structlog/CI 日志等全路径 | S1.11 |
| PR #206 未合并 | 阻塞迭代 0 CI 基线 | 列为硬前置条件 | 全局阻塞 |
| eval smoke 5 条具体选取(X8) | Planner 不掌握 617 条内容 | AC 只锁"跨 5 主要 intent 路径各取 1 条"原则,具体 case 执行时定 | S0.1 |
| 域名未拍板(SD-0) | canonical/sitemap/OG/magic-link 白名单都依赖它 | 全用 `CANONICAL_DOMAIN` 参数化,先占位当前生产域 | S0.8,owner=用户 |
| `apps/web` 覆盖率地板起点未知 | 无法写死具体百分比 | 实测后写入配置注释,后续只升不降 | S0.2 |
| **catalog 首次公网暴露** | catalog 目前零公网面,新开 `/catalog/public/*` 白名单扩大攻击面 | 严格限定只读、白名单路径级,S5.4 需 eng review 签字 | S5.4 |
| **R2 presign 路由新增在 root Worker(非 agent/catalog)** | 新代码面,需防越权 presign(用户 A 拿到 B 的上传 URL) | S4.7 AC 要求 presign URL 按 JWT `sub` 限定前缀+短 TTL | S4.7 |
| **`emit-openapi.ts` 注释暗示"Python client 从 OpenAPI codegen"与 X11④"手写不上 codegen"矛盾**(Planner 核实发现) | 现有 `seichijunrei_client.py` 实际是手写 httpx 客户端,目标是 agent `/v1/runtime` 而非 catalog 契约 | S7.7 保持手写路线,顺手修正该文件的过时 docstring | S7.7 |
| **`workers/users` 是全新服务(SD-2)**,零既有代码/测试基线 | 与 `workers/catalog` 不同,没有"已有骨架只需接线"的便利;鉴权(JWT 校验)、CI、部署全部从零搭 | S2.8 需完整参照 `workers/catalog` 的既有模式(oRPC+Drizzle+CI+部署)克隆搭建,不要发明新模式 | S2.8 |
| **SD-3① 跨库 bug 修复的回归风险** | `execute_selected_route()` 改经 CatalogClient/Neon 后,选点旁路(E2)的行为需要与既有搜索路径完全一致,否则修 bug 变成引入新 bug | S1.7 的回归测试需覆盖修复前后两条路径返回同样的点位数据形状 | S1.7 |
| **SD-3④ 历史数据迁移**(sessions/conversation_messages/routes → Neon) | 虽然 SD 结论称"prod 数据量近零",但一次性脚本仍有小概率遗漏/格式不匹配的风险 | S2.9/S3.9 的 AC 要求迁移后有行数核对 + 抽样内容校验,不是"跑完脚本就算完成" | S2.9、S3.9 |
| **SD-5:会话状态 best-effort 持久化,无事务保证** | Iteration 1 沿用现状(Supabase JSONB best-effort 写),在高并发/中断场景下可能丢失部分会话状态,这是**已知且接受**的过渡期风险,不是本列车要修的 bug | 不在 Iteration 1 修复(SD-5 明确"沿用现状"),迁移到 Neon(S2.9/S3.9)后风险自然收敛 | 记录,不阻塞 |

---

## ⑩ Dependencies(spec 级)

- **PR #206** 必须先合并。
- 域名最终选择(SD-0)——不阻塞开发,阻塞 DNS 切换。
- `ANON_DAILY_COST_BUDGET_USD` 初始阈值需用户提供(X4)。
- 容器保温预算上限需用户确认(X2)。
- S0.4(地图 ADR+spike)完成前,S1.4/S1.5/S2.2/S5.2 的地图 AC 不能开工。
- S5.4(catalog 首次公网暴露)需 eng review 签字后才能合并。
- S0.9 的 `docs/ops/migrations.md`(SD-1)应先落地,S2.8/S2.9/S3.7/S3.9 的 Neon 迁移工作流参照它执行。
- S2.8(`workers/users` 首次搭建)是 S2.9/S3.7/S3.9/S4.5/S4.7 的地基,建议 Coordinator 排期时优先安排。

## ⑪ Verification Plan

- Coordinator 每迭代收尾:pull main → `supabase start` → `make serve` → `apps/web` 构建预览 → 等 `/healthz` 绿。
- Tester 逐迭代对照设计原稿做状态级截图走查。
- Reviewer 核对 `ac_total == ac_with_test`,Codecov patch ≥95%。
- Iteration 5 发布后跑 `claude-seo` 插件审计出分。
- Iteration 7 依赖 X8 门禁已存在,跑 baseline → 变更后比对 `score >= baseline - 10pp`。
- 全部通过后 Tester 打 tag,CI 部署 prod。

**Planner 核实说明**:覆盖矩阵实测 `docs/design/2026-07-06-design-sync/` 顶层为 **24 个 `.html`**(`ls *.html | wc -l` 核实),与 inputs 文件行文"21"不一致,已按实测 24 个逐一归属。本 spec 经历 5 轮追加澄清(X1-X9 → X10-X11 → X12-X15 → X13 勘误 → SD interview 终局结论),最终版已把 X12/X13/X14 的临时框架全部替换为 SD-1~SD-6 的终局判定,不再有"讨论中/可能改判"的悬而未决项(除 SD-0 域名)。所有故事拆分(尤其 Iteration 1/2/3 的后端 enabler)均已按 SD 终局规则从头撰写。
