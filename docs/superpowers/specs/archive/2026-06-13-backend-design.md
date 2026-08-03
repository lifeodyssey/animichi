# Backend Design — 图片存储 · SSoT 分层 · Agent 设计 · Generative UI 辨析

> 2026-06-13。与 `api-contracts.html`(designs 目录,含全部图)互为镜像:HTML 看图,
> 本 MD 入库供实现引用。配套:`2026-06-13-agent-eval-spec.md`、
> `2026-06-13-architecture-adr.md`。设计阶段产物,不含实现代码。

## 1. 图片存储决策:自建轻 CDN(lazy R2)— 翻案

**问题**:拿到 Anitabi 图片后,放不放自己的对象存储?
**答:放。** 此前"只代理不落盘"基于对许可证的过度保守解读——CC BY-NC-SA 4.0
明确允许复制与再分发(Share),义务是署名+非商业+同协议;**缓存再分发合法**,
真正红线是 NC(商业化前须与 Anitabi 谈)。

```
Client → CF Edge Cache(30d)
              ↓ miss
         Worker /img/:pointId
              ↓ R2 有? ──HIT──→ 直出(零出口费)
              ↓ MISS(首次)
         上游回源一次 → Images binding 转 WebP ≤50KB → 写 R2(90d·LRU)→ 出
         上游 404 → R2 旧版继续 serve(墓碑图)
```

收益:上游挂掉不影响我们;**每图终生回源一次**(对 Anitabi 流量友好);离线
bundle 拉取快;成本美元个位数/月(R2 $0.015/GB·月,零出口费)。
义务落实:署名(origin/originURL)随 API 响应展示 + 同协议声明页。
连带修订:NFR"服务端零存储"条目作废;SSoT 表图片域改为"带源标注的再分发缓存"。

## 2. Single Source of Truth 分层(修正"Supabase 是真理"的错觉)

原则:**我们几乎不拥有事实——我们拥有"编排过的视图"+ 用户数据。**
Supabase 是 serving replica,每张表必须知道上游与重建路径。

| 数据域 | SSoT | 我们的角色 | 陈旧度策略 |
|---|---|---|---|
| 圣地点位/截图 | **Anitabi** | 带版本派生缓存(Raw 可全量重放) | TTL 增量同步;UI 标注「X 時間前に同期」 |
| 作品元数据/系列 | **Bangumi** | 派生缓存 | 长 TTL |
| **多语言名/别名** | **多源**:① Bangumi 官方名+infobox ② **AniDB anime-titles 每日 dump**(多语言同义词,免 API)③ **萌娘百科** MediaWiki API(中文社区简称"京吹"只有这有)④ 人工种子 | aliases 表带 source 标签,按优先级合成 | 别名升格为**独立摄入管线**——搜不到=流失第一现场 |
| 步行耗时 | 路网提供商(ORS→Google) | leg_cache 派生 | 长期缓存 |
| **路线/打卡/しおり** | **我们(Supabase)** | 唯一权威域 | 认真备份的只有这里(RPO 见 NFR) |
| 聚类/名場面 | 我们的算法(自 Anitabi 派生) | 可重算产物 | cluster_version 版本化 |

推论:① 备份焦虑收窄到用户数据域 ② "同步于 X 小时前"把延迟变诚实
③ 别名管线三上游,质量直接决定搜索命中率。

### 2.1 SSoT 终答:一句话判定 + 结构性保证

**原始域 SSoT = 上游;Supabase = 物化只读视图。派生域+用户域 SSoT = 我们。**

- **保证手段(结构非自觉)**:single-writer——Postgres GRANT 写死,app 角色对
  上游域四表只有 SELECT;唯一写者 = 同步管线角色。没有第二写者就没有真理分裂:
  上游恒真,我们恒是快照。想"修正"上游数据 → 去上游贡献,或写进自己的派生列。
- **速度**:SWR 语义——读永远打本地(<50ms)不等上游;过 TTL 后台对时。
- **陈旧契约**:bounded staleness + explicit freshness——响应带 synced_at,
  UI 显示「X時間前に同期」;SLA 按热度 24h/7d/30d;**「最新を確認」按钮**手动
  revalidate(singleflight)= 把逼真权交给用户。
- 三件套:**默认快、按需真、永远诚实**。

## 3. Agent System Design

### 3.1 需求清单(RA1-RA11)

RA1 五回合类型化输出(clarify/search/route/qa/greeting)· RA2 双守卫(参数非法
回喂重试 + 输出反编造)· RA3 每工具步骤一个 SSE 事件(管线卡逐帧)· RA4 多轮
状态(澄清候选恢复、上轮上下文、**A2b 引用路线**)· RA5 locale 强制 · RA6 旁路
共存(零 LLM 但共享规划引擎)· RA7 成本闸(token 预算/步数≤8/降级普通搜索)·
RA8 可评估性(steps 可录制回放)· RA9 数据纪律(只读服务表,miss 诚实报「收录中」)·
RA10 历史压缩 · RA11 扩展位(锚点委托/sql_agent/系列感知)

### 3.2 模式选型(对照 Anthropic Building Effective Agents)

| 模式 | 采否 | 落点 |
|---|---|---|
| 单 Agent + typed tools | ✅ 主体 | 现状形态保留 |
| Routing | ✅ 内置 | S1 主模型选工具即路由,**不另设分类器** |
| Prompt Chaining | ✅ 隐式 | resolve→search→plan 顺序由 output_validator 强制——链写在校验里不写在代码里 |
| **Evaluator-Optimizer** | ✅ 核心 | ModelRetry 双守卫即此模式——质量的真正来源 |
| Orchestrator-Workers | ❌ | 单域产品 |
| Parallelization | ❌ YAGNI | |
| Strategy | ✅ | 顺序三档注入规划引擎 |
| State | ✅ 升级 | tool_state 裸 dict → **typed SessionState**(Zod,序列化进 PG) |
| Budget/熔断 | ✅ | LLM client 外壳(RA7) |
| **Event Sourcing(轻)** | ✅ 关键 | steps 事件流**一产三销**:SSE(UI)/ Logfire(观测)/ eval 录制(faithfulness 的 tool_returns)——一条流喂三个消费者 |

### 3.3 组件(TS 形态,单模块非微服务)

```
AgentService
├─ SessionState(typed, Zod)      候选/pending_clarify/引用路线/origin
├─ GuardLayer                     入参守卫·输出反编造·注入检测
├─ BudgetedLLMClient              AI Gateway · token/步数预算 · 熔断降级
├─ ToolRegistry(7)                schema 与 oRPC 同源(Zod 单写)
├─ EventEmitter(一产三销)          SSE / Logfire / eval 录制
└─ HistoryCompactor               工具结果摘要+滑动窗口
DeterministicEngines(独立包,旁路共享):planner(全排列+剪枝)·聚类·leg_cache·TimedItinerary
```

相对 Python 现状的三个升级:typed SessionState;预算器前置为外壳;事件流一产三销
(eval 录制不再单独埋点)。其余为语义等价平移(平移质量由 617 案例 parity gate 验收)。

## 4. Generative UI 辨析与清单

**概念澄清**:Generative UI 的"生成"= 模型生成**选择**(渲染哪个组件、带什么
payload),不是生成**数据**。数据让 LLM 逐条生成是反模式(编造);数据走结构化
通道(DB 批量)恰是 best practice——output_validator 即此哲学的守卫。

**"逐个显示"的实现分两层,均不需要数据真流式**:
- 卡片间:每工具完成 = 一个 SSE part = 一张卡落位(一回合最多三拍,天然节奏)
- 卡片内:批量 payload 到达后前端 stagger 动画(80ms 间隔 entrance-up)——表演层
- (streamObject 真逐条流式为远期选项,YAGNI)

**清单**:
- ✅ generative UI(registry 注册):澄清卡 C2 / 地理澄清 C2g / 点位卡组 C3 /
  圏总览 C3b / LocationPrompt C4 / 路线卡 C5 / 管线·足迹(工具事件元渲染)
- ❌ 不是:情绪卡 B2c(时长触发=状态 UI)/ D 区错误卡(状态 UI)/
  SpotPicker·walk mode·share 页(导航页面)
- ➕ 内容生成机会(模型生成文字填预制组件):路线标题起名 · しおり寄语 ·
  追问 chips 文案——便宜、安全、人格感强

## 5. 摄入矩阵(2026-06-13 调研核实定稿)

| 数据域 | 来源 | 方式/节奏 | 许可 |
|---|---|---|---|
| 元数据+系列+官方别名 | **Bangumi Archive 周更 dump**(subjects+relations+infobox,~389MB jsonlines) | 周三 Workflow 拉包→upsert;首次全量种入 | 未明示,待官方确认 |
| 跨源 ID 映射 | BangumiExtLinker | 月更 | CC BY 4.0 ✅ |
| 英/罗马音别名 | anime-offline-database(经映射桥) | 周更 | ODbL ✅ |
| AniDB 标题 / 萌百简称 | 每日 dump / MediaWiki API | flag 可拆增补层 | NC ⚠ |
| 圣地点位 | Anitabi API(**确认无 dump**) | 六环增量 + 热度预收录 | NC ⚠(产品 NC 锚) |

许可策略:别名主干全商业友好派;NC 源可拆——每多一个 NC 依赖=商业化谈判多一个结。

### 5.1 "真·新作品"策略(铁律 v2,用户点题修正)

铁律 v1"请求路径永不等第三方"过粗。修正:**等待四有**——有预算上限、有实时进度、
有部分结果先行、有降级出口;且仅 chat 入口允许等(管线卡=等待容器),公开页仍只读已收录。

- **L1 前菜(<1s)**:dump 命中元数据 + Anitabi lite(~300ms)给前 10 点 + 总点数——第一帧就有内容
- **L2 预算内同步(≤8s)**:pointsLength≤~150(实测覆盖 90% 作品)→ 同步精简摄入
  (detail 1-2s + 轻质检 + 50m 聚类,写库标 `enrichment_level='basic'`),同回合可规划路线;
  摄入进度本身就是管线卡的流式帧
- **L3 超预算降级**:前菜可看可聊 +「全 N 点収録中」;用户停留则 SSE 完成事件→卡片原地升级
- 两段式摄入:basic(同步)→ full(夜间升级:翻译/名場面/三层聚类)——serving 行带 enrichment_level

## 6. Sandbox 终判 + 2026 模式生态终判(调研 I 实证,2026-06-13)

- **Sandbox 三场景全否**:灵活分析(sql_agent 已覆盖)/ Code Mode 工具调用
  (token 压缩为数千端点巨型 API 设计,3 步短链收益≈0,且 isolate 整块执行
  吞掉 per-step SSE——与体验本体冲突)/ 管线计算(自家代码)。
  重开触发器:① sql_agent 表达不了的分析需求实锤 ② 向第三方 agent 开放时
- **主架构不换**:typed tool-calling loop 在"短链、强类型、过程即体验"标尺下
  无期望收益为正的替代者。CF Agents SDK(DO 锁定>短链收益)⏸;LangGraph/
  多 agent ❌;Context Engineering 取其调优项(JIT 工具返回裁剪 ✅)
- **MCP server 独立 spike 采纳**:Catalog 暴露为 MCP(9,652 server、41% 企业
  采用的事实标准;社区已自发做 Anitabi MCP server=需求实证)——分发策略,
  与"回贡献 Anitabi"同构
- ReAct 显式思考四变体 = 提示层实验,由 eval 裁决(eval spec W2)

## 7. 未尽问题清算(2026-06-13 全量盘点补想)

1. **路线规划 = 定向越野非 TSP**:预算超载诊断(不默默丢点,三出口:贪心建议/
   升全日/分两日)· 默认站到站回环,给出发地则固定起点 open path ·
   **「≤10 站」升格产品规则**(全排列毫秒级的前提)· leg_cache 并行请求 +
   摄入期预热 top-20 机位 190 段
2. **搜索匹配**:NFKC 归一化 + alias_normalized 列 + pg_trgm GIN;
   精确>前缀>trigram>0.3;official>synonym>community × 热度排序
3. **basic→full 竞态已解**:路线只引用 stop50,L2 必须完成 stop50 聚类(写死);
   full 升级=同版本补列 UPDATE,永不破坏路线引用
4. **成本总账**:≈$10-15/月(Workers 5 + R2 1 + DeepSeek 2-5);
   Supabase Pro 触发器=首批真实用户
5. **RLS/安全**:用户三表 RLS(owner);share slug ≥10 位随机;chat 历史 90 天清;
   图片三义务(同协议声明页/失效挂六环/回贡献打招呼)
6. ReAct 默认先上 C(rationale 参数),B/D 进 eval 对比

## 8. 设计停止线

挂起项(infobox 解析器、cn_translated 管线、多日拆分、R2 LRU 参数、
Bangumi Archive 许可确认)→ spike/实现期解决。**设计文档至此封版:
再深的细节应该由代码而非文档回答。** 下一步 = spike(7+2 项)→ writing-plans 拆卡。
