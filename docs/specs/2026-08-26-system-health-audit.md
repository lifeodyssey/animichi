# 全系统体检报告 — 2026-08-26

- Status: REVIEW(owner 拍板优先级后转 triage)
- 基线:`origin/main` @ `66ceb49e8`(#1218 合并后)
- 方法:13 路并行审阅(9 路按包 + 4 路横切:造轮子/测试金字塔/CI-CD 合理性/框架规范),
  每路输出 P0/P1/P2 + `file:line` 证据;横切路的技术断言经 context7 对官方文档核实;§5b 第14路补审单列，其发现与量化不计入13路审阅结论。
  另含一条**已实锤**的活 bug 完整调查(代码链 + 数据库足迹 + edge tail 三方证据闭合)。
- 已知盲区:sub-agent 只读 HEAD,看不到 `docs/specs/` 的历史决策——migrator「造轮子」
  判定已按 #1046 战役史修正(见 §6.6)。

---

## 0. 执行摘要

今天从「staging 500」追出一条**七层缺陷链**(SSR 模块图 → 交付布局 → DB 所有权 →
迁移器空 schema 假设 → 错误体被丢弃 → 数据无重灌线 → chat 409 谎报断线),前五层已修,
后两层已定位。13 路审阅在此之上给出的最大结论:

> **单个机制大多有真实事故支撑、单点工程质量不差;系统性的病是同一类:
> 失败路径不是一等公民。** 失败时不留信号(waitUntil 吞错、canceled 零日志、
> cron 静默空转)、失败态没有测试替身(三个包的假 DB 永不报错)、
> 失败展示对用户撒谎(409 → 「连接断开了」)。

四个 owner 关注点的直接回答:

| 问题 | 回答 |
|---|---|
| 在造轮子吗 | **基本没有**。10 个候选 7 个假阳性(JWT/SSE 客户端/容器编排/NFKC 均已用官方 SDK)。唯一重轮子 = migrator 手写账本,但它是 #1046 战役中有尸检记录的备胎转正(§6.6),非无知自研;真缺口是 sse-starlette 的 ping/代理头(§2.3) |
| 测试太多了吗 | **形状健康(单测 87%,无倒挂),体量虚高在碎片化**:session 概念被 19 个文件、票号命名 12 个文件切碎;`test-inventory.test.ts` 把文件数做成 CI 门禁在主动阻止裁剪。合并可 258→~200 文件不丢断言(§4) |
| clean code 吗 | 分层与命名大体扎实(hexagonal 执行好、SD-19 边界完整);病灶在**死代码**(§5.2)与**陈旧注释**(§5.4)两类「声明与现实脱节」 |
| CI/CD 合理吗 | **不完全合理但未失控**:21,300 行流水线 vs 0 次生产部署,近 9 个月 51% 提交在维护它;最错配单点 = 共享脚本一变就重置 staging DB + 8/8 全重建;最该用没用 = Neon branch-per-PR;最不该省却省了 = 自动 smoke(§7) |

---

## 1. 活 bug(已实锤):chat 选系列 → 409 → 谎报「连接断开了」

### 1.1 证据链(三方闭合)

- **edge tail 直接观测**:`POST /v1/chat` clarify turn 200(wall 17.6s)→ 选系列 **409**(wall 0.6s)
  → 重点一次又 **409**(wall 6.4s)→ 前端 recovery 拉历史。连接全程未断。
- **数据库足迹**(三次独立复现一致):clarify 消息对落库;选系列 turn **零痕迹**
  (user 消息不落库、无 assistant、`ingest_jobs=0`)——因为 turn 在 admission 就被拒,model 未跑。
- **代码链**:
  1. clarify 选项按普通文本消息发送(`ClarifyCard.tsx:10`),且按钮不检查 `chat.status`
     (`ClarifyCard.tsx:52` 只看本地 phase);
  2. `pendingTurnId` 只在 `handleFinish` 判定真正完成时清空(`use-chat-session.ts:91-113`,
     AC6 幂等设计)——流未正式 finish 时点击,新消息**复用 in-flight `x-turn-id`**;
  3. admission 对同 turn_id + 不同请求体 → digest 不匹配 → 拒绝
     (`turn_admission.py:259-263` request_conflict / `admission.py:152-154` 均 409);
  4. 前端 `classifyHttpStatus` **没有 409 分支**(`error-classifier.ts:76-82`)→ 兜底 `"D4"`
     (`use-turn-failure.ts:44`)→ 文案「连接断开了」;
  5. 「重试」只拉历史不重发选择(`use-stream-recovery.ts:40-46`),ClarifyCard 永久锁死
     (`ClarifyCard.tsx:88-91` phase 无失败回退)→ 死路。且重试实测**新开 session 重发初始消息**。

### 1.2 修复包(三个设计改正,互相成全)

| # | 改什么 | 依据 |
|---|---|---|
| A | **clarify 选择走结构化回调**:点击发 `candidate.id` 进已有的确定性 bypass 通道(agent AGENTS.md:「candidate selections bypass the model」),气泡仍显示标题 | 业界快捷回复标准形态;省一轮 model;天然规避 turn_id 竞态;解锁双语渲染 |
| B | **幂等 key 绑消息不绑连接**:turn_id 从消息对象派生(AI SDK message id),`onFinish` 与幂等解耦;两条发送入口(文本 + `fireRecompute`,后者同病 `use-recompute-turn.ts:50-56`)统一 `status` 门控 | Stripe 型幂等 key 属于「一次意图」;框架规范路 F3-1 |
| C | **诚实错误映射**:409 逐 code 映射(冲突≠断线,重试语义相反);D4 兜底改诚实模糊文案 + 错误码;admission 拒绝与真流断分家 | NN/g 错误文案准则;`error-classifier.ts:76-82` |

配套(同一修复面):双语渲染——契约已有 `title_cn`(`models.ts:103-110`),
`Cards.tsx:52` 未读取;「中文(日语)」为展示层拼接,**不走 translate agent**
(translation eval 72.6%、clarify 场景全是续作辨析,把最弱能力放最需精确处)。

---

## 2. P0 汇总(会伤生产 / 正在掩盖缺陷)

### 2.1 SSE 链路(与 §1 同修复面)

- **无任何心跳**:全仓无 keepalive(`chat_stream.py:56-129`);sse-starlette 内置 `ping: int = 15`
  是官方默认行为,手写 `StreamingResponse` 放弃了它。长工具调用(catalog 预算 80-85s,
  `catalog_client.py:42` + `animichi_tools.py:25`)期间零字节,任何中间层空闲超时先砍。
- **缺代理安全头**:`chat.py:240-244` 未设 `Cache-Control: no-store` / `X-Accel-Buffering: no`,
  反代可整段缓冲流式响应。
- **客户端断连零日志 + 预约悬空**:`AgentTurn` 只 `except Exception`,漏接 `CancelledError`
  (`agent_turn.py:153-157`)→ settle/release 不跑,预约悬空 300s,同 session 重试被 in_flight 拒;
  `_consume_result` 吞 `CancelledError` 无日志(`chat_stream.py:82-118`)。
- **edge 唯一日志点在请求解析完之后**(`request.ts:129-139`)→ 中途 cancel 零日志;
  容器 fetch 无超时无 abort(`forward.ts:50-59`);冷启动重试只给了 `/healthz`(`request.ts:170-173`)。
- **容器 `sleepAfter` 未配置**(`entry.ts:41-52`)+ 冷启动 24.5s 未决:今天实测同端点
  wall 1.4s vs 14.4s。**所有流量打同一个 DO `"default"`**(`forward.ts:58`),
  `max_instances=3` 是死配置。

### 2.2 CD 阶段链会吃掉 skipped

`cd.yml` 各 stage 的 `if: !failure()` 只查**直接前驱**;上游被跳过(skipped ≠ failure)时
下游照跑,可传导至 `promote-production` ——「先 staging 后 production」不变量可被静默绕过
(`cd.yml:79-107,226-227`)。

### 2.3 users 幂等守卫是永真式

`reclaim()` 的 `targetWhere: lte(existing.expiresAt, now+24h)` 恒真
(`neon-idempotency-store.ts:98-104`)——并发 reclaim 双双通过,可创建重复 SavedRoute,
违反契约「exactly one route」;内存 fake **忠实复刻了同一错误**,测试矩阵结构性照不出。

### 2.4 catalog 自愈与导入的静默失败

- 两条 miss→后台 ingest 路径失败**零日志**:`search.ts:103-106` 裸 `waitUntil(promise)` 无 catch;
  `work-points.ts:68` 显式 `.catch(() => undefined)`。
- staging DAILY_IMPORT 是**设计上从未接通的死循环**:`PROD_SNAPSHOT` binding 注释着
  (`wrangler.toml:130-138`,生产 catalog 从未部署),fallback 到自己的空快照桶;
  且导入结果被丢弃(`ingest-schedule.ts:113-115`),连 `status:"invalid"` 都不打日志。
- `CATALOG_ADMIN_TOKEN` 从未在任何环境 provision → admin 接口功能性死锁。
- 快照激活失败吞真实异常、误报「candidate validation failed」(`snapshot.ts:72-82`)。
- 冷启动行为矩阵:7 个读端点只有 2 个接了 miss→ingest(search、work-points);
  spots/nearby/geocode/overview/popular 空库下永不自愈。

### 2.5 测试给假安全感的最重四处

- migrator 生产并发锁(`MigratorApplyLock`,`apply-lock.ts:14-18`)只有**字符串匹配**守着;
  测试测的 `QueueLock` 路径生产不用。
- catalog 假 DB 无 `.batch()` 实现且永不报错(`fake-catalog-db.ts:10-21`)——而蓝绿切换的
  原子性**唯一**依赖 `db.batch` 在 workerd+neon-http 下的真实行为,从未对真 Neon 验证。
- users 内存 fake 无唯一约束(§2.3)。
- agent 一批测试直接 `monkeypatch` `Agent.run`(`test_phase1d_partial.py:79` 等 5 处),
  绕过 output_validator/hooks/retries 整条链;官方 `TestModel`/`FunctionModel` 同仓另一半
  测试在正确使用——同一诉求两种互斥实现。

### 2.6 infra 的 fail-open 重置

`baseline_applied()` 把「无法确认」(连接/权限失败)与「确实未应用」同判 →
失败即触发 `DROP SCHEMA CASCADE`(`reset-staging-baseline.sh:43-47`);
重置 SQL 三条语句无单事务包裹(`reset-staging-baseline.sql:1-3`);
prod 首次 `pulumi up` 的角色 adopt 步骤只存在于 runbook,无 CI 门禁。

---

## 3. P1 精选(特定条件触发 / 会误导后来者)

- OpenAPI 制品对外撒谎:users-contract 声明 `bearerAuth`,worker 实际**拒绝** Bearer 只认
  edge 转发头(`users-contract.ts:168` vs `index.ts:87-92`)。
- Python `Point` 镜像把契约必填字段静默降级为 `""` 默认(`catalog_client.py:72-89`
  的 `bangumi_id`/`screenshot_url`),超出 README 记录的三字段分歧——上游漏发字段会被吞。
- catalog 工具吞异常:`except CATALOG_FAILURES` 一律转 UpstreamDown,原始异常不留痕
  (`catalog_tools.py:96-99` 等 4 处);错误注入能力建好了 36 处调用只 1 处用(`_session_fake.py`)。
- `agent-warmup.ts:7` 硬编码 `/healthz` 绕过自家 base-url 解析,agentUrl 配异域即失效,
  测试还把字面量钉死。
- importProtection 只点名 `@neondatabase/auth`;`maplibre-gl` 靠一处函数内 `await import()`
  硬扛,同型 SSR 事故的下一个候选(`vite.config.ts:20-23`)。
- `byok_requires_login` 三处硬编码日语文案(`byok.py:88` 等);系统级错误文案表无 locale 口
  (`error_messages.py:34-62`)。
- edge 匿名链路 4 个顺序网络跳中 rate-limiter/cost-breaker 的 DO fetch 无超时
  (`rate-limiter.ts:163-172`、`cost-breaker.ts:75-81`)。
- Review Gate 状态发布 TOCTOU(Statuses API 无 CAS,`pr-review-gate-step.sh:166-190`);
  另有 4 个声明但从未被 workflow 调用的子命令(死代码与真实实现漂移)。
- `npx --yes neonctl@3.6.0` 是全仓唯一无完整性校验的第三方执行路径
  (`reset-staging-baseline.sh:34`)。
- DDL:`GRANT ALL` 未按 locations 先例收窄(14/16 表含 TRUNCATE/REFERENCES/TRIGGER);
  readonly 漏 9/11 张 agent 表;4 个概念性 FK 未声明;#1217 坐标 trigger 已确认。
- `stepQuote` 无 `E'...'` 反斜杠转义处理——当前六文件未用,属潜伏(`sql-split.ts:154-162`)。

---

## 4. 测试:形状健康,修剪碎片

量化:全仓 ~812 测试文件 / ~5,180 用例 / 测试:生产 = 1.69x;单测 87%、集成 11%、E2E 110 例。

修剪清单(不丢一条断言):
1. 删 `test-inventory.test.ts`(文件数 ≥38 的自指门禁,主动阻止裁剪);
2. session/persistence 19 个文件、`test_phase1c/1d_*` 12 个文件按**概念**重组
   (预计 agent 单测 258→~200 文件);
3. 25 个超 200 行的 Python 测试文件拆分(TS 侧几乎全合规——同一规约执行力不对等);
4. 源码文本匹配型测试 75 个:多数是有事故支撑的「契约钉」,做一轮轻审确认无「布局锁」混入
   (本轮已因布局锁断过 4 个);
5. 缺口反向补:SSE 断线/重连、多语言 E2E(文档承诺 E2E-08 未落地)、
   API 层(文档承诺的新层只有 3 用例)。
6. **流程缺口**:「变异测试是唯一绿灯证明」是评审规约,但无任何工具强制(无 stryker/mutmut),
   全靠人工——本轮 6 次变异验证中 3 次首做即不干净,恰证不能靠手。

---

## 5. 系统病(横切模式,修复战役按此切)

1. **失败路径无信号**:`waitUntil` 吞错 ×2、cron 结果丢弃 ×2、`except` 吞异常 ×4、
   canceled 零日志、快照失败误报、migrate.json 曾被丢弃(已修)。→ 战役 A
2. **声明但未接线**:admin token 未 provision、PROD_SNAPSHOT 注释、`max_instances=3`、
   `sleepAfter` 缺省、Neon Auth Secrets Store 半迁移、`setup_logging()` 无调用方、
   review-gate 4 死子命令、`saved_route_anime` 零引用、`route-rules.ts` 死文件、
   jose 死依赖、`wave0` 死 output。→ 战役 B(一半是删除,一半是接线)
3. **假替身**:三个包的假 DB 永不报错;`Agent.run` 被顶替;fake「忠实复刻 bug」变体。→ 战役 C
4. **陈旧注释/文档**:admin token 名写混、APP_ENV 断言与同文件矛盾、bootstrap 叙事互斥、
   cutover runbook 指向不存在文件、testing-strategy 承诺未落地、STAGING_ONLY_BASELINE
   描述过时。→ 并入各战役的 DoD:改代码必改其自述。

---

## 5b. Code smell 横切(第 14 路补审,量化)

- 函数级门禁完全压住经典 Long Method:C901/PLR0912/PLR0915 **零命中**;但代价转移——
  **PLR0913 生产代码 42 处**(数据团:`agent_turn.py` 结算四元组 `(outcome, ref, owner, reserved)`
  穿 6 个方法签名;`persistence.py:66` 11 参;`animichi_runner.py:192` 13 参),
  与 **13 个 Python 生产文件超 300 行**(`public_api.py` **1136 行 = 3.8×**;
  Python 侧无 file-lines lint 规则,TS 侧同上限 0 违规)。
- CI YAML:五个 stage promote 块**字节级相同 ×5**(cd.yml × action.yml 双份);
  阶段列表 `foundation…web` 硬编码 ≥4 处(shotgun surgery)。
- `agents/handlers/_helpers.py`:整文件违反 naming-ownership(禁 helper 名),
  两个无关概念 + 裸 `dict[str, object]` 分组逻辑。
- `feedback.py`(334 行):一个仓储缝三个聚合(反馈/审计日志/eval 打分)+ `_on` 孪生函数模式
  (与 `usage_metering.py:90-134` 同病)。
- Primitive obsession:`turn_key`/`session_id`(146 处)/`rating`/`status` 裸 str;
  `rating` 在边界是 Literal、跨进 application 即退化。
- Speculative generality:抽样为空(端口均有真实双实现)——诚实报告,不凑数。

处置:小件(`_helpers.py` 拆分、死码)→ PR-3;结构重构(参数对象化、拆 `public_api.py`、
NewType 化、CI 阶段单一来源、Python file-lines 门禁 ratchet)→ **W7 重构战役**(后排,需 spec)。

## 6. 设计层决策题(owner 拍板)

1. **clarify 修复包 A/B/C**(§1.2)——建议全做,一个战役。
2. **staging DB 重置策略**:现状「共享脚本一变就重置」既毁掉 staging 的验证价值又放大爆炸面;
   建议重置只由 db/schema 变更触发,并评估 **Neon branch-per-PR 预览库**取代「销毁重建」仪式
   ——这是本次对标发现的最大「现成方案没用上」。
3. **交付复杂度冻结**:1-2 个迭代内 `.github/`+`local-gates/` 只修 bug 不加特性;
   省出的第一笔预算给**自动 staging smoke**(#1198)——字节校验极严而「能不能跑」全靠手,倒置。
4. **数据重灌**:短期靠 chat 修好后的按需自愈;中期决定 DAILY_IMPORT 的命运
   (接通生产快照 or 明示废弃)+ provision `CATALOG_ADMIN_TOKEN`。
5. **密钥托管统一**:方向 = 运行时密钥一律 Secrets Store(Pulumi provision),
   GitHub 只留引导集;补两根断线(admin token、JWKS 半迁移)。与 #1046 终局一致。
6. **Atlas 实物期权**:migrator 手写路径是 #1046 的 Option 2 备胎转正
   (Option 1 容器路径两死因已定:IPv4 pin 去除 + 退出码事件缺失,修复方向明确但未在生产验证)。
   建议立「行权验证」票:staging 真实触发一次容器路径;验证通过则切默认,
   手写路径的维护税(今天两笔)即止。**不动密钥边界**——两条路径同在 Worker 侧,CI 均不碰 DSN。
7. **turn 幂等语义**(§1.2 B)——影响 admission 契约,需要 spec 级评审。

---

## 7. 修复战役切分建议(→ /triage → /to-spec)

| 战役 | 内容 | 量级 |
|---|---|---|
| **W1 chat 可用性**(最高优先) | §1.2 A+B+C + SSE ping/头 + CancelledError + 断连日志 + sleepAfter/超时 | 中 |
| **W2 失败信号** | §5.1 全部吞错点 + edge 入口日志 + cron 汇总 | 小-中 |
| **W3 替身修真** | §2.5 四处 + 错误注入普及 + 变异工具化评估 | 中 |
| **W4 交付瘦身** | §2.2 skipped 传播 + 重置触发面收窄 + smoke + 全量重建拆分 | 中 |
| **W5 数据平面** | 重灌决策落地 + admin token + DDL 收窄(GRANT/FK/readonly)+ #1217 | 中 |
| **W6 清死码** | §5.2 删除清单 + 注释同步 + 测试碎片合并(§4)+ _helpers.py 拆分(§5b) | 小 |
| **W7 结构重构**(后排,需 spec) | §5b:参数对象化(42 处)· 拆 public_api.py/feedback.py · NewType 化 · CI 阶段单一来源 · Python file-lines 门禁 | 中-大 |
| 独立票 | users 幂等永真式(小而 P0,可先行)· Atlas 期权验证 · #1106 调研继续 | 小 |

依赖:W1 不依赖任何战役,立即可开;W3 先于 W5(改 DDL 前先让测试可信);
W2/W6 可穿插;W4 里的 smoke 应赶在 W1 合并前就位,用它验收 W1。
