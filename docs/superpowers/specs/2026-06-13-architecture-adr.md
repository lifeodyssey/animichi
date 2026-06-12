# ADR · 架构全量更新决策(数据平台为核心 + TS on Workers + Supabase 留任)

> 状态:ACCEPTED(2026-06-13,经 /plan-eng-review 交互评审 + Codex 独立冷评五项全采)
> 决策人:用户;评审链:D1(范围)→ 需求重置(用户四关切)→ D2(载体)→ Codex 评审 → D3(全采)
> 图表资产:`~/.gstack/projects/Seichijunrei-agent/designs/chat-mockups-2026-06-12/`
> 之 `system-design.html`(职责架构 v2,主文档)与 `architecture-rethink.html`(候选对比)

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

### 决策二 · 载体映射 = C2-S:全 TS on Workers + Supabase 留任

- 后端重写为 TypeScript 直跑 CF Workers(容器/Docker/代理消失;流接缝同语言消灭;
  类型 monorepo 共享)
- **Supabase 留任**:PG+PostGIS(geo 白拿)+ GoTrue(Phase 4 PKCE 投资保留,
  RN/Flutter 官方 SDK 满足 R10)
- C4(all-in CF:D1+better-auth)记为**可选后续收敛终态**,非现在
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

617 eval JSON 数据集(直用)· Supabase auth Phase4(PKCE/middleware,留任)·
设计系统+全套 spec(栈无关)· agent prompt/工具语义+守卫规则(平移蓝本,3,260 行)·
cluster_by_location 算法(union-find,port 到 worker)· KNOWN_LOCATIONS(圏命名)·
sql_agent 概念(守卫式灵活查询)· city backfill(归入 Enrich 段)

## 6. 未决事项

1. agent 框架终决:AI SDK+Zod 自建守卫(默认)vs Mastra —— 由 spike 裁决
2. system-design §4 开放问题 Q1-Q5(同步快路径阈值、重算频率、别名种子、
   会话存储归属、raw 保留期)—— 实现计划期定
3. eval 跑分器:Vitest 自建(默认,无供应商)vs Braintrust(promptfoo 已被
   OpenAI 收购,不选)
4. 监控/可观测:重写时定(logfire 的 TS 等价物)
