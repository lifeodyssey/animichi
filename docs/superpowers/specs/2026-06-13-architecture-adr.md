# ADR · 架构全量更新决策(数据平台为核心 + TS on Workers + Supabase 留任 → 全 Neon 收敛)

> 状态:ACCEPTED(2026-06-13,经 /plan-eng-review 交互评审 + Codex 独立冷评五项全采)
> 决策人:用户;评审链:D1(范围)→ 需求重置(用户四关切)→ D2(载体)→ Codex 评审 → D3(全采)
> 图表资产:`~/.gstack/projects/Seichijunrei-agent/designs/chat-mockups-2026-06-12/`
> 之 `system-design.html`(职责架构 v2,主文档)与 `architecture-rethink.html`(候选对比)
>
> **状态更新(2026-07 起,SUPERSEDED-IN-PART)**:本 ADR「决策二」的载体分工「**Supabase 留任(PG+PostGIS + GoTrue auth)**」已被后续决策修订,往**全 Neon**收敛:
> - **数据平台已迁 Neon**(SD-3,2026-07-06):PostGIS / 点位 / 用户域数据在 **Neon**,Supabase catalog 域表冻结待删。
> - **认证后端迁 Neon Auth**(SD-31,2026-07-07):当初被否的 Stack Auth 底座已换成成熟的 **Better Auth v1.4.18**,原否决理由过期;auth 收敛到 **Neon Auth**(`neon_auth` schema,RLS 原生,每个 Neon 分支自带独立 auth 环境),**Supabase auth 待代码集成落地后退役**。
> - 详见 `2026-07-06-frontend-rebuild-inputs.md` §七/§十 SD-3、SD-31。下文「决策二 / 框架选型 / 复用清单」中的 auth 相关处已就地标注更新;JWKS 端点一律走 `NEON_AUTH_JWKS_URL`(env/secret 注入),不硬编码主机名 / project-id(公开 repo)。

## 1. 背景与痛点

立项痛点:① CF 容器部署重 ② 流式协议接缝(PydanticAI↔Vercel adapter revert 79f34a8)
③ Route 类型前后端无法共享。评审中用户追加四个关切,**重置了讨论层次**:

- R10 移动端:未来 RN/Flutter 原生 app 的可能性
- R11 数据真实性:Anitabi/Bangumi 真实对接是最大瓶颈(被确认为最重需求)
- R12 基础设施收敛意愿(all-in Cloudflare?)
- R13 Code Sandbox 要不要

关键事实(实测/调研,详见图表资产):
- 三个立项痛点**没有一个是 Python 语言的痛**(部署形态/接缝/工具链)
- PostGIS 实际用法仅 ST_DWithin 半径检索;agent 灵魂 3,260 行;eval 案例为纯 JSON
- D1 无 R*Tree(issue 挂三年);better-auth 原生流需自组装;GoTrue 有 RN/Flutter 官方 SDK
- CF Workflows/Queues/Cron 全 GA → **数据管线无论后端语言如何都是 TS**(削弱保 Python 方案)
- Containers 2026-04 GA(Active-CPU 计费、百毫秒冷启动)→ 原地调优可行性上升,但接缝与双语言痛仍在

## 2. 决策

### 决策一 · 职责架构 = system-design v2(栈无关,先于载体冻结)

- **两条核心纪律**:agent/API 永远只读服务表;一切写入必经管线(无"顺手 insert")
- **Catalog 从 Agent 拆出**:agent 是数据平台的只读消费者,不在请求期调外部 API
- **数据平台三段**:Ingest(按需 + per-work TTL 增量)→ Enrich(质检隔离区、
  系列图谱、别名表、三层聚类预计算、城市回填、署名字段)→ Publish
- **Codex 评审五项全采**:
  1. 极简部署形态:1 Web/API 进程 + 1 关系库 + 1 后台 worker + 1 cron;
     §1 各"服务"是逻辑边界非部署单元;raw 先 JSONB,OG 同步渲染
  2. **版本绑定 = 原子发布**:cluster_version + route_snapshots,重聚类后旧路线/
     しおり/分享页永不漂移;版本指针切换免费实现蓝绿
  3. **Singleflight + 负缓存**:ingest_jobs(work_id) 唯一约束——分享页爆火
     (获客环成功时刻)不得击穿 Anitabi
  4. LLM 成本闸:per-session token 预算 + 工具调用上限 + 超限降级普通搜索
  5. **预收录 10-20 作品**,不押实时首次收录

### 决策二 · 载体映射 = C2-S:全 TS on Workers + Supabase 留任(auth/data 已收敛 Neon — 见状态更新 + SD-3/SD-31)

- 后端重写为 TypeScript 直跑 CF Workers(容器/Docker/代理消失;流接缝同语言消灭;
  类型 monorepo 共享)
- **Supabase 留任 → 已修订(SD-3/SD-31,2026-07)**:原方案 = PG+PostGIS(geo 白拿)+
  GoTrue(Phase 4 PKCE 投资保留,RN/Flutter 官方 SDK 满足 R10);**现方案 = 往全 Neon 收敛**——
  PG+PostGIS/数据在 **Neon**,auth 由 GoTrue 改为 **Neon Auth**(Better Auth 底座,
  `neon_auth` schema + 原生 RLS,每个 Neon 分支自带独立 auth 环境);R10(RN/Flutter 原生
  客户端)的诉求由 Neon Auth SDK 承接
- C4(all-in CF:D1+better-auth)记为**可选后续收敛终态**,非现在 **→ 更新(SD-31)**:
  收敛已发生,但落点是 **Neon(Neon Auth = Better Auth 底座)** 而非 CF D1——better-auth
  作为终态底座的判断成立,只是宿主为 Neon 而非 Cloudflare
- 前端暂留 Next.js+OpenNext;**TanStack Start 迁移 = 后端落地+环闭合后的独立决策点**
  (一次只烧一层;Start 已 GA 且 CF 一等公民,能力无障碍,纯排序问题)
- PWA:scope 锁定"歩くモード离线壳"(此前已决)
- Sandbox:YAGNI(sql_agent 已覆盖临时分析);CF Sandbox SDK 已 GA,需要时再接

### 决策三 · 迁移安全网 = eval-first

617 个 JSON eval 案例直接平移;先建 TS 跑分器并对 Python 现版定 baseline;
**parity gate:TS agent 不达 baseline 不切流**。agent 框架默认假设
AI SDK v5 + Zod + 自建薄守卫(ModelRetry 等价物 = 校验失败作为 tool result 回馈重试),
以 1-2 天 spike(两工具 + 20 案例对比)验证后终决(见未决 #1)。

### 决策四 · 与 journey 优先级的调和

**两周 Walk 子集先行**(Codex 两次独立运行同构建议):ingest CLI/worker(预收录)
→ 4 个 API(search/spots/routes/bundle)→ 窄入口 agent(失败退普通搜索)→
前端核心(结果卡/选点/地图/Walk mode)→ しおり客户端生成。
chat Phase 1 对着 TS 后端建,不在 Python 上做一遍再搬。
核心判断:**先证明现场那一屏能帮用户确认「我到了」,再付其余系统的运维成本。**

## 3. 后果

**正面**:三痛点全清;单语言单平台(+Supabase 托管件);数据从理想化假设升级为
一等公民平台;成功场景(分享爆火)有疫苗;旧路线永不漂移。
**负面**:agent+守卫平移是真工程(eval gate 兜底);两供应商;期间新页面若最终
迁 Start 需二次搬;Python 仓 30.6k 行渐冻(eval 数据与 prompt 语义平移后弃)。
**风险**:守卫层自建质量(spike+eval 验证);TS 重写期 journey 停摆
(以两周 Walk 子集对冲)。

## 4. NOT in scope(考虑过且明确推迟)

TanStack Start 迁移(后端落地后议)· all-in CF/D1(可选终态)· Code Sandbox ·
多 agent 编排(单域产品无需)· 向量记忆(マイルート即产品化记忆)· SEO 规模化 ·
同行协作(journey J16 后置)· Dynamic Workers(beta 不押)

## 5. What already exists(复用清单)

617 eval JSON 数据集(直用)· Supabase auth Phase4(PKCE/middleware)**→ SD-31 起由 Neon Auth 承接,Supabase auth 集成落地后退役**·
设计系统+全套 spec(栈无关)· agent prompt/工具语义+守卫规则(平移蓝本,3,260 行)·
cluster_by_location 算法(union-find,port 到 worker)· KNOWN_LOCATIONS(圏命名)·
sql_agent 概念(守卫式灵活查询)· city backfill(归入 Enrich 段)

## 6. 未决事项(2026-06-13 五路调研后更新)

1. ~~agent 框架~~ **已由证据裁决:AI SDK v5**(Mastra 经 CloudflareDeployer 的 SSE
   被缓冲 TTFB~10s,issue #13584 open——打在 R2 流式心脏上,出局);spike 降级为
   7 项风险验证(见 §7)
2. system-design §4 开放问题 Q1-Q5 —— 实现计划期定
3. ~~eval 跑分器~~ **已定:Evalite**(v0.19,Vitest 原生;API 稳定性存疑则换
   `@getsentry/vitest-evals`;promptfoo 被 OpenAI 收购不选;Langfuse 在 Workers
   上 OTel 不通,同平台联动证伪)
4. ~~可观测~~ **已定:`@pydantic/logfire-cf-workers`** —— 与 Python Logfire 同
   dashboard,观测栈零迁移连续;AI SDK `experimental_telemetry` 的 OTel spans 自动捕获
5. Protomaps OSM 日文标注质量 —— spike 顺带实测
6. Serwist 与 OpenNext 的 sw.js 路径兼容 —— PWA 卡实测

## 7. 框架选型总表(五路并行调研定案,2026-06-13)

> 标尺:实现难度最低。证据与坑详见调研记录(designs 目录会话产物)。

| system-design 框 | 选型 | 关键坑/备注 |
|---|---|---|
| HTTP 框架 | **Hono** | Workers 事实标准;SSE 用原生 ReadableStream 绕开一切中间件缓冲 |
| 端到端类型 | **oRPC** | 原生 OpenAPI 输出 → 未来 RN 白拿(R10);Hono RPC 大型化有类型推断拖垮 CI 的实锤 |
| DB 访问 | **Drizzle(只查询)+ Hyperdrive + supabase migrations 保留** | Hyperdrive 连 5432 直连,勿叠 Supavisor 6543;PostGIS 走 `sql` tagged template;官方认证共存模式 |
| 认证 | **jose JWKS 本地验签(Workers,对 **Neon Auth** JWKS,端点走 `NEON_AUTH_JWKS_URL` env)+ **Neon Auth SDK**(前端 Better Auth client)** | **SD-31 更新**:auth 后端 = Neon Auth(退 Supabase GoTrue);仍本地缓存 JWKS(勿每请求打远端);前端由 @supabase/ssr 改为 Neon Auth SDK;每个 Neon 分支自带独立 auth 环境 |
| Agent | **AI SDK v5 + Zod + execute 内守卫** | v5 校验失败默认即 tool-error part 回喂(ModelRetry 软路径开箱有);repairToolCall 有 bug #8240 勿依赖;DeepSeek 用 `@ai-sdk/deepseek`(仅 deepseek-chat 支持工具) |
| 流式 | **createUIMessageStream + useChat DefaultChatTransport** | v5 不再传 api URL,要配 transport;有 Ably 生产案例 |
| 数据管线 | **Workflows(多步摄入)+ Queues(扇出)+ Cron** | step.do 断点续跑;本地 Local Explorer(2026-04 起);singleflight = ingest_jobs 唯一约束自查 |
| OG 图 | **satori + resvg-wasm** | 四坑:WASM 静态 import / 远程图转 base64 / 仅 PNG / 带 UA 头;Noto Sans JP 放 R2;需付费 Workers |
| 地图 | **MapLibre + Protomaps PMTiles on R2** | 无 token 无按请求费;静态首屏 mbgl-renderer 渲 PNG 存 R2;**离线地图改每站静态 PNG**(iOS 50MB 上限,矢量切片塞不下) |
| PWA | **Serwist** | 需 `next build --webpack`(Turbopack 不兼容);打卡队列 = idb + online/visibilitychange 前台 flush(iOS 无 Background Sync);**7 天未开全清 → 出发前夜屏负责重载 bundle** |
| 测试 | **vitest-pool-workers** | Workflows 内省 v0.9+;AI SDK 的 node 兼容进 spike 验证 |
| Eval | **Evalite + GH Actions threshold gate** | 617 JSON 直读;baseline 写成 `threshold: { average: 0.54 }` 断言 |
| 观测 | **@pydantic/logfire-cf-workers + experimental_telemetry** | 与 Python Logfire 同 dashboard(迁移期双栈对照);nodejs_compat 必开 |
| Monorepo | **pnpm workspaces 单用** | ≥5 包或 CI>30s 再上 turbo;`workspace:*`×wrangler 打包待实测 |

### Spike 风险验证清单(7 项,全过即转正)

1. repairToolCall 在 DeepSeek+Workers 是否触发(bug #8240)
2. Workers SSE → useChat 工具步骤逐帧可见(R2 命门)
3. 自定义 transport 带 Bearer token 过 jose 验签
4. 10 轮对话 + prepareStep 压缩后工具链上下文不丢
5. deepseek-chat 七工具多步顺序稳定(防无限循环)
6. AI SDK 在 vitest-pool-workers 里跑得动(node 兼容 flag)
7. logfire-cf-workers 捕获 experimental_telemetry spans(观测白拿验真)
