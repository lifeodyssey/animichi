# 全仓 code-smell 体检报告 — 2026-09-05

- Status: REVIEW(owner 拍板 §6 后转 triage)
- 基线:`origin/main` @ `09471bcef`;七路审阅实际读的是 `.worktrees/main-lane` @ `357d0bf24`,落后一个 catalog test-only 提交(#1324),各路已核对该差异不影响结论。
- 方法:七路并行只读审阅(edge-agent · edge-gateway · catalog · users+contract+migrator+migrations · web+e2e · tooling · architecture 横切),每路输出分级 + `file:line`。本文只汇总不复审;为解决报告间矛盾开过四处源码与一次 `gh issue view`,位置见 §8.3。
- 上一份:`docs/specs/2026-08-26-system-health-audit.md`(下称 08-26),本文沿用它的章节结构。
- 勘误(2026-09-05,归档时补;正文未改):报告多处称 #1198 的 staging smoke「仍 park / 不存在」(§1.6 证据链、§4 第 36 行)——已过时。park 由 owner 于 08-26 解除,`.github/scripts/staging-smoke-check.sh` 现由 `.github/workflows/cd.yml:255`(`post-staging` 作业「Smoke-check the staging cohort」)执行,脚本头注即 08-26 §6.3 的解除记录;§5 第 8 条自己引了「CD smoke 用 `--max-time 15` 探 `/healthz`」,与前两处自相矛盾。依赖「smoke 不存在」的推论(§1.6 与 §6 第 6 题里「smoke 落地时」的措辞)需按此重估;§6 第 7 题反而已按 smoke 存在来论证,与勘误一致。
- id 记法:两份 edge 报告都用 `E-xx`,本文把 edge-agent.md 的记作 `EA-xx`、edge-gateway.md 的记作 `EG-xx`;web.md 与 users-contract-migrator.md 都用 `H/M/L`,本文记作 `web-H1`、`ucm-M3`;catalog `F`、tooling `T-`、`ARCH-` 原样。tooling.md 的编号没有 `T-04`(源报告跳号,不是漏项)。web.md 与 edge-gateway.md 提到的 `D4`/`D18`/`D19` 是 web 错误态的编号(`error-classifier.ts` 的 D 系列),与 §7 的卡号 D1–D16 无关。

---

## 0. 执行摘要

08-26 的 59 条线目,ARCH-19 复核结果是 **31 修 · 6 部分 · 22 开**,修复集中在 #1220(chat/SSE)、#1222(users 幂等)、`092827ad1`(死码);两项「不得回归」项回归了——Python `PLR0913` 42→82、超 200 行的 Python 测试文件 25→29,都在没有对应 lint 的那一侧。

七份报告合计 **177 条新发现**。七路用的分级词不同,本文按 blocker/High/P0 → P0、major/Medium/P1 → P1、minor/Low/P2-P3 → P2 机械折算,得 **P0 13 · P1 81 · P2 83**(分报告数字见 §8.1)。§1 收的十条是按「生产会伤 / 已实锤」挑的,与折算出的 13 条 P0 不完全重合:edge 租约(EA-01)源报告标 major,但报告作者自己写明「这是我会拿来阻止 `AGENT_TURN_ROUTE = "edge"` 上生产的那一条」,升入 §1;tooling 的 T-03/T-05/T-06 标 High 但性质是重复代码,归 §2 与 §7 战役 B;ARCH-03(依赖方向无任何机器守卫)是结构题,归 §2 与 §6 Q1。

owner 先读的五件事:(1) §1.1 edge 租约按 DO id 判归属、只在工具步落库时续期——模型流超过 30 s 的健康 turn 会被自己判弃,生产切 edge 前必须改;(2) §1.2 匿名日成本上限 X4 在 edge 档位没有任何执行者,staging 今天就是这个状态,而 W2 的 82 行对等清单没有这一行;(3) §1.5–§1.6 migrator 的 DDL 与账本分两次提交、`/ledger-head` 匿名可达 DDL 角色——链会卡死、凭据无谓暴露;(4) §1.3–§1.4 web 的照片确认通道被 clarify pick 静默绕过,以及全站没有 `<Link>`,进一次设置页对话就丢;(5) §1.7–§1.10 四道门各有一个不守的分支:契约兼容基线 fail-open 且藏了一条路由豁免,eval 基线损坏即静默停闸,edge 从未被 CI typecheck,而 `docs/ARCHITECTURE.md` 还写着重写「已否决」。

---

## 1. 活 bug / 生产会伤(P0 实锤)

### 1.1 edge 租约:续期只发生在工具步落库,归属键是 DO id(EA-01)

- 证据链:`src/agent/session/run-machine.ts:38` `LEASE_SLICE_MS = 30_000`;唯一的 claim 在 `durable-turn.ts:88` `takeLease(runId, this.#parts.owner, …)`,唯一的续期在 `turn-step.ts:203` `store.persistStep(…)`;`neon-turn-store.ts:73-77` 的续期 SQL 要求 `lease_owner = owner and lease_expires_at > now()`;`agent-session.ts:125` `const owner = this.#ctx.id.toString()`——同一 session 的每个 DO 化身持相同 owner 串。
- 为什么错:pi 只在模型流结束后才执行工具,spec Appendix A 实测 mimo 一次调用 52 s、Appendix B 离群 28.7 s,BYOK 推理模型更慢;超过 30 s 的单次模型调用让租约在第一次 `persistStep` 之前过期,续期返回零行,`TurnSteps` 记 `abandoned`(turn-step.ts:204),`DurableTurn.#ended` 无结算无收尾帧(durable-turn.ts:98,126),`AgentSession.alarm()` 照样出队(agent-session.ts:88-90);刚等到的工具结果被丢,客户端流以 `[DONE]` 结束却没有 `finish` 帧,run 停在 `running` 直到 60 s 一轮的 sweeper 重排,100 s 的 `deadline_at` 多半已耗尽,重试以 `deadline_exceeded` 收场。Cloudflare 一个 DO id 只有一个实例,owner 又等于 id,代码和注释围绕的「另一个化身抢走租约」在生产里不可能发生;租约实际上是一个 30 s 的模型延迟超时,比同一 turn 给单个工具的 85 s 预算还紧。
- 测试为什么没抓到:`test/agent-turn-lease.test.ts:84-108` 用第三方 owner `"do-incarnation-3"` 制造「租约丢失」;没有一个用例在 claim 与首次 persist 之间把时钟拨过 `LEASE_SLICE_MS`(EA-17),而 `test/doubles/in-memory-turn-store.ts:95-96` 的替身是诚实的,加一行 `clock.set(START + LEASE_SLICE_MS + 1)` 今天就会红。
- 修法方向:模型流期间按定时器续期(本化身是唯一写者,周期续期不与任何人竞争),或续期条件改为 `lease_owner = owner` 不看过期、把过期判断留给 sweeper 的只读扫描;先补 EA-17 的同 owner 过期用例。文档背书:无——spec §三只要求「单写者语义 = turn 租约」,30 s 切片与步边界续期是 #1252 的选择,`neon-turn-store.ts:7-12`、`schema.ts:129-137` 的论证全部基于不存在的第二 owner。

### 1.2 匿名日成本上限 X4 在 edge 档位没有执行者(EG-01)

- 证据链:`src/identity/anonymous-flow.ts:20-27` 只在容器回包 `isBudgetRejection(...)` 时才 `latchBudget`;`src/protect/cost-breaker.ts:7-9` 自述「权威判定在容器 ingress」;`grep -rn ANON_DAILY_COST_BUDGET_USD src/agent` 零命中;变量仍被转发进容器(`container-env.ts:38`)并钉在身份矩阵测试里(`identity-policy-matrix.test.ts:56`)。
- 为什么错:`wrangler.toml:435` staging 设 `AGENT_TURN_ROUTE = "edge"`,`/v1/chat` 不再进容器,`anon_budget_exhausted` 永远不会产生,latch 永远等不到;`docs/ARCHITECTURE.md:208-210` 把这条上限称为压过 per-identity 配额的「更严重、系统性」控制,而只有 per-identity 配额被移植(`agent-turn.ts:182`)。`docs/ops/w2-parity-checklist.md` 82 行(`w2-parity-checklist-contract.test.ts:45` 钉行数)没有一行提到 `daily_usage`/budget,W2 的退出条件「功能对等清单逐项勾」会在缺这条控制的情况下签字。所有测试都绿。
- 修法方向:定 owner——intake 事务里与消息配额预留同处,或已经写 `daily_usage` 的 settlement 路径;落地前先在对等清单加一行 `not implemented` 带 issue,并让 latch/`guardBudget` 停止声称守着 edge 档。今天暴露面只有 staging(生产是 `container` 且 showcase 锁定),所以是 W2 签字的 blocker,不是生产事故。文档背书:无——spec §一「不改 edge 鉴权模型」与 `agent-tier-route.ts:6-11` 的「两档同一堵墙」都假设墙还在。

### 1.3 web 照片搜索确认被 clarify pick 静默绕过(web-H1)

- 证据链:`PhotoSearchUpload.tsx:92-97` 用装饰 `actions.send` 接 AC11 的 offer 确认;`ClarifyCard.tsx:111-114,119-124` 在 `pickTurn.enabled` 时把任何带 `id` 的候选送进 `pickTurn.pick(...)`;`ChatPage.tsx:226-229` 把整页含 dock 包在 `ClarifyPickProvider` 里,生产里 `enabled` 恒真;`PhotoCandidate.id` 在契约里必填(`agent-contract.ts:141-146`)且经 `photo-search.ts:86-92` 保留。
- 为什么错:`confirmPhotoSearch` 永远不触发;点击变成对 `/v1/chat` 发 `selected_candidate_ids` + `clarification_id: null`(照片 part 不带 `clarification_id`,`ClarifyCard.tsx:32-35`),打在一个没有 pending clarification 的 session 上,契约规定这类 pick 回 409。`tests/unit/chat/photo-search-upload.test.tsx:49-56,84-99` 挂载时没有 `ClarifyPickProvider`,拿到 `DISABLED_PICK`(`use-clarify-pick.tsx:29-36`),走了纯文本回退而通过——为错误的原因绿。#1220(W1)引入。
- 修法方向:照片结果自持 pick 通道(带 `offerId` 的 photo-aware provider 调 `confirmPhotoSearch`,或 `pick` 返回「未处理」让文本回退跑),测试挂载生产 provider 栈(`_chat-page.tsx` 已存在);验收用变异:删掉 `confirmPhotoSearch`,现有套件不会红。文档背书:无。

### 1.4 web 全站无 `<Link>`,导航即丢会话(web-H2)

- 证据链:`ChatAppBar.tsx:61` `<a href="/settings">`;`src/` 内 `<Link>` 零用法;`SettingsPage.tsx:18`、`PopularRanking.tsx:14`、`ContinueFromCard.tsx:11`、`DoorwaySummary.tsx:152`、`TurnFailure.tsx:56` 全是文档级跳转;Chat 实例只活在 ref(`use-chat-session.ts:204-210`),服务端分配的 session id「从不写回地址栏」(`ChatReturnTarget.tsx:15-17`),只有登录墙带 `?session=` 回来。
- 为什么错:chat → settings → 「チャットへ戻る」落在 `chat:draft`,访客的对话没了、无路可回(后端还留着)。`router.tsx:12` 的 `defaultPreload: "intent"` 没有 `<Link>` 就是惰性配置;重建 spec 的目标是「SPA + selective SSR」(G3/D4);e2e 只能靠写 TanStack 私有的 `__TSR_index` 伪造客户端导航(`e2e/helpers/client-navigation.ts:3-8`,web-L8)。只有 `/chat`「新对话」这一处文档跳转是有记录的决定(`ChatAppBar.tsx:42-49`)。
- 修法方向:首个 `session_id` 到达时 `navigate({ search: { session }, replace: true })`,内部路由改 `<Link>`,设置页链接像登录墙一样带返回目标;落地后删 `client-navigation.ts`。文档背书:部分(仅新对话锚点)。

### 1.5 migrator 的 DDL 与账本行是两次提交(ucm-H1)

- 证据链:`workers/migrator/src/http-apply.ts:104-107` `const error = await execUnit(sql, file.body); … await writeRevision(sql, okRow(file, now()))`;`execUnit` 在 `:128` `sql.transaction(statements)` 提交文件的事务,`writeRevision` 是之后的另一条语句。
- 为什么错:Worker 驱逐、CPU 限额、neon-http fetch 失败落在两者之间,DDL 已应用而账本无记录;下一次 `POST /migrate` 按 `applied >= total` 重选同一文件,`CREATE TABLE`(无 `IF NOT EXISTS`)失败,`recordFailure` 写 `applied=0`,此后每次运行重复同一失败——链卡死直到有人手改 `atlas_schema_revisions`。`docs/ops/neon-backup-rpo.md` 覆盖「迁移失败」,不覆盖「成功但未记账」。
- 修法方向:事务路径把 revision UPSERT 放进同一个 `transaction([...statements, upsert])`(`sql.ts:38-40` 已接受参数化 `sql.query(text, params)` 项,neon-http 的精确类型未验证);`CREATE INDEX CONCURRENTLY` 文件的窗口是固有的,记录下来,并让 `applyOne` 对「hash 相同的文件遇 `42P07 duplicate_table`」按已应用处理。文档背书:无——`2026-08-16-migration-executor-spec.md` 描述的是 Atlas 自己的语义,手写路径没有继承 `partial_hashes` 和语句级账本。

### 1.6 `GET /ledger-head` 匿名可达、每次打开 DDL 角色连接、无人调用(ucm-H2)

- 证据链:`workers/migrator/src/create-app.ts:185-191,197` `app.get("/ledger-head", …)` → `resolveDsn(c.env)` → `readAppliedHead(dsn)`;`wrangler.toml:38` `workers_dev = true`;`grep -rn ledger-head .github scripts` 零调用方(smoke 已 park,#1198)。
- 为什么错:任何匿名请求都会解出 Secrets Store 里 `migrator` 角色(唯一允许 DDL 的角色)的 DSN,并对直连(非 pooler)端点发一次 neon-http 请求;无限流、无缓存、公网主机。注释以「post-staging smoke 不带 OIDC」为由,但 smoke 不存在;`AGENTS.md`「DSN 不驻留在任何常设环境」这句在这条路由上不再成立。
- 修法方向:删路由直到 #1198 真的需要它;届时要么 OIDC 门(同 `/migrate`),要么在 apply 时把 head 写进一个短 TTL 的缓存值,读路径永不碰 DSN(§6 Q6)。文档背书:部分——`#1052 AC5` 解释了为什么不鉴权,没有回答 DSN-per-request 与零消费者。

### 1.7 契约兼容基线 fail-open,且藏着一条命名路由豁免(T-01)

- 证据链:`.github/scripts/pr-verification-gate.sh:24-27` `git show "$merge_base:packages/contract/$doc" > "$baseline" 2>/dev/null || printf '{"paths": {}}' > "$baseline"`,紧接着 `if grep -Eq '"/v1/users/(checkins|shares)' "$baseline" && ! grep -Eq … ; then git show "$source_head:…" > "$baseline"`。
- 为什么错:任何 `git show` 失败(坏对象、浅克隆、错 cwd)——不只是「merge base 上没有这个文件」——都变成空基线,OpenAPI 兼容 vet 对着空文档跑;第二段把基线换成 head 自己的文档做自比,是一条写在 CI 门里、无注释无 issue 引用的 `checkins|shares` 路由豁免。`vet-openapi.ts` 对 `{"paths":{}}` 的行为未读(报告标 unverified),但门自己的回退形状已说明意图。
- 修法方向:`git cat-file -e "$merge_base:…"` 区分「文件不存在」与其它错误,后者 fail closed;把 users 路由豁免搬进一个带日期、走评审的豁免文件让 `vet-openapi.ts` 读,或它服务的迁移已落地就删。文档背书:无。

### 1.8 损坏的 eval 基线会静默关掉回归闸(T-02)

- 证据链:`packages/eval/src/gate/baseline-store.ts:60-63` `parseBaselineRecord(readFileSync(path))` 为 `null` 时返回 `{ record: null, warnings: [invalidWarning(...)] }`;`baseline-record.ts:12-13,60-66` 自述「解析是 total 的:损坏文件 = null,从不 throw,因为调用方对『没有可用基线』的回答是写一个」。
- 为什么错:一份被截断或手改坏的已提交基线得到 `record: null` + 一条警告,之后 `bootstrapGate` 不会被调用——回归闸带着一条非阻塞消息关闭,与合法首跑不可区分。`gate-baseline-staleness.test.ts:63-69` 把这个行为钉成规格(「不可读的基线是警告不是崩溃」)。
- 修法方向:缺失→警告保留,不可解析/schema 不符→失败(或未来 runner 把 `record === null` + `Invalid baseline` 视为红);TS 侧镜像 `gate.py`,两侧一起定。文档背书:部分——`packages/eval/AGENTS.md`「Warnings are returned, not logged」记录了与 Python 的对等,损坏与缺失的混同没有任何地方讨论。

### 1.9 承载重写的 Worker 从未被 CI typecheck(ARCH-02)

- 证据链:`scripts/local-gates/pre-push.sh:221-226` `gate_edge` 跑 `lint:oxlint`、`test:worker`、`test:bundle-smoke`、ratelimit namespace 检查、`wrangler deploy --dry-run`,没有 `tsc`;`.github/scripts/pr-verification-gate.sh:80-87` 原样 source 同一函数;`.github/ci/components.json` edge 的 `ci_lanes` 无 typecheck;唯一到达 `pnpm -r --if-present typecheck` 的是根 `package.json:12` `verify:dependabot`,全仓无人调用。`workers/edge/package.json` 有 `"typecheck": "tsc --noEmit"` 但没有 `typescript` devDependency,靠 `.npmrc` `shamefully-hoist=true` 能跑。手跑 `pnpm exec tsc --noEmit` 今天 exit 0。
- 为什么错:`AGENTS.md:50-51` 承诺「TypeScript 7.0.2 direct … across every package」;agent 层的类型错误只要 esbuild 还能打包就会进 `main`;edge 也是唯一没有覆盖率下限的 DB Worker(node:test,无 istanbul)。今天是潜伏,不是现行。
- 修法方向:`gate_edge` 加一行 `gate workers/edge pnpm exec tsc --noEmit`(CI 镜像与 `test_ci_prepush_parity.rb` 同步),edge 声明 `typescript`(ARCH-16),删 `verify:dependabot`;`components.json` 的 typecheck lane 随 CI/CD 重设计(§7 战役 B)。文档背书:无。

### 1.10 「live runtime reference」写着重写已否决(ARCH-01)

- 证据链:`docs/ARCHITECTURE.md:25-36`「D7 — both REJECTED … The agent will not be rewritten in TypeScript」(2026-08-25 最后一次改动);`docs/DOCS_POLICY.md:73-75` 把前端重建 spec 列为「current target」,而 `2026-07-06-frontend-rebuild-spec.md:54,101,322` 写「SD-4 Agent runtime: Python FastAPI container, Finalized, not up for further debate」。同时 `2026-09-01-agent-ts-rewrite-spec.md:3,10,24` W0 已于 09-03 关闭、W1 进行中;`workers/edge/src/agent/` 100 文件 11,589 行,占 edge 源码 16,009 行的 72%;staging `AGENT_TURN_ROUTE = "edge"`。`AGENTS.md:22`、`CONTEXT-MAP.md:44-45`、`workers/edge/CONTEXT.md:3-23` 仍称 edge 为「auth + `/v1` routing + image proxy」、「Gateway only — never `src/domain/`」(ARCH-07)。
- 为什么错:`AGENTS.md:73-78` 把 agent 引到 `docs/ARCHITECTURE.md` 和 DOCS_POLICY 的表,两处都指向被否决的方案;`DOCS_POLICY.md:45,48`「不并列保留新旧架构文档」「不引入第二套架构叙事」被仓库自己的规范文档违反。spec §五把 docs/AGENTS 更新排到 W4 之后——那是 agent 最先读的文档,排错了波次。两份 edge 报告(EG-12)、ucm(M7)都独立指出同一句。
- 修法方向:现在就删 D7 段与 SD-4 行,加一段「runtime today:默认 container,edge 档在 `AGENT_TURN_ROUTE` 之后」点名旗标与两个 wrangler 位置;`AGENTS.md`/`CONTEXT-MAP.md` 的 edge 行改为「gateway + 旗标后的 agent tier」(§6 Q1 决定措辞)。文档背书:重写本身有(spec §二);把 `ARCHITECTURE.md` 留到 W4 是 spec 隐含的,但与 DOCS_POLICY 规则 1/7 冲突。

---
## 2. P1 汇总(按包)

收录七份报告里所有 P1/major/High/Medium;id 可回溯到源报告。已在 §1 展开的条目只留一行指回。列:id · 一句话 · `file:line` · 修法方向 · 文档背书。

### 2.1 edge agent tier(`workers/edge/src/agent/**`,edge-agent.md major 5)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| EA-01 | 租约按 DO id 判归属、只在工具步落库时续期 | → §1.1 | → §1.1 | 无 |
| EA-02 | `resolve_anime` 的描述让模型发 `clarify_response`/`qa_response`,与 `respond(kind)` 的系统提示矛盾——这是模型在决定如何回答消歧时读到的那段话 | `tools/resolve-anime-tool.ts:22` vs `session/turn-instructions.ts:55-60`,`agent-tool-parameters.ts:154` | 改成本层词汇;加一条「每个已注册工具的描述里出现的标识符必须是已注册工具名」的测试 | 无(头注称「word-for-word 保留」,对等目标已随 #1283 移动) |
| EA-03 | 浏览器在文本 turn 上发的 `origin_lat/lng` 从不到达 `search_nearby`,edge 档「附近」永远 `missing_location`,以合理的澄清而非错误静默失败 | `tools/search-nearby-tool.ts:46-51`;`session/turn-envelope.ts:125`(`origin` 从未供给);`ChatPage.tsx:53` | `chat-envelope.ts` 读坐标,随 `TurnSubmission` 存进 user 行 `response_data`(selection 已这样做,`selection-request.ts:116-118`),交给 `TurnEnvelope.open`;一条 api-lane 用例 | 无 |
| EA-04 | COMMIT 之后 wake-up 失败被当作 5xx 报给客户端,而 run 已持久且 sweeper 会驱动它;重发撞 `running_turn` 409 | `intake/turn-intake.ts:158-159`,`session/session-wakeup.ts:102-103`,`gateway/agent-turn.ts:249-267` | openTurn 提交后所有 wake-up 失败降级为已存在的 202 accepted-run body(`turn-stream-handoff.ts:64-69`);`Promise.allSettled` | 反向:`session-wakeup.ts:28-31` 与其测试刻意钉了现行为,与 `turn-stream-handoff.ts:13-20` 的规则矛盾无人承认 |
| EA-05 | loop 的失败路径零日志(08-26 §5.1 在新层里原样重现):`session/ settlement/ sweeper/ intake/` 没有一处 `console.`/`logfire` | `turn-step.ts:205-207`,`durable-turn.ts:116-119`,`turn-attempt.ts:102-105`;`secret-scrub.ts:97-99` 的 `errorText` 无调用方 | 每个终态决策一条结构化 `console.warn/error`(run_id、phase、reason、scrub 后 cause);再接 spec §三点名的 Logfire | 无;spec 承诺相反 |

### 2.2 edge gateway(`workers/edge/**` 减 `src/agent`,edge-gateway.md blocker 1 + major 13)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| EG-01 | 匿名日成本上限 X4 在 edge 档无执行者 | → §1.2 | → §1.2 | 无 |
| EG-02 | 14 条 `AGENT_PATHS` 里 9 条仍只有 Python 服务端且无对等行;W4 删容器当天 `operation-reachability.test.ts:94-100` 全红 | `routing-policy.ts:17-27`,`request.ts:229-236`,`agent-contract.ts:301`;`w2-parity-checklist.md` 对 photo-search/feedback/search-preview/bangumi-nearby/PATCH 零行 | 一张 W3/W4 清单卡:逐路由 port / retire(`AGENT_PATHS` + OpenAPI 经 `vet:openapi`)/ re-home(healthz、banner 归 edge 自己);先把行加进对等清单让缺口可见 | 部分(spec §一「全量功能对等」,§五 W2 只列 tools/BYOK/memory) |
| EG-03 | zod 在部署 bundle 里(esbuild 实测 79 个输入、568 KB 未压缩),规则与镜像字面量都说不在 | `identity/auth.ts:3-8,37-43`,`routing-policy.ts:1`,`rate-policy.ts:1`;`packages/contract/AGENTS.md:17,42` 说反;`agent-turn-responses.ts:32` 为此手抄 `ANON_QUOTA_EXHAUSTED_CODE` | 落地 `card/1285-zod-out-of-bundle` 的 `d9da0efc0`(#1285 OPEN);之后错误码常量走同一条 zod-free 的导入路径,或留镜像但写真实理由 | 在途(#1285) |
| EG-04 | staging-gate OIDC exchange:公开、showcase 豁免、无调用方、每次一个全新 Map 当 session store、无 zone 路由,`infra/src/staging.ts:93` 还给它留 WAF 例外 | `staging-gate/exchange.ts:82,114-121`,`request.ts:84-88`,`infra/src/web-routes.ts:53-56` | 删端点 + WAF 例外 + `stagingGateExchange` dep;或做完 DO store + 路由校验(§6 Q7;#1054 已 CLOSED,park 无记录) | 无 |
| EG-05 | 「同一信封」承诺下六种拒绝形状,web 的分类器按 `error.code` 分支,每种平铺/文本形状都是它眼里的 D4 | `responses.ts:5-11` vs `request.ts:184`(text 400,无测试)、`image-proxy.ts:4-6`、`tiles.ts:61-63`、`turnstile-entry.ts:19,23`、`forward.ts:125`、`exchange.ts:133-136`、`agent-turn-responses.ts:55,72,77,83,90` | 一个 `gatewayRejection(code, status, message?)`;`{detail}` 镜像明示为 Python wire,随 W4 退役 | 仅镜像有(`agent-turn-responses.ts:6-17`) |
| EG-06 | 无 `app.onError`:`refusable()` 之外的 throw 变 Hono 纯文本 500,`observe()` 不跑——失败的请求恰好是没有 `edge_gateway_request` 行的那个;`container-retry.test.ts:100-110` 把文本 500 钉成预期 | `app.ts:60-65`,`request.ts:140-145` | `app.onError` 记结构化 `edge_gateway_error`(class、status、error name)并答共享信封;`observe` 进 `finally` | 无 |
| EG-07 | 数据面 import W4 要删的模块:`agent-database.ts` 从 `container/container-env.ts` 拿 `readStoreOrString`;`env.ts:45` 再声明一次 `StoreSecret` 形状 | `db/agent-database.ts:21`,`container-env.ts:162-175` | `src/secrets-store.ts` 拥有 `StoreSecret`/`readStoreOrString`,`container-env.ts` 反向 import;W4 前做,让删除是纯删除 | 无(#1157 注释解释 unwrap,不解释归属) |
| EG-08 | 路径归一化只在 rate-policy 有:`POST /v1/chat/` 归类为 `v1`、逃出 edge 档进容器,计费却按 `/v1/chat` 同一格;W4 后这个请求没有服务端 | `rate-policy.ts:100-114,118-124` vs `routing-policy.ts:108-114`;`rate-limit-bypass.test.ts:31-37` 证明尾斜杠到容器 | 设计文档已下令的 `gateway/path.ts`(`2026-08-06-edge-gateway-structure-design.md:145-152` E3),`classify()` 归一化一次给所有 policy | 反向:E3 有记录,未交付 |
| EG-09 | `x-turn-id` 去重键无长度上限且接受空串:`""` 不是 nullish,落进 `WHERE client_message_id IS NOT NULL` 的部分唯一索引后同 session 每个空 id turn 都「重放」到第一条 | `agent-turn.ts:171` vs `:62-64,134-140`(session id 有 200 上限与空串处理);`db/schema.ts:119-123` | 一个 `boundedHeaderKey(name, max)` 读两个头,空白视作缺席;`agent-turn-wire.test.ts` 加 `x-turn-id` 用例 | 无 |
| EG-10 | 同一原语在 `identity/`、`gateway/` 写两遍:`readCookie`/`hmacHex` 字节级重复(一个目录两份 HMAC-SHA-256),`bearerToken` 两份(exchange 那份正则含字面 TAB),`pathPattern`=`templatePattern`,`PUBLIC_CATALOG_PATTERN` 两处,`{userId,userType}` 内联六次,`stubCtx` 五份 | `anonymous-id.ts:36-51` = `turnstile-pass.ts:6-21`;`auth.ts:136-143` = `exchange.ts:56-62`;`routing-policy.ts:38-42` = `rate-policy.ts:82-86`;`forward.ts:27,59,83,104`、`session-adopt.ts:36`、`agent-tier-route.ts:73` | `identity/signed-cookie.ts`(mint/verify,一份 HMAC)、`identity/bearer.ts`、`gateway/path-template.ts`;从 `identity/auth.ts` 导出 `VerifiedIdentity` | 无 |
| EG-11 | 测试替身放在 `src/container/`:14 个测试 import,`src/` 零 import;W4 扫 `container/` 时连带 14 个测试 | `src/container/entry-env.ts:1-32` | 移到 `test/doubles/gateway-env.ts`,合并五份 `stubCtx` | 反向:edge `AGENTS.md:242-243` 与结构设计说不许 |
| EG-12 | 自述失真(08-26 §5.4 仍开):`entry.ts`/`app.ts`/`env.ts` 头注「must stay at worker root」(#853 已完成);`forward.ts:42-45`「BYOK 上线前关闭」(#1289 已上线);`wrangler.toml:131-132,282-283,482-483`「Enforced by the container ingress」紧邻 `AGENT_TURN_ROUTE = "edge"`;`ARCHITECTURE.md:196-202`「edge 从不读 `daily_usage`」 | 见左 | 删三处 TODO 头;改 D7 与匿名访问段,或在根 `AGENTS.md` 撤销其「reference」地位;`forward.ts:38` 注明它是什么 | 无 |
| EG-13 | 容器必需键里两项无人消费(`SUPABASE_DB_URL` 被 settings 丢弃、`DEEPSEEK_API_KEY` 是已禁用的备胎),一次轮换能让部署为无关密钥失败;`max_instances = 3` 对着单一 `idFromName("default")`(08-26 §2.1 仍开) | `container-env.ts:18-19,55`,`wrangler.toml:54,180,326,536`,`forward.ts:68`,`request.ts:170,175` | 两键降为可选;`max_instances = 1` 或分片;都死于 W4,只做便宜的修正 | 部分(`SUPABASE_DB_URL` 标「pending #855」解释了转发,不解释必需) |
| EG-14 | edge 测试套是全仓的配置/文档文本守卫:65 个在范围文件里 25 个 `readFileSync`,两个超 200 行的都是文档钉,票号命名文件 16 个;编辑 catalog 的 wrangler 块或一张 markdown 表变红的是 `pnpm --filter edge-worker test` | `migrator-role-isolation`、`migrator-ac3-proof`、`staging-baseline-reset`(286 行)、`w2-parity-checklist-contract`(275 行)、`spec-w0-verdict-contract`、`wrangler-toml.test.ts:24-30`、`release-toolchain`、`pi-spike-*` ×12 | 跨仓文本守卫搬到 `scripts/local-gates/` 或根 `test/contracts/`;edge 只留关于 `workers/edge` 文件的钉;票号文件触碰时按概念改名 | 部分(edge `AGENTS.md:293-297` 记录事实不记录放置) |

### 2.3 catalog(`workers/catalog/**`,catalog.md P1 9)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| F1 | 依赖规则是文档不是门,三处倒置已存在:port 定义在 adapter 里、application import `enrich/`+`ingest/`、domain import `lib/`;`adapters/inbound/` 是空目录,SQL 写在 `api/*.ts` | `application/get-bangumi-overview.ts:10`,`application/resolve-bangumi.ts:18,21`,`domain/itinerary/plan.ts:18-21`,`api/search.ts:151-161`,`api/spots.ts:52-65`,`adapters/outbound/title-alias.ts:75-88`(为借类型伪造 `BangumiRow`) | worker pool 一条边界测试(`import.meta.glob(…, {query:"?raw"})`,`worker-entry-exports.worker.test.ts` 已用此技法)断言 `domain/**`、`application/**` 不 import adapters/api/enrich/ingest/publish/db/lib/hono/@orpc/drizzle-orm/`cloudflare:`;三个 reader port 搬回 `application/`;`resolve-bangumi` 自己的 subject parser port | 部分(设计 §3「依赖规则(硬)」,§12 未勾选「domain 无框架 import」;`api/*.ts:1` TODO #837/#838) |
| F2 | `search`/`spots` 零调用方(Python 与 edge 的 catalog client 都只调另外四条),`search` 仍在 `waitUntil` 下跑全量 ingest——#1229 的同一形状;08-29 决策 spec「`waitUntil` 从请求路径消失」不实,`src/` 仍 15 处 | `catalog_client.py:189-226`、edge `tools/catalog-client.ts:60-66`;`api/search.ts:103-121`,`index.ts:81-86`;只有 edge `catalog-policy.ts:2,5` 还放行 | 退役两条 procedure(契约 + `router-surface.worker.test.ts` + edge `catalog-policy.ts` 同一 PR),删 `syncFallback`,改 08-29 spec 那句(§6 Q4) | 无(`router-surface` 钉它们为「exactly the read-only public procedures」,设计列 `SearchPoints` 为用例) |
| F3 | 蓝绿 `cluster_version` 每次 publish 都写、无任何服务读路径按它读;`gc.ts`、`snapshots.ts` 无生产调用方;「原子发布」今天靠 `db.batch` 的就地 UPSERT,不靠指针 | `enrich.ts:56-64`、`versioning.ts:29-36` 写;`bangumi-points.ts:36-50`、`route-points.ts:61-74`、`nearby-points.ts:49-62`、`overview-points.ts:43-53`、`spots.ts:52-65` 直读 `points` | 二选一:服务读按版本读(或 `/itinerary` 读快照表),或删 `cluster_version` 发布、`gc.ts`、`snapshots.ts` 与 ADR 决策一 #2 那条(§6 Q3) | 部分(`enrich.ts:8-12` 说 cluster 持久化是「later-wave」;无读者这一事实无记录) |
| F4 | 「三个独立预算」之一从未被计费:`spendRuntime` 无调用方,两处 spend 传 0,`firstExhausted()` 永远不会因运行时中断;`hourlyIngestBudget` 14 分钟的墙钟上限是纸面的 | `budgets.ts:3-8,41-58`,`run-ingest.ts:41`,`ingest-schedule.ts:255`,`operational-config.ts:74,84`,`daily-run.ts:201` | 注入时钟按 work 计费 `spendWork(budget, requests, clock.now() - started)`,或删运行时维度与两个 `runtimeLimitMs`;四个自由函数归 `Budget` | 无 |
| F5 | cron 里每 point 一次 UPSERT(68 点 ≈ 68 次串行 neon-http),`raw_payload_history` 每次运行全表扫描后在 Worker 里算删除候选,`importInsertValue` 每行重建列表——#1229「执行上下文太短」的问题挪到了 cron | `run-ingest.ts:83-101`,`raw_history.ts:85-104`,`import/switch.ts:100-121`;daily policy 一次调度 50 works(`operational-config.ts:82-84`) | provenance 合并成多行 `INSERT … ON CONFLICT`(enrich 已这样做,`enrich.ts:124-143`);保留窗口下推 SQL(`row_number() over (partition by work_id, source order by seq desc) > keep`);列表提到循环外 | 无 |
| F6 | daily run 恢复时用新快照覆盖自己的账本(只读回 3 列,`failures: []` 硬编码),reclaim 标记把 run id 塞进 `bangumiId`;`status as …` 裸 cast | `run-store.ts:90-100,108-123`,`daily-run.ts:114,121` | 读回完整 JSONB 并合并,或按尝试分行;`status` 对 `RunStatus` 校验;`RunFailure.stage: "reclaim"` 变体 | 无 |
| F7 | 校验 reason 算完即丢(`firstInvalid` 的具体原因不返回),R2 staging 失败报成「candidate validation failed」;`snapshot-activation.worker.test.ts:74` 钉了误报(08-26 §2.4 仍开,#1219 只加了 `console.error`) | `import-snapshot.ts:68-70,122-130`,`snapshot.ts:57,83-86` | 返回 validator 的 reason;`PublishResult` 拆 `invalid`/`stagingFailed`;改测试断言真实形状 | 无 |
| F8 | SQL 顺序与语义没有能被变异抓住的测试:fake 无视语句、按调用顺序回脚本行,spike 先 `.sort()` 再比,`gazetteer` 测试只证 adapter 什么都不做;`orderBy(asc(episode), asc(timeSeconds), asc(id))` 删掉不会红 | `points-by-bangumi.worker.test.ts:55-63,98-103,135-138`;`catalog-api.spike:81`、`resolve-api.spike:105`、`catalog-ingest-e2e.spike:51,62,67`;`resolve-wire`/`plan-itinerary`/`nearby`/`work-points-wire` 的 `responses.shift()`;`gazetteer.worker.test.ts:33-41` | spike pool 乱序种子 + 精确顺序断言(`pointsByBangumiId`、`resolve` tie、`geocode` fuzzy);worker pool 用 `test/fakes/fake-catalog-db.ts` 的按表行取代 `responses.shift()` | 无 |
| F9 | 上游 fetch 无超时无取消:3 次重试 + 10 s 退避 + 三次无界 fetch,请求路径每个别名 miss 都走一次;edge 传了 signal,catalog 不接 | `sources.ts:24-27,225-234,253-261`,`retry.ts:27-29`,`router.ts:40-44`,`media/img.ts:83`;edge `catalog-client.ts:60-66` | `FetchLike`/`SourceConfig` 穿 `AbortSignal`,`fetchOnce` 每次 `AbortSignal.timeout`,`RetryOptions` 认整体 deadline | 无 |

### 2.4 users · contract · migrator · migrations(users-contract-migrator.md High 2 + Medium 13)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| ucm-H1 | migrator 的 DDL 与账本行两次提交 | → §1.5 | → §1.5 | 无 |
| ucm-H2 | `/ledger-head` 匿名可达 DDL 角色 | → §1.6 | → §1.6 | 部分 |
| ucm-M1 | 生产互斥锁只有一条源码字符串断言守着,测试测的 `QueueLock` 生产不用;`vitest.config.ts:27` 把 `apply-lock.ts` 排除在覆盖之外(08-26 §2.5 仍开) | `apply-lock.ts:14-18`,`lock.ts:6-23`,`http-apply.ts:52-69`,`http-apply.lock.test.ts:38-48` | DO 跑在 `@cloudflare/vitest-pool-workers`(users 已这样)让 `blockConcurrencyWhile` 真被执行,或删 `applyHttp`/`QueueLock` 在 DO 缝测串行;不要留一个生产锁一个 fixture 锁 | 无 |
| ucm-M2 | users 的 Drizzle 映射无链对等守卫且已残缺:没有 `(owner_user_id, op, key)` 复合 PK、没有 `state`/`status` enum;`onConflictDoUpdate({ target })` 今天对只是因为有人手打了三个列名 | `users/src/db/schema.ts:42-52` vs `20260826000005_users.sql:19-20,38` | 复用 edge 的 `readMigrationSchema`/`readMappedTable` 写 `workers/users/test/schema-parity.worker.test.ts`;补 PK 与列选项 | 无 |
| ucm-M3 | `USERS_ERRORS` 手写镜像无对等测试(catalog 同型有 `contract-parity.worker.test.ts`),`category` 声明后无人读;「no-zod」前提对 users 不成立(`router.ts:1` 已值 import `usersContract`) | `users/src/lib/errors.ts:9-32`;`grep USERS_ERROR_DEFS workers/users/test` = 0 | 从 `USERS_ERROR_DEFS` 派生(`pickUsersErrors` 已导出),或留镜像加对等测试;`category` 删或消费 | 镜像规则只为 catalog 记录 |
| ucm-M4 | contract 是唯一 CI 门不 lint 的 TS 包,`scripts/` 从未被 lint;仓库仅有的两个 `!` 断言就在这个豁免里 | 根 `package.json:9` 过滤表漏 contract,`pre-push.sh:239-246` 无 oxlint,`oxlint-changed.sh:41-42` 只 src 只 pre-commit;`emit-agent-python.ts:86,103` | `packages/contract` 加 `lint:oxlint`(src scripts test),进 `gate_contract` 与根过滤表;删 pre-commit 特例 | 部分(pre-commit 例外有记录,CI 缺口无) |
| ucm-M5 | 一个包三套错误注册机制:`ErrorCategory`/`UsersErrorCategory` 字节相同,三个同形 item 接口,`pickCatalogErrors` 重写 `pickErrors`;`error-registry.ts:73` 注释的 `ROUTE_*/CHECKIN_*/SHARE_*` 不存在 | `errors.ts:18,52-57,106-118`,`users-contract.ts:9,58-63`,`error-registry.ts:74-79,101-110` | 一个 `ErrorCategory`、一个 `ErrorRegistryItem`,`pickCatalogErrors = (codes) => pickErrors(CATALOG_ERROR_DEFS, codes)`;修注释 | 无 |
| ucm-M6 | barrel 把 diff/vet 引擎与 CI 词汇发给每个运行时消费者,`usersContract` 只能经 barrel 拿(无 `./users-contract` 子路径);今天能打包只因 bundler tree-shake,包边界没这么说 | `contract/src/index.ts:16-20`,`package.json:9-21`,`users/src/router.ts:1` | 加 `./users-contract`、`./errors`、`./error-registry` 子路径;`openapi-*`/`operation-set` 进 `./tooling` 或姐妹包(§6 Q9,与 ARCH-06 一张卡) | 无 |
| ucm-M7 | README 三处与代码/AGENTS.md 矛盾(2026-08-25 刚改过没修);跨范围陈旧注释 | `README.md:47-60`(「Do NOT codegen Python」vs `emit-agent-python.ts` + `pre-push.sh:244`)、`:62-70`(「No pnpm workspace (yet)」)、`:7-13`(5/22 模块);`models.ts:5-8`(`backend/…` 路径)、`catalog/src/db/schema.ts:205,219,229`(不存在的 `20260812000000_catalog_daily_run.sql`)、根 `AGENTS.md:18-19`、`users/CONTEXT.md:12`(`claim_session_id` 无迁移声明) | 改规则 2、删规则 3、重生成模块表、修四处注释;「改代码必改自述」进卡片 DoD | 无 |
| ucm-M8 | 手搓 UUIDv7 无位布局测试:`now / 0x100` 与 `now` 超 int32,正确性依赖 `&` 先做 `ToInt32` 截断这一没写下的性质;这是每条幂等创建路线的主键 | `neon-atomic-commit.ts:71-93`;`workers/users/test` 对 `newRouteId`/`uuidv7`/`0x70` 零命中 | `uuid` 的 `v7()`,或 `crypto.randomUUID()`(DB 侧按 `updated_at` 排序,v4 也够),或 CTE 让 DB 出 id;至少一条解码 version/variant/timestamp 的测试 | 部分(为什么 Worker 生成有记录;为什么手写无) |
| ucm-M9 | fake DB 按 SQL 前缀与绝对参数下标(`values[6]`、`values[14]`、`values[16]`)分派,「事务」是 `Promise.all`;`NeonAtomicCommitStore` 存在的唯一理由(半失败双回滚)在 fake 里无法表达,「AC2 原子性」describe 断言的是语句数(08-26 §5.3 仍开) | `in-memory-routes-db.ts:66-73,113-120,155-157,231,252-260,269,328`;`save-saved-route-idempotent.worker.test.ts:225-256` | 两个 adapter(`NeonAtomicCommitStore`、`NeonIdempotencyStore`)对 testcontainers/Docker Postgres 跑 users 集成 lane(catalog spike arm 已 apply Atlas 链);fake 只留给纯 action,按列名键(`sqlToQuery` 给参数→列映射) | 部分(`reclaim-sql-shape.worker.test.ts:9-16` 承认限制,原子性盲区无) |
| ucm-M10 | 一个文件三种错误信封(503 `{error:string}`、401 `{error:{code,message}}`、400 手拼 oRPC 信封);`IDEMPOTENCY_KEY_INVALID` 由中间件对 `GET`/`DELETE` 也抛,契约只在 `saveSavedRoute` 声明——OpenAPI 与 wire 不一致 | `users/src/index.ts:49-51,54-57,72,121-124`,`users-contract.ts:184-187` | 统一到 oRPC 信封;长度检查搬进 save handler,或在每个 op 上声明头与 400 | 无 |
| ucm-M11 | migrator 容器路径生产已死但全量携带:`CloudflareContainerRunner` 从未实例化,`CONTAINER_TIMEOUT_MS` 声明、设置、无人读(env 三触点教训的现行实例),每次发布构建一个无人启动的镜像,≈550 行测试 | `runner.ts:69`,`create-app.ts:28,137-138`,`wrangler.toml:46,105`,`build-release-unit/action.yml:70`,`container.ts`、`Dockerfile`、`docker/*.sh` | 08-26 §6.6「行权验证」票加日期:staging 触发一次并切默认,或删 `container.ts`/`runner.ts`/`Dockerfile`/`docker/`/CI 镜像步/`[[containers]]`;`ContainerOutcome → ApplyOutcome`(§6 Q5) | 有(#1124 冻结,`wrangler.toml:3-8`);冻结无到期无 owner |
| ucm-M12 | `listSavedRoutes` 无 `ORDER BY`/`LIMIT`,整个 owned 集合过 neon-http 后在 JS 排序;契约无输入,之后加分页在 vet 门下是 breaking;`idx_saved_routes_user` 不含 `updated_at` | `neon-saved-route-repo.ts:118-125`,`list-saved-routes.ts:53`,`users-contract.ts:163-170` | SQL `ORDER BY updated_at DESC LIMIT $n` + 可选 `{limit, cursor}`(现在加是 additive);后续迁移加 `(user_id, updated_at DESC)` | 部分(排序归属 action 有记录;无界无) |
| ucm-M13 | 幂等账本 24h 保留只是读时谓词,全仓没有任何 DELETE;`expires_at` 索引服务不了任何查询;设计把维护定义为「不清用户文档」,账本不是用户文档,无人认领 | `20260826000005_users.sql:9-25`,`saved-route-idempotency.ts:22-23`;`grep -rln saved_route_idempotency workers apps infra scripts` 只命中 users | 定时 `DELETE … WHERE expires_at < now() - interval '1 day'`(users_svc 已有 DELETE),或给 `jobs_svc` DELETE 并入维护 cron | 无(`users-clean-architecture-design.md:469`) |

### 2.5 web + e2e(`apps/web/**`、`e2e/**`,web.md High 2 + Medium 12)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| web-H1 | 照片确认被 clarify pick 静默绕过 | → §1.3 | → §1.3 | 无 |
| web-H2 | 全站无 `<Link>`,导航即丢会话 | → §1.4 | → §1.4 | 部分 |
| web-M1 | 约五分之一 `src/` 不可达:しおり 24 文件 + 三份全局样式表进每一页,bubble-map 四组件、`CatalogSearchResults` + `use-catalog-search`、showcase(自述「NO call site」自 08-23)、五个 test-only 导出;98/95/98/99 的覆盖率下限让它们各有测试(しおり一项 19 个测试文件) | `features/shiori/*`,`styles/globals.css:4-6`,`features/bubble-map/{BubbleMap,BubbleMapPanel,CircleBubbleMap,SpotSheet}.tsx`,`components/CatalogSearchResults.tsx`,`features/config/showcase.ts:6-10`,`route-detail/load-route-detail.ts:44`,`chat/telemetry.ts:19`,`vitest.config.ts:67` | 删或移到分支,CSS 从 `globals.css` 摘掉,test-only 导出连测试一起删;之后再 ratchet 下限,不要先 | 无 |
| web-M2 | `_dev` 是无路径段,`/map-spike`、`/map-canary` 是公开生产 URL,无 DEV/flag 门(`featureFlags` 字段没有任何读者),拉 1.15 MB maplibre chunk + pmtiles;coverage 已把它们当 canary 排除 | `routes/_dev/map-spike.tsx:8`,`e2e/web-maplibre-canary.spec.ts:10`,`runtime-config.ts:54`,`bundle-budget.config.ts:24`,`vitest.config.ts:37-57` | 按 `featureFlags`/DEV 门;或 canary 归 e2e 项目、spike 归 Storybook | 无 |
| web-M3 | auth 状态是唯一不在 TanStack Query 里的共享服务端状态:五处独立取,只靠 in-flight promise 去重,登录完成后兄弟消费者不失效;`use-saved-route.ts` 手写 mutation 状态机;`use-popular.ts:6` 手写 `queryKey` 覆盖 oRPC 生成键,`catalog().popular.key()` 失效匹配不到 | `lib/auth/session.ts:14-30`,`routes/index.tsx:34`,`routes/settings.tsx:14`,`ChatEntryGate.tsx:61-67,119`,`ChatPage.tsx:152`,`use-save-gate.ts:45-52`,`use-saved-route.ts:118-127`,`use-byok-settings.ts:204-211` | `useQuery({ queryKey: ["auth","status"] })` + 登录/登出 `invalidateQueries`;`useMutation` 包共享请求;删手写 key | 部分(plain-function save 有记录,`use-saved-route.ts:38-44`) |
| web-M4 | effect 里按 prop 变化重置状态五处,其中 `SearchResult` 的 `spots` 每次 render 新数组、每个 SSE chunk 触发——正是隔壁 `useStablePoints` 为之而写的坑;render 期副作用(`previous.chat.stop()`、ref 写)四处;`dataPartSchemas` 双键注册引「7.0.47 验证过」的 bug,装的是 7.0.77 | `SearchResult.tsx:90`,`Cards.tsx:87`,`use-clarify-pick.tsx:136`,`use-recompute-turn.ts:69`,`use-spot-selection.tsx:27`,`SceneThumb.tsx:22`,`use-chat-session.ts:25-28,303-305,439`,`use-turn-timeout.ts:28`,`use-turn-timing.ts:74`,`use-magic-link-form.ts:53` | render 期派生或 `key={sessionKey}` 子树;`stop()` 进 effect cleanup;对 7.0.77 复验双键注册,删或钉 issue 链接 | 无 |
| web-M5 | 页面是 hook 塔(`useChatPage` → 4 hooks → `useTrayState` → 5 hooks),结果是 `ReturnType<typeof useChatPage>` 的展开包,传给 6–7 位置参数的「assembly function」;`use-auth-callback.ts` 同型,含两个近重复超时 racer;行数上限靠按数切割满足,`naming-ownership.md` 明说 SOLID 优先 | `ChatPage.tsx:149-159,175-188`,`use-auth-callback.ts:55-60,66-75,146-154,158-167` | 每关注点一个 reducer/状态机(turn lifecycle、quota lock、selection、callback session)与命名视图模型;组件收一个 typed prop 对象;删 `withTimeout` 留 `timedRace` | 无(注释解释症状不解释决定) |
| web-M6 | 注释与 lint 配置/lockfile/AGENTS.md/e2e 清单矛盾:「没有一条 react-hooks 规则启用」而 `.oxlintrc.json:17-18` 两条都是 error;「endpoint 无去重键」而 `use-saved-route.ts:28-49` 每次创建发 `Idempotency-Key`;「verified at 7.0.47」对 7.0.77;AGENTS.md「不要 import 其 React 组件」对四处 import;playwright 配置「36 cases in 9 files」对 81/18 | `TimedItinerary.tsx:115-117,154-158`,`use-saved-route.ts:115-117`,`use-chat-session.ts:22,232,246`,`ByokSettings.tsx:3-5`、`ByokUpsell.tsx:1`、`LanguageSelect.tsx:1`、`ThemeSwitch.tsx:1`,`e2e/playwright.config.ts:10,54-57`,`e2e/package.json:8` | 删假话;承重事实(幂等、SDK bug)引 issue/版本并加钉测试 | 无 |
| web-M7 | 五个包组件经别名 import 包的私有 `dist/es/components/…` 布局(非导出子路径),`env.d.ts` 对着 barrel 再声明类型——运行时与类型从不同文件解析;`dedupe: ["react","react-dom"]` 掩盖 vendored `react-dom@19.2.6` | `animal-island-vite.ts:6-8`,`env.d.ts:3-22`,`vite.config.ts:9`,`vitest.config.ts:5` | 向上游要 `exports` 子路径(或修 barrel),或 vendor 五个薄包装;AGENTS.md 与代码二选一对齐 | 规则有,例外无 |
| web-M8 | 一个产品五套样式词汇(1,501 行 BEM `chat.css` + 每页 CSS、`.ds-*`、包类层 `animal-btn`、包 React 组件、Tailwind 却写 `bg-[var(--color-card)]` 而 `@theme inline` 已有 `bg-card`);token 字面量绕过 `:root` | `chat.css:65,251,315,329,336`,`globals.css:165-221,593-656,666,673,708,714,736-778,740,745-746`,`DoorwaySummary.tsx:53,72-73`,`ContinueFromCard.tsx:8`,`PrivacyPolicy.tsx:11-13`(用对的) | 每个面一条规则:控件用包类,布局用主题 utility(不用 `[var()]`),token 只在 `:root`;login modal 改 `animal-btn` + wrapper 级 `--animal-*` remap 后退役 `.ds-*` | 部分(`ds-*` 在 `docs/design/animal-island-adoption.md:117`) |
| web-M9 | 恢复失败无状态(D4 条留着、spinner 停、无提示);恢复把转录压平成纯文本,重试后每张 route/search 卡都丢;`confirmPhotoSearch`、maplibre、SW 注册三处静默吞 | `use-stream-recovery.ts:30-36,54-56`,`photo-search.ts:161`,`maplibre-adapter.ts:61-69`,`anime/register-sw.ts:14`;`web-chat-error-states.spec.ts:114-135` 只断言文本 | `D19 recovery-failed` 态带自己的重试;从 `response_data` 重建消息(history 带 `intent`,`use-conversation-history.ts:27-29`);confirm 失败走 field-vitals 同一 reporter | 部分(P6「no resume」有;压平与静默无) |
| web-M10 | 唯一生产调用方硬编码 `challenged: false`,`suppressedByChallenge` 生产不可达;`turnstile_required` 中途到达时渲染 D18 回退而不是重臂 widget——`resetTurnstileWidget` 正为此存在 | `ChatPage.tsx:145`,`use-turn-failure.ts:32-34,41`,`TurnstileGate.tsx:52-59` | 决定:删参数与测试,或从入口门把 `challenged` 接到页面 | 无 |
| web-M11 | 13 个 `*-css.test.ts` + 13 个 `readFileSync` 门测试钉源码/CSS 声明;三处真实 sleep(25/10 ms);98 个测试体内 `if/for`;64 个 CSS 类 `querySelector`;覆盖率下限逼出 M1 死码的测试(08-26 §4 项 4 仍开) | `tests/unit/chat-css.test.ts:7`,`use-chat-session-state.test.tsx:42`,`use-auth-callback.test.tsx:172`,`basemap-mount-failure.test.tsx:37`,`turnstile-i18n.test.ts:31-44`,`chat-page-entry.test.tsx:20`,`save-copy-i18n.test.ts:26-69`,`tool-step-badge.test.tsx:55-87` | 留有事故背书的契约钉,删布局钉;`vi.useFakeTimers()`;`it.each`;role 取代 class | 部分(部分钉子内联引了事故) |
| web-M12 | 无障碍标签硬编码单语而周围文案三语;`HistoryList` 把 `✓ plan_route` 这类 intent 码当用户文本渲染;搜索框是 `div` + Enter `keydown` 不是 `<form>`;`LoginModal` 手搓焦点陷阱而 `<dialog>`/`showModal()` 自带;`ChatInput` 每次挂载 `autoFocus`(e2e 要反做) | `MapCard.tsx:74`,`RoutePinLayer.tsx:33`,`RouteDetailStates.tsx:61`,`GoldBar.tsx:18`,`HistoryList.tsx:8`,`SearchBox.tsx:22-25`,`LoginModal.tsx:26-57`,`SpotSheet.tsx:62`,`ChatInput.tsx:111` | 标签走 copy 对象;`<form>`;`<dialog>` | autofocus 有(e2e 注释),其余无 |

### 2.6 tooling(`packages/eval`、`infra`、`scripts`、`.github/scripts`、`.github/actions`、`Makefile`,tooling.md High 5 + Medium 17)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| T-01 | 契约兼容基线 fail-open + 隐藏路由豁免 | → §1.7 | → §1.7 | 无 |
| T-02 | 损坏的 eval 基线静默关闸 | → §1.8 | → §1.8 | 部分 |
| T-03 | 两个 OIDC 铸币器:独立脚本只被自己的测试引用,活路径内联一份更弱的(`jq -r` 让缺 `.value` 变成字面 `null` 当 bearer 送出) | `request-github-oidc-token.sh:6-8` vs `promote-release-unit.sh:205-209` | 删一个;`migrator_oidc_token` 调脚本,或内联 `-er` 并删脚本与测试 | 无 |
| T-05 | promote 循环五份只差 `if:`/`env:`,五个近同 `stage-*` job,生产再手展一份——改一个阶段输入是跨两文件的 10 处编辑(08-26 §5b 仍开) | `promote-release-phase/action.yml:126-218`,`cd.yml:89-224,293-353` | 一个带 `phase` 输入 + JSON env 映射的 composite step,或 `scripts/promote-release-phase.sh` 供 action 与生产 job 共用;阶段顺序只留 `cd-cohort-plan.py:13-19` 一份 | 无(08-26 列入 W7) |
| T-06 | edge 运行时密钥集写在至少九处(三处是 rollback action 的 blank-out 块),一致性测试只抓「少一份」,每次轮换/新增都是九文件改动 | `edge-runtime-secrets.py:11-19`,`cd.yml:187-194,330-337`,`promote-release-phase/action.yml:45-70,182-189`,`rollback-release/action.yml:51-61,70-80,112-122`,`test_secret_provisioning_contract.rb:5-8`,`test_cd_workflow_contract.rb:68-71,97-101`,`test_production_safety_contract.rb:10-14`,`test_edge_runtime_secrets.py:12-20` | 一份机器可读清单(`.github/ci/edge-secrets.json`,或从 `workers/edge/wrangler.toml` bindings 派生)供渲染器、契约与一个 YAML anchor 消费;workflow 传 `secrets: inherit` 按环境限定或一个 JSON blob | 无 |
| T-07 | 本地路由器硬编码路径桶与 contract 消费者表,CI 从 `depends_on` 派生同一件事;一致性测试只查 component roots,不查消费者并集与 `db/docs/ci/scripts` 桶 | `changed-packages.sh:81-90,106-108` vs `components.json` + `change-plan.py`;`test_ci_routing_consistency.rb:24-28` | pre-push 路由器调 `change-plan.py --format names`(`pr-verification-route.sh` 已用),或 hook 时从 manifest 生成 `case`;#1323 是同一路由器的另一个缺口 | 部分(`docs/ops/local-gates.md` 记 union 规则,不记为何不派生) |
| T-08 | 十四个私有 YAML 加载器、两种 `on`→`true` workaround(re-quote 那种漏 `on :` 带空格,`assert-workflow-invariants.rb:85-87` 自己承认);再加五个 bash/sed/python 手写 YAML/lockfile 读取 | 九处 re-quote、五处 `wf[true]`;`workspace-packages.sh:24-29`、`changed-packages-workspace-tests.sh:12-15`、`reset-staging-baseline.sh:19-22`、`database-access-adopt.sh:148-154`、`check-actions-pinned.sh:95-171` | 一个 `workflow_yaml.rb`(`load_workflow`、`triggers`)供每个契约 require;shell 侧 Pulumi config 与 lockfile 用 `yq`/PyYAML | 无 |
| T-09 | 靠同步测试守住的字面量:Postgres 镜像 tag 七处、runtime-config JSON 两处 + 一个专职 checker、wrangler-dev-and-curl 块两份、`seq 1 60` readiness 循环三份、`realpath` 一行 python 四份、`EVAL_MODEL` 三处、Atlas `0.30.0` 四处(+ Dockerfile、`atlas_helper.py`) | `db-fresh-schema.sh:25`、`db-fresh-schema.test.sh:95`、`pre-push-tests-gates.sh:99,112-116`、`test_pr_verification_contract.rb:114`、`pr-verification.yml:226`、`conftest_db.py:44,100`、`docker.ts:14`、`postgres-arm.ts:24`;`cross-stack-e2e/action.yml:24-41` / `pr-verification-gate.sh:49-76`;`agent-eval/action.yml:23,33`、`stats-oracle.ts:113`;`Makefile:7`、`install-atlas/action.yml:8`、`pre-push.sh:54`、`test-stub.sh:57` | `.github/ci/toolchain.json`(镜像 tag、atlas/actionlint/semgrep/uv 版本、eval model)供脚本读、workflow 插值;`scripts/ci/serve-web-worker.sh` 供两个 e2e 调用点;`realpath` 在一个 sourced 文件里一次 | 无 |
| T-10 | 325 行的编排器头注自称「为 1-10-50 拆分」;Quality lane 是 36 条 `ruby -c` + ~85 条 `run` 的手写列表,没加进去的契约文件永远不跑(parity 测试只抓 CI 步没有本地镜像,不抓文件没接线) | `pre-push.sh:19-22`,`quality.sh:19-141`(`:126` 已有一条 glob 派生的) | `ruby -c` 目标从 `git ls-files '.github/scripts/*.rb'` 派生;执行由 manifest 或文件名约定(`test_*.rb` → run)驱动;`gate_*` 拆到 `scripts/local-gates/gates/<pkg>.sh` 由 `run_package_gates` source | 无 |
| T-10a | 约 900 行无调用方脚本:`why-blocked` 家族(≈560 行,唯一调用方是自己的测试,自述指向 08-31 已退役的 `pr-review-check.sh`)、三个 `scripts/check-*.sh`、`migration-head.sh`(活路径在 `promote-release-unit.sh:200-202` 用 `find` 重写了它);两个解析 `ls` | `why-blocked.sh` + `why_blocked.py` + `why_blocked_models.py` + `thread_tally.py:3`,`check-db-ownership-doc.sh`,`check-role-matrix-migration.sh:4`,`check-skeleton-w0-docs.sh`,`migration-head.sh:12`,`database-access-adopt.sh`(T-18) | 删或接线(`make why-blocked PR=…`)并写文档;scripts 自测加可达性检查(每个 `scripts/**/*.{sh,py}` 必须被 Makefile/hook/workflow/action/`docs/ops/` 引用) | 无 |
| T-11 | 按行数机械拆分:`_part_1..5` 每个末尾一行死的 `# frozen_string_literal: true`(6 文件)、14 行单测试文件、「Cases 9-15」续集、`test_change_plan.py` 211 行照样超 | `assert_workflow_invariants_test_part_{1..5}.rb`,`_test_support.rb`,`assert-workflow-invariants.test.rb:5-6`,`pre-push-tests-hygiene-url.sh`,`check-actions-pinned.test-cases.sh:3` | 按不变量拆(timeout / permissions / concurrency / merge-queue / expression parser)并以此命名;删尾注释;`hygiene-url.sh` 合回按关注点拆的 hygiene | 200 行规则有,按数拆无 |
| T-12 | 契约测试钉子串数量与 YAML 文本顺序而非行为:`scan(...).length == 4`、`cd.index("stage-foundation:") < cd.index("stage-migration:")`、钉 `kill "$WRANGLER_PID"`/`rm -f "$DEV_VARS"` 子串、钉路由器 `case` 臂文本——无害重构变红,保留子串的语义破坏照绿 | `test_cd_workflow_contract.rb:102,151`,`test_cd_infrastructure_safety_contract.rb:13-14`,`test_secret_provisioning_contract.rb:46`,`test_pr_verification_contract.rb:75,128`,`test_ci_routing_consistency.rb:31-32`,`test_production_safety_contract.rb:112` | 断言解析后的 YAML(`test_cd_skip_propagation_contract.rb` 已这样做)与经 fixture 的脚本行为(`test_promote_release_unit.sh` 已这样做);`include?` 只留一行不变量 | 无 |
| T-13 | 46 个用例写固定 `/tmp/<name>-caseN.out`,两个 worktree 或 CI shard 并发即相撞且不清理,同一行旁边的 repo fixture 却用 `mktemp -d` | `.github/scripts/check-*.test.sh`,`shebang-exec-bit.test.sh:30-70` | `out="$(mktemp)"` + EXIT trap,或写进已建的 `$repo` | 无 |
| T-14 | 只有缺席断言的测试在空 workflows 目录/空树上也绿;`infra/testing/harness.ts:52-58` 自己写着「缺席测试必须有存在锚」 | `test_neon_test_infra_absence.rb:41-65`,`test_retired_retention_absence.rb`,`check-e2e-promotion.sh:15` | 每文件一条 presence 断言(如 `cd.yml` 存在且含 `stage-foundation`)再进缺席循环 | 规则有,这些文件早于或无视它 |
| T-15 | `.github/scripts/*.py` 在 mypy 之外:`fail() -> None` 当值用是 NoReturn 洞(`anon_flag` 失败时穿过返回 `None`),`config` 无类型——`Any` 从省略进来 | `edge-runtime-secrets.py:23-43`,`cd-cohort-plan.py:52-53,65-68` | `-> NoReturn`,`config: Mapping[str, object]`;`.github/scripts` 与 `scripts/local-gates/*.py` 进 Quality lane 的 mypy/ty 目标 | 无 |
| T-16 | 两个 manifest 模型严格度不同:cohort planner 不查 `schema_version`,接受 change planner 拒绝的 manifest——一次 `schema_version: 3` 升级 CI 路由抓到、CD 路由静默忽略 | `cd-cohort-plan.py:25-36,77-92` vs `component_manifest_schema.py:9-37,168-169`;`test_cd_cohort_plan.py:24` | import `load_manifest`/`Component`,删本地 TypedDict | 无 |
| T-17 | `npx --yes neonctl@3.6.0` 三处在 staging 部署路径(版本 pin、完整性不 pin),`make e2e` 与 `visual-check.sh` 裸 `npx`,而 `e2e-setup.sh:27-30` 自己解释了为什么不能(08-26 §3 仍开;仓库有 npx 抢注前科) | `reset-staging-baseline.sh:36,63,69`,`Makefile:245`,`visual-check.sh:181` | `neonctl` 进 `infra/database-access/package.json` 走 `pnpm exec`,或换 Neon REST API `curl`;`make e2e` → `pnpm --dir e2e exec playwright test` | 无 |
| T-18 | adopt 脚本:维护者家目录路径写在公开仓库、`pulumi stack` 读失败静默默认 `staging` 后接 `pulumi import --yes`、硬编码 Secrets Store item UUID、50 行 Python heredoc 正则读 `pnpm-lock.yaml`;只被 runbook 引用,从不进 CI(08-26 §2.6 仍开) | `database-access-adopt.sh:6,54,65,71-72,129-177`;`docs/ops/prod-dsn-cutover.md` | adopt 已跑就删脚本、provenance 留 runbook;否则 `PULUMI_STACK` 必填、UUID 进 stack config、`pnpm ls --json` 读版本 | 部分(头注解释存在,不解释为何不进 CD) |
| T-19 | infra 是唯一 TS ^5(lockfile 5.9.3)且无 `lint:oxlint` 的 workspace 包;`@pulumi/cloudflare ^6.0.0` caret 让新 lockfile 能在 CD 下换 provider 次版本;`js-yaml 4.3.1` 声明未 import | `infra/package.json:10-16`;`docs/ops/local-gates.md` 表 infra lint 为「—」 | 精确 pin(如 `packages/eval` 对 logfire),加 `lint:oxlint`,上 TS 7 或在 `infra/AGENTS.md` 记豁免;删 `js-yaml`(是否有非 TS 消费者未验证) | 无 |
| T-20 | 十一处 stack 名字符串比较散在五个文件,`requireKnownStack()` 只守 `web-routes.ts`,未知 stack 的 bucket/secret 名照样按后缀派生 | `infra/src/config.ts:19,24-25,31-32`,`hardening.ts:19`,`staging.ts:99,141`,`web-routes.ts:26,35,42-43,78,111`,`database-access/index.ts:71` | `config.ts` 一个 `stackProfile`(worker 名、apex、bucket、`isProd`),stack 名校验一次 | 命名规则有,散布无 |
| T-21 | 「三个安静 tick」计时启发式做测试同步(harness 自己承认可能漏),根因是 `import "./src/buckets.ts"` 在模块加载时注册资源——七个 `topology-*.test.ts` 各占一进程,`pulumi.runtime.setMocks` 不能复用 | `infra/testing/harness.ts:53-63`,`infra/index.ts:6-9` | `index.ts` 导出 `buildInfra(config, stack)`(或 `ComponentResource`),`Pulumi.yaml` 入口调用;测试 `await` 注册,多个排列一个文件 | workaround 有记录,保留副作用无 |
| T-22 | JWKS/issuer 派生三份,其中 `database-access/index.ts` 那份写在能 import 兄弟纯函数的模块里;测试承认无法核验 edge 那份 | `infra/src/neon-auth.ts:16-24`,`infra/database-access/index.ts:227`,`workers/edge/src/identity/auth.ts`;`topology-neon-auth.test.ts:56-63` | 派生放进 `packages/contract`(已是跨服务真源),infra、database-access、edge 都 import | 无 |

### 2.7 architecture 横切(architecture.md P0 3 + P1 12)

| id | 一句话 | file:line | 修法方向 | 文档背书 |
|---|---|---|---|---|
| ARCH-01 | live runtime reference 写着重写已否决 | → §1.10 | → §1.10 | 部分 |
| ARCH-02 | edge 从未被 CI typecheck | → §1.9 | → §1.9 | 无 |
| ARCH-03 | 「hexagonal」在任何包里都没有机器守卫(无 import-linter、无 `no-restricted-imports`、无 dependency-cruiser、无边界测试);已测出的越界:agent application→interfaces(上行)、application→SQLAlchemy `AsyncSession`、`agents/`→infrastructure;catalog 见 F1;`packages/contract/test` import `workers/edge/src`(发布语言依赖消费者);edge 按决定不 hexagonal,却在承接 Python domain 模块的移植 | `submit_feedback.py:22`、`get_session_history.py:21`、`outbox.py:16`、`outbox_port.py:17`、`byok_models.py:36-38`、`animichi_agent.py:37`;`chat-answer-part.test.ts:14-15`;`CONTEXT-MAP.md:39-48`;`2026-08-06-catalog-clean-architecture-design.md:367` 未勾选 | 每语言一个守卫就够:每包 `.oxlintrc.json` 一段 `no-restricted-imports`(Python 侧随 W4 消失,可不做 import-linter);edge agent tier 要不要 `domain/`、`CONTEXT.md` 怎么改(§6 Q1) | 方向规则有(三份 08-06 设计),守卫缺席是未勾选的 checkbox,从未决定 |
| ARCH-04 | Python↔SQL schema 漂移真实且无守卫:`sessions.lifecycle/created_at/updated_at` SQL 可空、ORM `nullable=False`;`agent_memory_metadata` 无 ORM 映射;`test_points_schema_alignment.py` 是 0 字节文件(自 `d2233b502`),pytest 收集为零测试不报错;edge 侧有守卫,`db-fresh-schema.sh` 只证链能 apply,`contract-drift.sh` 比的是 OpenAPI 不是 schema | `20260826000004_agent.sql:31,180-182` vs `session.py:40-46`;`workers/edge/test/agent-runs-schema.test.ts` + `migration-schema.ts` | Python 侧随 W4 消失:删空测试或在 `migrations/AGENTS.md` 表所有权行记录漂移;空测试文件应让 `make lint` 红(`pytest --strict` 收集断言或五行检查) | `client_message_id` 缺口有(迁移注释);`sessions` 可空与空测试无 |
| ARCH-05 | 契约的 conformance 测试 import edge 源码,且只在 contract 变更时跑——`change-plan.py` 只向消费者扩散,edge-only PR 改 `turn-answer-part.ts` 不会执行检查它投影的那个测试;投影同时是 SSE 帧与持久化的 `messages.response_data` | `chat-answer-part.test.ts:1-15`;`components.json` contract `depends_on: []`、edge `depends_on: ["contract","db"]`;`change-plan.py:136-145` | `gate_edge` 加 `packages/contract/**` 测试执行(或 `test_triggers`),或检查搬进 edge 做 `bundle-smoke` 式 node test 派生 zod parser(`test_chat_wire_contract.py` 的技法);#1323 是同一路由器 contract→agent 方向的同类缺口,一起修 | 放置仅头注;触发缺口无 |
| ARCH-06 | `packages/contract` = wire 类型 + 运行时密码学(jose 验证器,`jwt.ts`/`oidc-github.ts`)+ ≈830 行 CI diff 工具(`index.ts:7-21` re-export,无外部 import);「唯一共享真源」同时发货安全关键的验证代码,无 owner BC;`package.json:6` 仍写「Python Agent (client) ↔ TS Catalog (server)」 | `contract/src/index.ts:7-21`,`package.json:6,34`,`CONTEXT.md:3` | 拆 `packages/contract`(wire 类型 + 注册表)、`packages/openapi-tooling`(CI-only)、`packages/auth-primitives` 或验证器进 edge 由 migrator import;保留精确 pin 集(§6 Q9;与 ucm-M6、EG-03 同一批改 exports) | OIDC 验证器放置有(`migrator/AGENTS.md:25-26`);工具链放置无 |
| ARCH-07 | gateway 自述按体量 72% 错(`agent` 11,589 · `gateway` 1,625 · `protect` 854 · `identity` 490 · `proxy` 355 · `db` 337 · `container` 273 · `staging-gate` 267);根布局表漏 `workers/migrator/`、`packages/eval/`、`workers/jobs/`;users 行说有 `jose`、21 测试(实际无 jose,13 个 `*.worker.test.ts`);edge `AGENTS.md` 296 行对 DOCS_POLICY「≈120」 | `AGENTS.md:15-24`,`CONTEXT-MAP.md:44-45`,`workers/edge/CONTEXT.md:3-23`,`DOCS_POLICY.md:61` | 重写根 `AGENTS.md`/`CONTEXT-MAP.md` 的 edge 行(gateway + 旗标后的 agent tier),加 migrator/eval 行,修 users 行;agent tier 叙事从 edge `AGENTS.md` 挪到 `workers/edge/src/agent/README.md` | agent-in-edge 有(spec §二);doc 滞后被推到 W4 |
| ARCH-08 | env 触点双向漂移,守卫只认凭据形状的名字:8 个转发键(`CACHE_TTL_SECONDS`、`USE_CACHE`、`RATE_LIMIT_*`、`MAX_RETRIES`、`TIMEOUT_SECONDS`、`GOOGLE_*`)Python 无字段、`extra="ignore"` 吞掉;3 个真实字段(`message_max_chars`、`agent_deadline`、`model_attempt_timeout`)无转发键,容器永远跑 Python 默认;同一 allowlist 模式正被 edge tier 复用 | `container-env.ts:30-35` vs `settings.py:65-66,92,108,111`;`test_secrets_docs_consistency.py` 只钉凭据后缀;`workers/edge/AGENTS.md:276-279` | 从 `Settings.model_fields` 派生 `CONTAINER_ENV_KEYS` 的测试(或删 8 加 3);docs-consistency 测试从「凭据形状」扩到「每个转发键」;随 W4 一起消失的部分不投入 | 无 |
| ARCH-09 | 仓库级不变量放在计划删除的包里:五个 Python 单测读 `container-env.ts`、`apps/web/vitest.config.ts`、`use-turn-timeout.ts`、`identity-contract.ts`、`components.json`;`components.json` 用 `docs` 组件的 `test_triggers` 反向补丁;edge node:test 守 GitHub workflow 内容;spec W4 的删除清单不提搬迁——删 `apps/agent` 的那个 commit 同时删掉密钥文档守卫、覆盖率文档对等守卫、身份策略文本钉、超时预算钉 | `test_secrets_docs_consistency.py:35,61`,`documentation_guardrails.py:109-112`,`test_timeout_budgets.py:23`,`test_auth1_identity_policy_pin.py`,`test_ci_eval_gate_workflow.py:31`;`2026-09-01-agent-ts-rewrite-spec.md:86` | 搬进 `scripts/local-gates/`(已是 quality lane)或 `.github/scripts/`,写进 #1317 的 checklist | 无 |
| ARCH-10 | 九条 `.claude/rules` 里四条描述不存在的文件/工作流,`check-agents-refs.sh` 跳过含 `*` 或末段无后缀的候选,所以 `db/migrations/*.sql`、`ci.yml`、`deploy.yml` 从未被查:`migrations.md` `paths: db/**`(`db/` 只剩 `.sqlfluff`)因此永远不加载;`ci.md` 训练 agent 认 #1003 之前的 CI 形状并批准一个不存在的 `continue-on-error` agnix 门;`infra.md` 说密钥在 Pulumi/ESC 而 ADR-0003 与 `sync-edge-runtime-secrets.sh:14` 走 Secrets Store + `wrangler secret bulk`;`css.md` 要 `@/lib/utils` 的 `cn()`(不存在);`naming-ownership.md` 无 `paths:` | `migrations.md:2-3,7,11,14-15`,`ci.md:7-9,18-20,23`,`infra.md:17-19`,`css.md:17`;`check-agents-refs.sh:33-49`;`DOCS_POLICY.md:62-63` | 修四文件;`check-agents-refs.sh` 对 `paths:` glob 用 `git ls-files` 校验(零匹配即失败) | 无 |
| ARCH-11 | 死子系统清单与各自的钉:`workers/jobs/` 只剩 `wrangler.toml`,缺席测试 `test_retired_retention_absence.rb:6` `File.read` 它——#1316 不改门就让 quality lane 红;`jobs_svc` 仍在三份迁移里建/授、`migrator-ac3-proof.test.ts:27` 列为运行时角色;W0 spike 遗留(`spike/pi/` 2,899 行 + 自带 `wrangler.toml`、`db-test/`、12 个 `pi-spike-*` 共 1,300 行、`scripts/spike/*.sh` 950 行)在 09-03 关闭后仍在;`supabase/` 靠 W4 要删的 `test_phase1c_route_persistence.py` 活着;`spikes/codemode/` 在生产包与 coverage source 里;`recovery/` 靠 `check-root-allowlist.sh:45`;`verify:dependabot`;四个无引用脚本;从未翻转的旗标矩阵(`webRoutesEnabled` prod false、`EDGE_SHOWCASE_MODE` prod true、`ANON_ACCESS_ENABLED` prod false、`PROD_SNAPSHOT` 注释、catalog `crons = []`、`DIRECT_GATE_ENFORCE` 无处设置、`RATE_LIMITER` 可选 fail-open) | `20260826000001_roles.sql:9,17`、`…004_agent.sql:59,196`、`…005_users.sql:45`;`workers/edge/AGENTS.md:244-245,258-261`;`pyproject.toml:143-158`;`infra/Pulumi.prod.yaml:6-17`;`workers/edge/wrangler.toml:257-263`;`catalog/wrangler.toml:79-80,128-137`;`edge/src/env.ts:46-49` | #1316 一趟迁移删 jobs 壳 + `jobs_svc` 并改门;spike 树现在删(spec 附录已带测量);`spikes/codemode` 进 `tests/` 或出 coverage source;旗标矩阵在 `docs/ops/deployment.md` 记一次(§6 Q10) | jobs 有(#940);spike 删除有但未执行;其余无 |
| ARCH-12 | 错误码与 locale 表无钉复制——五个注册表:users 两份无对等测试(ucm-M3);web `error-classifier.ts` 从三处手写 7 码,只 import 两个 `ANON_*`;edge `cost-breaker.ts:16` 重声明 contract 已导出的 `ANON_BUDGET_EXHAUSTED_CODE`(edge 依赖 contract);`["ja","zh","en"]` 七处无跨包测试;`LanguageSelect.tsx:1-27` 是活的手动语言下拉(自述「替换已退役的三键切换器」),而 owner 政策是无手动切换器——代码至少两次做了相反决定 | `users-contract.ts:66` ↔ `users/src/lib/errors.ts:10-13`;`agent-tool-parameters.ts:104`、`agent-contract.ts:80`、`web/src/i18n/locales.ts`、`language.py:12`、`translation.py:161-163`、`chat-envelope.ts:22` | edge 改 import(两处);`users-errors-parity.worker.test.ts` 照 catalog 的写;contract 导出 `CHAT_LOCALES` 给 web/edge;切换器明确决定并写进 `apps/web/AGENTS.md`(§6 Q8) | catalog 三镜像有(`contract/README.md`);users 镜像有名无守;locale 与切换器无 |
| ARCH-13 | 三份手写 Postgres fixture(+ 一条 spike 遗留 lane)跑同一镜像 `animichi-test-postgres:18-3.6-pgvector-0.8.5`、都从 `template1` 用 Atlas apply;只有 edge 设 `withStartupTimeout(240_000)`(arm64 模拟),只有 agent seed `fixtures/seed.sql`;`catalog/AGENTS.md:68` 说 spike DB「fail-loudly」而同包 `spike-db.ts:140-144` 提供 `describe.skip("known-failing")` | catalog `spike-db-global/docker.ts` + `spike-db.ts`,edge `agent-db-test/postgres-arm.ts`,agent `conftest_db.py` + `db_config.py`;`edge/db-test/spike-run-store.test.ts` | 一个 `packages/test-postgres`(或 `scripts/test-db/`)拥有镜像 tag、Atlas apply、truncate 表,两个 TS lane 消费;Python arm 随 W4 走;#1326(edge 与 agent-db fixture 共享 readiness wait)是这张卡的第一步 | 无(各 lane 自述,互不引用) |
| ARCH-14 | 荣誉制那一半的护栏在没 lint 的一侧全面失守:Python 生产文件 >300 行 14 个(`public_api.py` 1,136、`agent_turn.py` 628 …),类 >50 行 5 个(`RuntimeAPI` 299、`AgentTurn` 560),`public_api.py` 23/58 函数 >10 行(`_run` 113 行),`dict[str, object]` 111 处对 `python-types.md:12`,`PLR0913` 82 处(规则未选),mypy 从未开 `disallow_any_explicit`(`:189-196` 的 override 是 no-op);TS 机器守的规则干净,同一 10 行预算临时套到五个非 web TS 文件也只 5 处越界 | `pyproject.toml:92-101,176-196`,`.oxlintrc.json:144-146`,`apps/web/.oxlintrc.json:19-22`;全表见 §8.2 | W4 前逐条定:两种语言都 lint,或从 `AGENTS.md` 删(§6 Q2);核心模块 40% 违反率的规则不是规则;Python 数字随包删除消失 | 规则有(`AGENTS.md:45-56`),执行缺口无 |
| ARCH-15 | 文档门只查 `docs/` 前缀路径存在与 AGENTS/rules 的反引号,不查主张,漏 `workers/…`:`DOCS_POLICY.md:52` `workers/edge/proxy/image-proxy.ts`(实为 `src/proxy/`);`deployment.md:86-88` `interfaces/routes/runtime.py`/`POST /v1/runtime`(不存在,实际路由 `/v1/chat`、`/v1/feedback`、`/v1/conversations*`、`/v1/bangumi/{id}/guide`、`/nearby`、`/v1/byok/probe`、`/v1/sessions/adopt`、`/v1/search/preview`、`/v1/photo-search*`、`/healthz`);`ARCHITECTURE.md:121` 三条不存在的端点;`DOCS_POLICY.md:58-59` 要求的 `CLAUDE.md` 指针在 `workers/edge`、`workers/migrator`、`packages/eval` 缺 | `check-docs-paths.sh:2-11`,`check-agents-refs.sh:1-4` | `check-docs-paths.sh` 扩到 `apps/`、`workers/`、`packages/`、`migrations/`、`scripts/`、`infra/`、`e2e/` 前缀 token;加三个指针 | 无 |

---

## 3. P2 精选

只收两类:跨 ≥2 个包重复出现的,或挡在某条 P1 修法前面的。其余 P2 一行一条在 §8.4。

1. **陈旧自述的 P2 层**(EA-15、F23、T-23、ARCH-17;P1 层的 EG-12、ucm-M7、web-M6 在 §2)。EA-15 列了七句描述不存在运行时的注释(`service-binding-catalog.ts:21`「唯一的 cast」、`session-wakeup.ts:88-90`「both surface」对着 `Promise.all`、`schema.ts:59-61`「reclaim scan 的两个判决」而 scan 只读、`agent-session.ts:56-60` 等四处「化身」租约);F23 八个 `src` 文件引用两条链之前就删掉的迁移文件(`20260623000001_init.sql`、`20260620230000_ingest_infrastructure.sql`、`remote_schema.sql`),`db/client.ts:26-30`「needs live-Neon validation before merge」已合并数周;T-23 六处路径/名字指向不存在的文件(`scripts/export-eval-fixtures.sh`、`Pulumi.production.yaml`、`infra/Pulumi.yaml:6` 的 Hyperdrive);ARCH-17 的九条包级事实(PydanticAI 2.9.1 vs 2.21.0、「pre-commit 跑 mypy」、`src/lib/route.ts`、users 的 `wrangler secret put`、web 的 `src/lib/route-detail`、655 vs 662 用例、`codecov.yml:16` 的 80 vs 87)。这四组加 §2 的三组是同一种病的七个采样,修法在 §5 第二条。
2. **源码文本钉与布局锁**(EA-16、F21、ucm-L10;P1 层 EG-14、web-M11、T-12)。`web-search-lane.test.ts:39-67` 对函数体做正则、`agent-durable-objects.test.ts:69-72` 对一个可 import 的常量做 `assert.match`;catalog `run-store.worker.test.ts:12-14` 等五处钉 Drizzle 渲染出的 SQL 文本,`expressions.worker.test.ts:6-12` 引用的「no rendered-SQL assertions」规则源文档没找到;users 测试读 `workers/edge/src/identity/auth.ts?raw`(移动 `auth.ts` 会弄红 users 的测试),`runner.test.ts:185` 用 `setTimeout(2)` 拿不同的 `Date.now()`。08-26 §4 项 4 要的「轻审一遍分开事故钉与布局锁」没有做,新层又添了一批。
3. **两套「匿名」判定**(EA-21 = EG-24,同一处代码两份报告都抓到;挡在 EG-01 前面)。`agent-turn.ts:89-90` `isAnonymousIdentity` 看 `userType === "anonymous" || userId.startsWith("anon_")`,`:105` `payerFor` 只看 `userType`——一个 `userType` 打错、id 带 `anon_` 前缀的身份被 BYOK 门拦下却按 `user` 计费:无预留、无日上限。X4 的 owner 不管落在 intake 还是 settlement,都要先有唯一的 `identityClass(identity)`。
4. **信任边界的读取三种写法**(EA-07、F12、ucm-L3、ucm-L7 的 `isRecord`/`iso` ×5、T-28)。edge 对 jsonb/DO storage 的读一处逐字段校验(`durable-envelope-store.ts:75-107`)、一处 `as StepResult["content"]` 只查 `Array.isArray`;catalog 同一 neon-http 边界两处经 `lib/rows.ts` 校验、八处裸 `as X[]`、两处手写 `Number()` 强转(`popularBangumiDb` 会静默返回 `points_count: NaN`);users 两个 adapter 对同一列一处 throw 一处 `String()` 强转;eval 对已提交 fixture `JSON.parse(...) as StatsOracle`。每个包都已经有一份守卫式读法,只是没用在全部读点上。
5. **裸字符串状态与词表**(EA-22、F13、ucm-L9、EA-10)。edge `SelectionRecord.status: string` 在三条路径各自再收窄、`insertMessage(role: string)` 而 `MESSAGE_ROLES` 存在;catalog `catalog_runs`/`ingest_jobs.status text` 无 CHECK、`"running"/"pending"/"done"/"failed"` 六处裸字面量、`not_found` 两个来源;`"human"` 这个 users 信任边界切换的值在三个包里是字面量,拥有头名的 contract 不导出它;`Pacing` 在 `fact-ledger.ts:38-39` 重声明而 `@animichi/contract` 已有。08-26 §5b 的 primitive obsession 在 TS 侧原样复现。
6. **时钟未注入 / 真实时钟测试**(EA-18、ucm-L5、ucm-L10、web-M11 的三处 sleep、T-13;P1 层 T-21)。`RunSweeper` 是 edge tier 唯一直接 `Date.now()` 的类,测试只能断言一个区间;users 四个 action 三种时间表示,`delete-saved-route.ts:52,73` 直接 `Date.now()`,测试只能 `typeof duration_ms === "number"`;`.github/scripts/check-*.test.sh` 46 个用例写固定 `/tmp` 路径。规则「mock the clock」在 §8.2 的表里是「none」——没有任何机器守它。
7. **DSN 解析 ×4 与 DB 接入缝**(ucm-L7;挡在 EG-07 前面)。`typeof url === "string" ? url : await url.get()` 在 users/migrator/catalog/edge 各写一份,一 DSN 一 client 的 `Map` + `closeDbPools` 写两份;EG-07 要把 `readStoreOrString` 从 `container-env.ts` 搬出来——搬去哪要先答这一条(ADR-0003 已把 Secrets-Store DSN 形状当平台契约,`packages/contract/db` 或 `packages/neon` 是候选)。
8. **无超时、静默的旁路 IO**(EG-16、EG-21;P1 层 F9)。edge 两个代理的缓存写一处未处理 rejection、一处 `.catch(() => undefined)`——与 08-26 §2.4 catalog 的那对完全同形;`/` 与 `/healthz` 的容器 fetch 没有 `/v1` 那个头超时,guard DO 的 `fetchDecision`/`callBudget` 无 deadline(08-26 §3 仍开),CD smoke 用 `--max-time 15` 探 `/healthz`,容器挂住时 Worker 请求在 smoke 放弃后还在跑。
9. **行数预算与 helper 命名**(ucm-L1、ucm-L2、F26、ARCH-18;供 §6 Q2 决策)。四个 `*.helpers.ts` 测试模块与 `atlas_helper.py`、`geo_utils.py`、`e2e/helpers/`、`agents/utils/`;`agent-contract.ts` 316 行装五个不相干的边界、`emit-agent-python.ts` 334 行;catalog 自己的 `enumerate-1050.ts` 数出 70 个 `src` 函数超 10 行,多数是跨行的单条 Drizzle 语句——行数与内聚在这里分道,`naming-ownership.md` 说内聚赢;该脚本没接任何门。
10. **声明未接线的 P2 实例**(EA-09、F15、F19、F27、ucm-L4;删除清单素材)。edge `RunFailureReason` 六个值三个不可能产生(`lease_expired` 无人写、`TurnAborted` 无人 throw 所以 `cancelled` 不可达)、两个导出无人 import;catalog `db/expressions.ts` 一半死而 `cron-queries.ts:94,106` 重新内联同一片段、`operational-config.ts:44-54` 四个常量无消费者却被 `schedule-guard.worker.test.ts:111-116` 钉着、`geocodeObservability` 从未被调、`lib/transit/**` 11 模块 + 10 个测试文件为一条生产永不走的分支(`plan-itinerary.ts:84-87` 从不注入 `transit`);users `DbExecutor`、`HYPERDRIVE`(无 `[[hyperdrive]]`)、`saved_route_anime`(§4)。
11. **monorepo 卫生,挡在 ARCH-02 前面**(ARCH-16;与 ucm-M4、T-19 同根)。九份近同 `tsconfig.json` 无根 base;`workers/edge` 与 `packages/eval` 不声明 `typescript`/`@types/node`,靠 `.npmrc` `shamefully-hoist=true` 编译;根 `lint:oxlint` 过滤表漏 edge 与 contract;`e2e` import web/contract 源码却不声明依赖;`Makefile:110` 的 `check` 只跑 Python 而 `AGENTS.md:31` 把它当全仓命令;infra 两个包 TS ^5。给 edge 加 `tsc` 门之前先给它一个 `typescript` devDependency。
12. **`Env` 类型与配置解析**(EA-06、EG-15)。DO 构造函数丢掉已存在的 `Env` 类型收 `Record<string, unknown>`,六个读者六种校验写法;gateway 侧 `env.ts:50` 的索引签名让未知 flag 不报错、`TURNSTILE_SECRET: string` 对一个可缺席的密钥,四种回退约定(静默回退、fail-closed 带 warn、「其它都算 container」、throw),≥14 个测试文件 `as never` 造 env。设计文档 §5「I: 可收窄参数类型」做了一半。
13. **e2e 的假客户端导航依赖 web-H2**(web-L8)。`client-navigation.ts:7` 写 TanStack 私有的 `__TSR_index`;`<Link>` 落地即删;同文件还有 `Math.min(8, 8)`、CSS 选择器代替 role、三个 spec import app 源码、与 `apps/web/tests/msw/chat-stream-base.ts:48-54` 重复的帧补丁;全部 spec 只跑 `ja-JP`(E2E-08,08-26 §4 项 5 仍开)。
14. **手搓密码学原语**(F29;P1 层 EG-10、ucm-M8)。`lib/timing.ts:8-13` 字符码 XOR 的 constant-time compare(Workers 有 `crypto.subtle.timingSafeEqual`,兼容日期下可用性待验),加 edge 的两份 `hmacHex` 与 users 的手写 UUIDv7——三个包各自写了一个平台或官方库已提供的原语;`spike-db.ts:139-143` 那个包着 `describe.skip` 的 `databaseDescribeKnownFailing` 无调用方,是现成的静默工具,与「不经批准不 skip」相悖。

---

## 4. 08-26 旧账台账

来源:ARCH-19 的仍开/部分清单 + 其余六份报告里每一处「still open since 08-26」标记,去重后 39 行(末三行是 08-26 的 P0 里已修的,留着让台账对得上 08-26 的 §1–§2)。「谁的卡」用 §7 的战役代号:A = W4 前置、B = 随 CI/CD 重设计、C = 随 Drizzle spec、D = 独立、E = 等 §6 拍板、W4 = 随 #1317 删 `apps/agent` 消亡(不开卡)、— = 已关。两份报告对同一项判定不同的,两种读法都写,注明本文取哪一种及依据。

| # | 项 | 08-26 §ref | 现状 | 谁的卡 |
|---|---|---|---|---|
| 1 | 所有流量打同一个 DO `"default"`,`max_instances = 3` 是死配置 | §2.1 | 仍开(EG-13、ARCH-19):`forward.ts:68`、`request.ts:170,175`、`wrangler.toml:180,326,536` | W4;之前只做 EG-13 的修正(D) |
| 2 | 容器 fetch 无超时 / `sleepAfter` 缺省 / 冷启动重试只给 `/healthz` | §2.1 | 已修:#1220 头超时、`entry.ts:61` `sleepAfter = "10m"`、#1239 55 s;残余:`/` 与 `/healthz` 的容器 fetch 仍无头超时(EG-21) | D(EG-21) |
| 3 | rate-limiter / cost-breaker 的 DO fetch 无超时 | §3 | 仍开(EG-21):`rate-limiter.ts:163-172`、`cost-breaker.ts:75-81` | D |
| 4 | catalog 冷启动自愈只在 2/7 读端点 | §2.4 | 两读法:ARCH-19 列仍开;catalog §4 判为按决定(#1229 Option C 之后「请求路径不按需长目录」,`docs/ARCHITECTURE.md` Catalog Ownership)。本文取 catalog 读法——它读了全部 `src/`;现状 = 已决,`ARCHITECTURE.md` 该处已有依据 | —(D 里顺手把 §2.4 的表述改掉) |
| 5 | prod 首次 `pulumi up` 的角色 adopt 只在 runbook | §2.6 | 仍开(T-18),脚本还带维护者家目录路径与 `pulumi import --yes` 前的静默 `staging` 默认 | B |
| 6 | users OpenAPI 声明 `bearerAuth`,worker 拒 `Authorization` | §3 | 两读法:ARCH-19 仍开;ucm §4 改判合理(`info.description` 写明「consumed by apps/web」,客户端经 edge 用 bearer 到达;内部协议在 `internal-binding.ts` 另有类型与 `rolling-compat.test.ts` 钉)。本文取 ucm 读法;一句「as reached through the edge」进 emitted `info.description` 即闭 | D(一行) |
| 7 | Python `Point` 镜像把契约必填字段降成 `""` 默认 | §3 | 仍开(`catalog_client.py:80-81`);TS 侧同型:ucm-L8 `title` NULL → `""`,`row-validation.worker.test.ts:48-55` 钉了这个强转 | W4;ucm-L8 → C |
| 8 | `agent-warmup.ts:7` 硬编码 `/healthz`,agentUrl 异域即失效 | §3 | 仍开(web-L3) | D |
| 9 | `importProtection` 只点名 `@neondatabase/auth`,maplibre 靠一处函数内 `await import()` 硬扛 | §3 | 仍开(web-L4) | D |
| 10 | `byok_requires_login` 三处硬编码日语,错误文案表无 locale 口 | §3 | 仍开(`error_messages.py:47`、`byok.py:88`);edge 的 `agent-turn-responses.ts:35-44`、`chat-envelope.ts:32-56`、`responses.ts:52`、`cost-breaker.ts:19-20` 四处 ja/zh/en 字面量是 FALLBACK 旗标下的 Python wire 镜像,W4 后归 edge | W4;之后 edge i18n 卡(E) |
| 11 | `npx --yes neonctl@3.6.0` 无完整性校验 | §3 | 仍开且扩到 3 处,另 `make e2e`、`visual-check.sh` 裸 `npx`(T-17) | B(五行改动,也可 D) |
| 12 | `stepQuote` 无 `E'…'` 反斜杠转义处理 | §3 | 仍开(ucm-L12),潜伏 | D |
| 13 | `GRANT ALL` 收窄 / 4 个概念 FK / readonly 漏 9/11 agent 表 | §3 | 两读法:ARCH-19 把 readonly 列仍开 `[sub]`;ucm §4 说链头已决。本文开 `migrations/neon/20260826000004_agent.sql:1-10` 核对:头注写明 readonly 只授 `turn_outbox_events`、`turn_reservations`,其余 9 表含 PII 需逐表评审,并引 08-26 §3;`GRANT ALL` 全链 0 | — |
| 14 | 变异测试无工具,全靠人 | §4 项 6 | 仍开;本轮 web-H1、F8、ucm-M9 三处都是「删掉实现测试不红」 | E(工具化评估,§6 Q11) |
| 15 | Neon Auth JWKS 明文 var,Secrets Store 半迁移 | §5.2 | 仍开(`edge/wrangler.toml:471`,Secrets Store 路径 config-gated off);JWKS/issuer 派生三份(T-22) | B(与 T-06 密钥清单同批) |
| 16 | `PROD_SNAPSHOT` 注释,staging DAILY_IMPORT 自导自入 | §2.4 | 仍开,按决定(wrangler 10143,生产 catalog 未部署;`wrangler-private.worker.test.ts:100-123` 钉);daily 两个 job 的完成行仍是 `attempted=0 ingested=0 skipped=0`(F28) | E(随生产 catalog 部署;F28 → D) |
| 17 | `CATALOG_ADMIN_TOKEN` 从未 provision | §2.4 | 已修(ARCH-19) | — |
| 18 | 快照激活失败吞真实异常、误报 | §2.4 | 部分:#1219 加了 `console.error`,返回的 reason 仍是常量(F7) | D |
| 19 | `search.ts:103-106` 裸 `waitUntil`、`work-points.ts:68` 吞错 | §2.4 | 部分:`work-points` 改成 durable pending;`search.ts` 仍在 `waitUntil` 下跑全量 ingest(F2) | E(F2 退役决定) |
| 20 | migrator 生产并发锁只有字符串守 | §2.5 | 机制已是真 `blockConcurrencyWhile`(`apply-lock.ts:14-18`),测试仍只测 `QueueLock`(ucm-M1);ARCH-19 判 PARTIAL、ucm 判仍开——事实一致,只是标签 | C(C2) |
| 21 | catalog 假 DB 无 `.batch()` 且永不报错 | §2.5 | 已修(fake `.batch()` + 错误注入,catalog §1);残余是语句盲(F8) | D(F8) |
| 22 | users `reclaim()` 永真式 / 内存 fake 无唯一约束 | §2.3、§5.3 | 永真式已修(#1222,`neon-idempotency-store.ts:96-103` `setWhere`);fake 的 `Promise.all` 事务与原子性盲区仍开(ucm-M9) | C |
| 23 | 测试 `monkeypatch` `Agent.run` 5 处 | §2.5 | 部分(5→2) | W4 |
| 24 | `saved_route_anime` 零引用 | §5.2 | 仍开:本文核对 `catalog/src/db/schema.ts:199` 映射仍在,`workers/users` 零引用,`…005_users.sql:60-61` grant 只给 `users_svc`/`readonly`——`catalog_svc` 无 grant,任何 catalog 查询会 permission denied;ARCH-19 的 PARTIAL 与 F25/ucm-L4 的 open 是同一状态的两个标签 | C(删映射,或 users 接管并给它一个写者) |
| 25 | CI YAML 五个 promote 块字节级相同 ×5 × 两文件 | §5b | 部分:一文件五份 + 生产手展一份(T-05) | B |
| 26 | 阶段列表 `foundation…web` 硬编码 ≥4 处 | §5b | 仍开(T-25);`cd-cohort-plan.py:13-19` 应是唯一一份 | B |
| 27 | `public_api.py` 1,136 行、`feedback.py` 334、`_on` 孪生、13→14 文件 >300、PLR0913 42→82、Python 测试文件 >200 行 25→29 | §5b、§4 项 3 | 仍开且两项回归 | W4(不投入) |
| 28 | `agents/handlers/_helpers.py` 整文件违反 naming-ownership | §5b | 已修(拆成 `handlers/{image_url_rewrite,nearby_groups}.py`) | — |
| 29 | `test-inventory.test.ts` 文件数自指门禁 | §4 项 1 | 已修(文件已删) | — |
| 30 | 失败路径无信号 | §5.1 | 部分:catalog 后台 ingest catch、cron 汇总、edge `observeEntry` 已加;新层 edge agent loop 零日志(EA-05)、gateway 无 `onError`(EG-06)、web 恢复失败无状态(web-M9)、cron 非成功全压成 `skipped`(F28) | A(EA-05);D(EG-06、web-M9、F28) |
| 31 | 陈旧注释/文档,「改代码必改其自述」进 DoD | §5.4 | 仍开,七份报告各有采样(§3 第 1 条;§2 的 EG-12、ucm-M7、web-M6、ARCH-01/07/10/15/17);DoD 那句没有进任何卡片模板 | 横切(§5 第 2 条) |
| 32 | 75 个源码文本匹配测试轻审 | §4 项 4 | 未做,新增(§3 第 2 条;EG-14、web-M11、T-12) | B(迁移)+ 各包触碰时 |
| 33 | 多语言 E2E(E2E-08)/ SSE 断线重连 / API 层用例 | §4 项 5 | E2E-08 仍开(web-L8,全部 spec 只跑 `ja-JP`);API 层现有 edge `api-test/`,其中 `agent-turn.test.ts:118` 与 `catalog-api.test.ts:43-49` 两处断言空转(EG-25) | D |
| 34 | 测试碎片:session 19 文件、票号命名 12 文件 | §4 项 2 | Python 侧随 W4;TS 侧票号命名新增 16 个(`rate-limit-ac6`、`migrator-ac3-proof`、`spec-w0-verdict-contract`、`w2-parity-checklist-contract`、`pi-spike-*` ×12,EG-14) | B(迁移)/ 触碰时改名 |
| 35 | Review Gate 状态发布 TOCTOU + 4 个死子命令 | §3 | 已退役(08-31 Review Gate 整体退役);残余 `why-blocked` 家族 ≈560 行无调用方、自述仍指 `pr-review-check.sh`(T-10a) | B |
| 36 | staging 重置触发面 / Neon branch-per-PR / 自动 smoke | §6 Q2–Q3、§7 W4 | 重置 fail-open 已修(`reset-staging-baseline.sh:40-51` `query_bool`);smoke 仍 park(#1198);branch-per-PR 无记录;#1325(CD 并发按环境限定)已立 | CI/CD 重设计的输入 |
| 37 | chat 选系列 → 409 → 谎报「连接断开了」(修复包 A/B/C) | §1 | 已修(#1220):ARCH-19 手核 `error-classifier.ts:105` 有 409 分支、`ClarifyCard.tsx:12,44` 发 candidate id;web §5 末尾确认 A/B/C 与 `title_cn` 渲染都落地。同一次修复引入了 web-H1 | —(web-H1 → D1) |
| 38 | SSE 无心跳 / 缺代理头 / `CancelledError` 零日志、预约悬空 300 s | §2.1 | 归入 #1220 修复簇(ARCH-19 的判定,本文未逐项核);Python 侧随 W4 消亡,edge 档的对应物是 EA-05/EA-19 | W4;A5 |
| 39 | CD 阶段链吃掉 skipped;infra 重置 fail-open | §2.2、§2.6 | 已修:`test_cd_skip_propagation_contract.rb`(ARCH-19);`reset-staging-baseline.sh:40-51` `query_bool`(tooling §4) | — |

---

## 5. 系统病(横切)

七份报告各给了三条系统性模式,21 条里重叠很重,并成六个根因。每条列跨报告的证据 id、为什么反复出现、以及能消掉这一类的那一个结构改动。08-26 §5 的四条(失败路径无信号、声明但未接线、假替身、陈旧注释)全部还在,其中两条在 08-26 之后才写的 edge agent tier 里原样复现。

### 5.1 声明但未接线——这一代的新形态是「按模块移植,不按流程核对」

- 证据:EG-01(X4 上限的 latch 等一个不会来的容器判决)、EA-03(`origin` 参数存在、从未供给)、EA-12(locale 为 selection 接了、text turn 硬编码 `ja`)、EA-09(三个失败原因无人写)、F3(版本指针无人读)、F4(运行时预算无人计费)、F19(四个常量、一个 observer 无消费者)、F17(`IngestLifecycle` 无实现者)、F27(transit kernel 无注入)、F16(`db` 依赖无人用、调用方造毒对象)、ucm-L4(`HYPERDRIVE`、`DbExecutor`)、ucm-M11(`CONTAINER_TIMEOUT_MS`)、ucm-M13(过期索引无 reaper)、ucm-H2(路由无调用方)、web-M10(`challenged:false`)、web-M2(`featureFlags` 无读者)、web-H2(`defaultPreload` 无 `<Link>`)、ARCH-08(8 个转发键无字段、3 个字段无转发键)、ARCH-11(旗标矩阵七项从未翻转)、T-10a(≈900 行无调用方脚本)、T-03(死的 OIDC 铸币器)。
- 为什么反复:每个缝都是设计文档点名要的,卡片按「文件对着 Python/设计逐个移植」验收,而生产接线传 `0`、`undefined`、空 Map、毒对象,或者干脆没传;对等清单核对的是行为条目(82 行),不是请求从浏览器到数据库要经过的每一个控制点(EG §5 第 1 条),所以一个 gateway 控制、一条路径形状规则、九条路由的服务端都落在两张清单之间。退役也是同一件事的反向:战役收工留下脚本、注释和旗标,可达性没有任何检查(T §5 第 3 条)。
- 消类的改动:声明面在同一个 PR 里点名消费者,否则不落地(08-26 §5.2 提的 DoD,这次七份报告都又提了一遍);机器侧两件——scripts 自测加可达性检查(每个 `scripts/**` 与 `.github/scripts/**` 文件必须被 Makefile/hook/workflow/action/`docs/ops/` 引用),以及 W2/W4 的清单改成「每条 `AGENT_PATHS` 一行、每个身份类控制一行,写明两个旗标位各由谁执行」;并把 spec §二「eval 只对真实环境测」里的三条用户旅程(GPS 附近、消歧后选点、BYOK 翻译)提前到 W2 做 api-lane。

### 5.2 自述跑在运行时前面,评审席读的先是头注

- 证据:ARCH-01/07/10/15/17(规范文档指向被否决的方案、布局表漏三个包、四条 rules 描述不存在的文件、文档门只查 `docs/` 前缀、九条包级事实过期)、EG-12(`must stay at worker root` 对着已完成的 #853,「Enforced by the container ingress」紧邻 `AGENT_TURN_ROUTE = "edge"`)、EA-15(七句描述不存在运行时的注释,EA-17 的测试就是照着写的)、F23(八个文件引用两条链之前的迁移)、ucm-M7(README 三处说反)、web-M6(注释与 lint 配置、lockfile、AGENTS.md、e2e 清单四方矛盾)、T-23(六处路径指向不存在的文件)、EG-03(「zod stays out of the bundle」而实测 79 个输入)。
- 为什么反复:1,443 行 AGENTS.md、五份 CONTEXT.md、`ARCHITECTURE.md`、九条 rules、60 份 spec 里的主张没有任何机器检查,仅有的两个门只查路径是否存在(ARCH §6 第 1 条);每次架构转向(Supabase → Neon、AUTH-2、migrator、这次的 agent 重写)把「更新规范文档」排在最后一波,于是仓库自己的真源里同时站着两套架构。edge agent tier 约三分之一是决策散文,头注写的是卡片的论证,从没对着平台的真实保证再读一遍——测试跟着散文写,评审跟着头注判,`feedback_stale_comments_fool_reviewers` 记的正是这种双席同向出错。
- 消类的改动:一条,分两半。文档半——`docs/ARCHITECTURE.md` 与根 `AGENTS.md`/`CONTEXT-MAP.md` 随 W1 的第一张卡一起改,不等 W4;`check-docs-paths.sh` 扩到全部包前缀,`check-agents-refs.sh` 校验 `paths:` glob 非空。代码半——头注里每一句关于平台的主张(「一个 id 一个实例」「alarm 会重投」「input gate」)要么有钉测试要么引官方文档行,评审清单对超过十行的头注逐句当断言核(EA §5 第 1 条、EG §5 第 2 条);「改代码必改其自述」这句 08-26 的 DoD 写进卡片模板,不再只是审计报告里的一句话。

### 5.3 一致性测试代替单一来源

- 证据:T-06(密钥集九处 + 三个契约测试保持一致)、T-09(镜像 tag 七处、runtime-config 两处 + 专职 checker、Atlas 版本四处)、T-05(promote 循环十块)、T-08(十四个 YAML 加载器)、T-07(本地/CI 两个路由器两种真源)、T-16(两个 manifest 模型)、ARCH-12(五个错误注册表、locale 表七处)、ucm-M3/M5(users 镜像无守、一包三套注册机制)、EA-10/EA-11(`Pacing` 重声明、两个 `TranscriptRow`)、EG-10(HMAC、bearer、path pattern 各两份)、F14(Point 映射五份)、T-22(JWKS 派生三份)、ARCH-13(三份 Postgres fixture)、web-L7(三种字典形状)。
- 为什么反复:每份复制都配了一个「保持一致」的测试,测试写得好、还做过变异探针,于是复制的痛感被测试套吸收,派生从来没被逼出来(T §5 第 1 条);镜像规则从 catalog 传到 users 时只带了规则没带守卫(ucm §5 第 2 条);contract 对每个 wire 消费者都有 vet 门,对自己的元数据一个门也没有(ucm §5 第 3 条)。
- 消类的改动:对每个被守的字面量,用它派生自的那一个文件替换那个测试——`.github/ci/toolchain.json`(镜像 tag、atlas/actionlint/semgrep/uv 版本、eval model)、`.github/ci/edge-secrets.json`、`workflow_yaml.rb`、`change-plan.py --format names` 给 pre-push、contract 导出 `CHAT_LOCALES`/`USER_TYPES` 与 `pnpm catalog:`。已经存在的守卫往兄弟包搬(edge 的 `migration-schema.ts` 给 users,catalog 的 parity 测试给 users),不再各写一份。

### 5.4 按行数切,不按归属切

- 证据:web-M5(hook 塔 + 6–7 位置参数的 assembly function,两个近重复 racer)、web-L5/L6(hooks import 组件文件、一条读旅程两份实现)、T-11(`_part_1..5` + 死 magic comment、14 行单测试文件、「Cases 9-15」)、T-10(325 行编排器头注自称 1-10-50 合规)、T-12(子串数量与文本顺序当断言——行数预算下最便宜的断言)、EA-14(`Parts` 包是 service locator,一个对象三个名字)、ucm-L6(8 参数团 + 两个不一致的分类器)、F26(70 个 `src` 函数超 10 行,多数是单条 Drizzle 语句)、ARCH-14/18(Python 侧 40–100% 违反率;21 个 helper/util 文件名)、08-26 §5b 的数据团在 TS 侧以对象形式重现(EA-14)。
- 为什么反复:`naming-ownership.md` 已经写了「SOLID 优先于 1-10-50,按职责拆不按行数拆」,但 lint 只会数行,评审跟着 lint 走;10/50/300/200 四个数字里只有 TS 的函数/深度/复杂度三项被机器守着,守着的那一侧干净、其它全靠荣誉(ARCH §6 第 3 条);于是达标的办法是切,切出来的段没有归属就叫 helper、叫 `_part_3`、叫 `chatBody(a, b, c, d, e, f)`。
- 消类的改动:§6 Q2 逐条定「两种语言都 lint,或从 `AGENTS.md` 删」,W4 之后只剩 TS,决定成本很低;保留的规则里给语句构建器与表驱动测试一个显式豁免(F26 的建议),剩下的违规按「是否多职责」审,不按行数审;`enumerate-1050.ts` 已经能数,接进 quality lane 或删掉。

### 5.5 失败路径二等公民

- 证据:EA-05(loop 零日志)、EA-04(提交后 wake-up 失败答 5xx)、EA-19(throw 跳过 `finish`,SSE 无终止帧)、EA-01(abandoned 无 `finish` 帧)、EA-13(网络错误文本进模型上下文)、EG-06(无 `onError`,失败的请求恰好没日志,测试钉文本 500)、EG-16(缓存写静默)、EG-21(guard DO 无 deadline)、F6(恢复时账本被覆盖)、F7(reason 算完即丢、staging 失败报成校验失败)、F28(cron 非成功全压成 `skipped`)、F24(claim 被偷,输家的结果无声消失)、F9(上游 fetch 无超时)、web-M9(恢复失败无状态、转录压平、三处 `.catch(() => undefined)`)、ucm-H1(成功但未记账这一形状没人设计)、T-01/T-02(两道门在异常分支 fail-open)。
- 为什么反复:设计过的失败(fail-closed limiter、头超时、resolve-before-abort、`refusalFor`)都有类型、替身、数据库 arm 和测试,做得好;没设计过的失败落进 Hono 的文本 500、`.catch(() => undefined)`、`skipped`、`invalid()`、一个 warning(EG §5 第 3 条、EA §5 第 3 条)。happy path 有 port、有 double、有 DB arm;failure path 有一句注释。08-26 §5.1 写在前,edge agent tier 写在后,病一样。
- 消类的改动:每个终态决策一条结构化事件(run_id、phase、reason、scrub 后 cause),每条失败分支在成功分支拥有的同样三条 lane(单测、DB arm、api-lane)里各一个用例,并把「客户端看到什么」算进分支——202 accepted-run body、`D19 recovery-failed`、`stagingFailed` 这些形状多数已经存在,缺的是接上;两道 fail-open 的门改成「缺失→警告,损坏/其它错误→失败」。

### 5.6 守卫放在顺手的地方,守的是文本和形状

- 证据:ARCH-09(五个 Python 单测守 TS 配置与文档,随 W4 一起删)、ARCH-05(contract 测试 import edge 源码,只在 contract 变时跑)、EG-14(edge node:test 守 GitHub workflow 与四个包的 `package.json`)、ARCH-11(缺席测试 `File.read` 它要保证不存在的文件)、T-14(缺席测试在空目录也绿)、ARCH-03/F1(依赖方向在任何包都没有机器守卫,catalog 已三处倒置)、ucm §5 第 2 条(users 的 Drizzle 映射、错误镜像、原子批、id 生成器都缺兄弟包已有的守卫)、F8/F21/F22(fake 按调用顺序回行、钉渲染 SQL、spike 手抄 SQL 或 `.sort()` 再比——ORDER BY 删掉不红)、web-H1/L9/M1(为可测而塑形的生产代码、可选 prop 当 DI、覆盖率下限逼出死码的测试)、ucm-M9/M1(`Promise.all` 当事务、字符串断言当锁测试)。
- 为什么反复:守卫放在当时手边有 runner 的地方,而不是它保护的工件旁边,于是 lane 在错误的变更上触发、`components.json` 要靠 `test_triggers` 反向补丁(ARCH §6 第 2 条);测试证明形状不证明语义,替身在关键性质上撒谎(catalog §5 第 2 条),覆盖率数字让「有测试」和「能抓住」看起来一样;「变异测试是唯一绿灯证明」是评审规约,仍然没有任何工具(08-26 §4 项 6,§4 第 14 行)。
- 消类的改动:一条归属规则——守卫与它保护的工件同包,跨包不变量只放在 `scripts/local-gates/`(它已经是 quality lane);一条边界 lint(`no-restricted-imports` 每包一段);一次替身清理——DB adapter 对真 Postgres 跑(users 拿 catalog 已有的 Docker arm,ARCH-13 合成一份 fixture),fake 只留给纯逻辑;变异工具化评估从「待聊」变成一张卡(§6 Q11)。

---

## 6. 设计层决策题(owner 拍板)

每题一个建议;建议不是决定,§7 里 E 战役的卡等这里落字。

1. **edge agent tier 要不要 `domain/`,还是继续叫「gateway」**(ARCH-03、ARCH-07;EA §4 里 wire-shaped 类型进 domain 的争论)。建议:承认 edge 是一个 Worker 里的两个 bounded context。`workers/edge/src/agent/` 自带一份 `CONTEXT.md`,`CONTEXT-MAP.md:39-48` 的「Domain model presence」表给它一行;目录不动(intake/session/selection/memory/tools 已经是按用例分的层,EA §1 说 lint 级别是干净的,问题是文档禁止它存在),边界写成 `.oxlintrc.json` 的 `no-restricted-imports`:`src/agent/**` 不 import `src/gateway|identity|protect|proxy|container|staging-gate`,gateway 只经 `gateway/agent-turn.ts` 这一个组合根进 agent。
2. **哪几条护栏两种语言都 lint,哪几条从 `AGENTS.md` 删**(ARCH-14、ARCH-18、F26、T-11)。建议按 W4 之后只剩 TS 来定:保留且已机器守——函数 ≤10(web 已是 10,其余包从 `max-lines-per-function` 50 收到 10 需要一次清理,语句构建器与表驱动测试显式豁免)、`no-explicit-any`、`max-depth 2`、`complexity 10`;新加 lint——文件 ≤300(`max-lines`,TS 今天只 1 处越界)、测试文件 ≤200(`max-lines` 对 test glob,各包 ≤3 处越界);从机器规则里删、留作评审项——类 ≤50、≤5 mocks、mock the clock;Python 侧一律不投入。
3. **`cluster_version` 蓝绿:留还是删**(F3)。建议删。指针无读者,原子性今天来自 `db.batch`;「旧路线永不漂移」这个需求的主人是 users(saved route 是 users 的文档),要冻结就在 `saved_routes.payload` 存一份快照,比 catalog 侧按版本读便宜得多。删 `publishVersionStatements`、`gc.ts`、`snapshots.ts`,下一次迁移删 `cluster_version`/`itinerary_snapshots`,改写 ADR 决策一 #2 那条。
4. **`search`/`spots` 退役**(F2、§4 #19)。建议退役,一个 PR:contract 删两条 procedure、`router-surface.worker.test.ts` 改、edge `catalog-policy.ts:2,5` 删、`syncFallback` 与 `waitUntilFor` 删、七个测试文件删、08-29 spec 那句改。vet 门会把删 procedure 标 breaking——零调用方是走豁免的正当理由,T-01 里那个该被搬出来的豁免文件正好用在这里。
5. **migrator 容器路径的冻结到期日**(ucm-M11、08-26 §6.6)。建议到期日 = Drizzle spec 定稿日。spec 若换掉 Atlas,期权自动作废,删容器路径;spec 若保留 Atlas,在定稿前 staging 行权一次,通过则切默认并删手写路径,不通过则删容器路径。两条路都以删一条告终;今天两条都在维护,每次发布多构建一个没人启动的镜像。
6. **`/ledger-head` 删还是加门**(ucm-H2)。建议现在删;#1198 smoke 落地时,apply 成功后把 head 写进 KV 或 DO storage 的一个短 TTL 值,smoke 读那个值,读路径永不解 DSN。
7. **staging-gate OIDC exchange 删还是做完**(EG-04)。建议删:端点、`GatewayDeps.stagingGateExchange`、三个测试、`infra/src/staging.ts:93` 的 WAF 例外。#1054 已 CLOSED 而 park 没有记录;staging `workers_dev = true` 是 owner 08-27 的决定并有 smoke 这个消费者。私有 staging 若再需要,先评估 Cloudflare Access 再决定要不要手写一道门(意见,适配性未查证)。
8. **手动语言切换器留不留**(ARCH-12)。owner 的政策是「UI 跟浏览器语言、聊天跟输入语言」(ARCH-12 引的仓库外记录;记忆条目 `feedback_language_strategy`),`LanguageSelect.tsx:1-27` 是代码第二次做出相反决定。建议删组件与其测试,把政策写进 `apps/web/AGENTS.md`;owner 若改主意保留,把例外写在同一处。两个方向今天都没落字,这是它反复出现的原因。
9. **`packages/contract` 拆分**(ARCH-06、ucm-M6)。建议一张卡三件事,与 #1285 同批改 `exports`:(a) `openapi-*`/`operation-set` 移到 `packages/openapi-tooling`(或 `./tooling` 子路径,不进 barrel);(b) 加 `./users-contract`、`./errors`、`./error-registry`、`./auth`(`jwt.ts`/`oidc-github.ts`)子路径,barrel 不再 re-export 它们;(c) `package.json:6` 与 `CONTEXT.md` 改成 published language 的描述。验证器暂不另立包——消费者只有 edge 与 migrator,子路径够用。
10. **死子系统删除清单**(ARCH-11、web-M1/M2、F27、T-10a、T-03)。建议现在删、不等 W4:`workers/edge/spike/pi/`、`workers/edge/db-test/`、12 个 `pi-spike-*.test.ts`、`scripts/spike/*.sh`、`recovery/`(连 `check-root-allowlist.sh:45`)、根 `verify:dependabot`、`check-db-ownership-doc.sh`、`check-role-matrix-migration.sh`、`check-skeleton-w0-docs.sh`、`migration-head.sh`、`git-squash-daily.py`、`why-blocked` 家族、`request-github-oidc-token.sh`(T-03 二选一)、web 的 `features/shiori`(移分支)、bubble-map 四组件、`CatalogSearchResults` + `use-catalog-search`、`showcase.ts`、五个 test-only 导出。随 #1316:`workers/jobs/` + 三份迁移里的 `jobs_svc` + `test_retired_retention_absence.rb:6` 改门 + `migrator-ac3-proof.test.ts:27`。等 W4:`supabase/`(钉在 `test_phase1c_route_persistence.py`)、`spikes/codemode/`(先出 coverage source)。旗标矩阵七项在 `docs/ops/deployment.md` 记一次,各标「从未翻转」的原因。
11. **变异测试工具化**(08-26 §4 项 6,本轮 web-H1、F8、ucm-M9 三处「删掉实现测试不红」)。建议立一张评估卡,范围只限 §5.6 列的三类(DB adapter、fake、guard),TS 侧的候选是 Stryker(本文的建议,七份报告都没有评估过工具;对 vitest 与 node:test 的 runner 支持要实测),Python 侧不投入;评估结论决定它是进 quality lane 还是留作评审工具。
12. **生产翻 `AGENT_TURN_ROUTE = "edge"` 的门槛**(EA-01 的作者把它当阻断项;EG-01/EG-02 是 staging 今天的状态)。建议门槛写成清单而不是日期:A4(X4 上限)、A5(租约与失败路径)、A6(三处对等缺口)合并,EG-02 的决定表填完、对等清单每条 `AGENT_PATHS` 与每个身份类控制各一行标明执行者,#1303 双跑无回归;翻转本身是一张独立卡,不并进 #1317——删容器与切生产是两个可回滚点,合成一个就没有回滚。

---

## 7. 修复战役切分建议

在途约束:#1303(W3-5,662 用例 Python vs TS 双跑)、#1317(W4-4,删 `apps/agent` + uv CI arm + 容器构建 + edge 容器管线)、#1316(W4-3,jobs 壳)、#1326(edge 与 agent-db fixture 共享 readiness wait)、#1323(contract 变更路由进 agent pre-push lane)、#1325(CD 并发按环境限定)、#1285(zod 出 bundle,分支已有)、#1198(smoke);#1322 已关。owner 已排期的 CI/CD 重设计与 Drizzle spec 各接一个战役。下面的卡不与已立票重叠,相邻的写明。

### 7.1 战役 A — W4 前置(全部在 #1317 合并之前落地)

| 卡 | 关闭 | 量级 | 依赖 / 顺序 |
|---|---|---|---|
| A1 守卫迁移:ARCH-09 的五个跨包守卫 → `scripts/local-gates/`;`entry-env.ts` → `test/doubles/gateway-env.ts`;`readStoreOrString` → `src/secrets-store.ts`;三项写进 #1317 checklist | ARCH-09、EG-11、EG-07、ucm-L7(归属决定) | M | 无;必须早于 #1317 |
| A2 路由清单与控制清单:EG-02 逐路由 port/retire/re-home 决定表 + 对等清单加行;`gateway/path.ts`;`catalog-policy.ts` 标「dies in W4」 | EG-02、EG-08、EG-26 | S(清单)+ 视决定的 port 量 | 决定表是 #1317 的输入 |
| A3 edge typecheck 最小门:`gate_edge` 加 `pnpm exec tsc --noEmit` + CI 镜像 + `test_ci_prepush_parity.rb`;edge 声明 `typescript`;删 `verify:dependabot` | ARCH-02(门那一半)、ARCH-16(部分) | S | 无;`components.json` lane 归 B2 |
| A4 X4 匿名日成本上限:定 owner(intake 或 settlement)并实现;`identityClass` 单一判定;对等清单一行;latch 与 `cost-breaker.ts:7-9` 自述改 | EG-01、EA-21/EG-24、EG-12(那一句) | M | staging 今天就缺这条控制;生产翻 `AGENT_TURN_ROUTE = "edge"` 的硬前置 |
| A5 租约与 loop 失败路径:EA-01 + EA-17 用例;提交后 wake-up 失败降级 202;`finally` 里 `finish`;终态结构化日志 | EA-01、EA-17、EA-04、EA-19、EA-05 | M | 生产翻 edge 的硬前置;EA-05 先做,其余三条的验证靠它 |
| A6 对等缺口三件:工具描述 + 标识符测试;`origin` 穿透 + api-lane;locale 写进 user 行 | EA-02、EA-03、EA-12 | S | 在 #1303 双跑之前,否则双跑对着两种 nearby 行为 |

### 7.2 战役 B — 随 CI/CD 重设计(owner 已排期;这些是重设计的输入)

| 卡 | 关闭 | 量级 | 依赖 / 顺序 |
|---|---|---|---|
| B1 单一来源三件:`toolchain.json`、`edge-secrets.json`、promote composite step | T-05、T-06、T-09、T-25(部分)、08-26 §5b | M | 与 #1325 同一批改 `cd.yml` |
| B2 路由器与 manifest:pre-push 调 `change-plan.py`;`workflow_yaml.rb`;manifest 模型合一;contract 测试触发;edge typecheck lane | T-07、T-08、T-16、ARCH-05、ARCH-02(lane 半) | M | 与 #1323 合成一张卡更省 |
| B3 Quality lane manifest 化 + 脚本可达性检查 + 孤儿删除 | T-10、T-10a、T-03 | M | 无 |
| B4 测试风格三件:解析 YAML 代替子串、`mktemp`、presence 锚 | T-12、T-13、T-14 | S | 无 |
| B5 类型与 lint 缺口:`.github/scripts` 进 mypy;contract `lint:oxlint`;infra 精确 pin + lint + TS 7;根 lint 过滤表补齐 | T-15、ucm-M4、T-19、ARCH-16(lint 半) | S | 无 |
| B6 文档门扩展 + rules 修正 | ARCH-15、ARCH-10、T-23(`check-docs-paths.sh` 扩展那一半) | S | 无 |
| B7 密钥与安全卫生:`neonctl` 进 lockfile、adopt 脚本处置、JWKS 派生进 contract、Secrets Store 半迁移收尾 | T-17、T-18、T-22、§4 #15 | S–M | T-22 等 Q9 的 `./auth` 子路径 |
| B8 infra 结构:`stackProfile`、`buildInfra()` 导出、并行数组 | T-20、T-21、T-29 | S | 无 |
| B9 跨仓文本守卫的统一目录 + 票号文件改名 | EG-14、EA-16、web-M11(`readFileSync` 半)、ucm-L10、§4 #32/#34 | S–M | 与 B3 同一个目录决定 |

### 7.3 战役 C — 随 Drizzle spec(同批评审,避免两次改 schema)

| 卡 | 关闭 | 量级 | 依赖 / 顺序 |
|---|---|---|---|
| C1 schema↔链对等:users `schema-parity`(复用 edge reader);catalog 每表 `LIMIT 0` spike;删 `savedRouteAnime` 映射或 users 接管;空测试文件让 `make lint` 红 | ucm-M2、F25、ARCH-04(TS 半)、§4 #24 | S | 无 |
| C2 一份 Postgres fixture:`packages/test-postgres`;users 拿 Docker arm,fake 只留纯 action;migrator 锁在 DO 缝测 | ARCH-13、ucm-M9、ucm-M1 | M | #1326 先合 |
| C3 数据面小件:幂等 reaper、list 分页 + 索引、`JobStatus` + CHECK、`title` 二选一、共享 DSN 缝 | ucm-M13、ucm-M12、F13、ucm-L8、ucm-L7 | S–M | ucm-L7 与 A1 共用归属决定 |

### 7.4 战役 D — 独立(不等任何在途工作)

| 卡 | 关闭 | 量级 |
|---|---|---|
| D1 照片 pick 通道 + 生产 provider 栈测试 + 变异验收 | web-H1、web-M9(`photo-search.ts:161`) | S |
| D2 `<Link>` + session 进 URL + 删 e2e 假导航 | web-H2、web-L8 | M |
| D3 migrator 事务合并 + 幂等感知 | ucm-H1 | S |
| D4 删 `/ledger-head`(Q6 建议) | ucm-H2 | S |
| D5 catalog 边界测试 + 三处倒置回正 + reader port 归 `application/` | F1、ARCH-03(catalog 半) | S |
| D6 两道 fail-open 门 | T-01、T-02 | S |
| D7 `ARCHITECTURE.md` D7 段 + DOCS_POLICY 表 + 根 `AGENTS.md`/`CONTEXT-MAP.md` edge 行 + users 行 + 布局表 | ARCH-01、ARCH-07、EG-12(文档半)、§4 #4/#6 | S,今天 |
| D8 gateway 失败路径:`onError` + `gatewayRejection` + `x-turn-id` 上限 + 代理缓存写日志 + guard DO deadline + 两个 landing forward 走 `fetchContainerResilient` | EG-05、EG-06、EG-09、EG-16、EG-21 | M |
| D9 catalog 失败路径与性能:reason 返回、账本合并、cron 按 status 汇总、上游超时、批量 provenance、运行时预算 | F4、F5、F6、F7、F9、F28 | M |
| D10 catalog 测试语义:乱序种子、`fakeCatalogDb`、删 `postgis.spike`、删 `/sql` 直通、参数断言代替渲染 SQL | F8、F21、F22 | M |
| D11 web 状态与 React 实践:auth 进 Query、effect 重置、hook 塔、a11y、`challenged` 二选一 | web-M3、M4、M5、M10、M12 | M |
| D12 web 注释与设计系统对齐 | web-M6、M7、M8 | S–M |
| D13 contract/users 小件:注册机制合一、users 错误镜像对等、三信封合一、README | ucm-M3、M5、M10、M7、ARCH-12(错误码半) | S |
| D14 edge 重复原语与 `Env`:signed-cookie/bearer/path-template;`Env` 收窄;`classifyRatePolicy` 表驱动;coarse wall 一份 | EG-10、EA-06、EG-15、EG-18、EG-20 | M |
| D15 落地 #1285 分支 | EG-03 | S |
| D16 08-26 遗留小件与注释清扫 | §4 #8/#9/#12、ucm-L12、EG-13、F23、T-23(六处字符串)、EA-15、EA-07/08/09 | S |

### 7.5 战役 E — 等 §6 拍板

| 卡 | 决策题 | 关闭 | 量级 |
|---|---|---|---|
| E1 `cluster_version` 删除 | Q3 | F3 | S |
| E2 `search`/`spots` 退役 | Q4 | F2、§4 #19 | S |
| E3 migrator 容器路径 | Q5 | ucm-M11 | S(删)/ M(行权) |
| E4 staging gate 删除 | Q7 | EG-04 | S |
| E5 切换器 + locale 表单一来源 | Q8 | ARCH-12(locale 半)、EA-10 | S |
| E6 contract 拆分 | Q9 | ARCH-06、ucm-M6 | M |
| E7 死子系统删除(spike 树、脚本、web 死特性、`_dev` 门) | Q10 | ARCH-11、web-M1、web-M2、F27 | M |
| E8 护栏 lint-or-delete + 清理 | Q2 | ARCH-14、ARCH-18、F26、ucm-L1/L2、T-11 | S(决定)+ M(清理) |
| E9 变异工具化评估 | Q11 | §4 #14 | S |
| E10 edge agent tier `CONTEXT.md` + 边界 lint | Q1 | ARCH-03(edge 半)、ARCH-07(CONTEXT 半) | S |

### 7.6 随 W4 消亡,不开卡(写进 #1317 checklist,免得有人去修)

ARCH-14 的 Python 数字、ARCH-08 的 `CONTAINER_ENV_KEYS`、ARCH-04 的 Python 半、§4 #1/#7/#10/#23/#27、EG-13 的 `max_instances`、EG-26、ARCH-18 的 Python 侧、ARCH-11 的容器管线(`[[containers]]` ×3、`RuntimeContainer`、`src/container/*`、`apps/agent/Dockerfile`、`build-release-unit` 的容器构建、`Makefile` 的 35 个目标、`setup` 的 uv arm)。注意 `apps/agent/docker/test-postgres/Dockerfile` 不随 agent 删——catalog、edge、db 三条 lane 都在构建它(`pr-verification.yml:222-224`),C2 合成一份 fixture 之后再决定它的归属。

### 7.7 横切 DoD(每张卡都带,不单开卡)

- 改代码必改其自述:被改文件的头注、同目录 README/AGENTS.md、`docs/` 里引用它的句子,同一 PR 改(08-26 §5.4;§5.2 的七组采样都是这条没执行)。
- 声明面点名消费者:新增的 env 键、旗标、port、导出、路由、脚本,同一 PR 里给出调用方,给不出就删(08-26 §5.2;§5.1)。
- 变异验收:关闭 web-H1、F8、ucm-M9、EA-01 这类「删掉实现测试不红」的卡时,PR 描述写明删了哪一行、哪个测试红了。
- 失败分支同等 lane:新增或改动的失败分支在成功分支拥有的每条 lane 里各一个用例,并写明客户端看到什么(§5.5)。

顺序:A 全部 → #1317;A6 → #1303;B1/B2 与 #1325/#1323 同批;C2 等 #1326;D 可并行开,D7 今天;E 等 §6。

---

## 8. 附录

### 8.1 分报告计数与折算

| 报告 | 源报告分级 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|---|
| edge-agent.md | blocker 0 · major 5 · minor 17 | 0 | 5 | 17 | 22 |
| edge-gateway.md | blocker 1 · major 13 · minor 12 | 1 | 13 | 12 | 26 |
| catalog.md | P0 0 · P1 9 · P2 19 · P3 1 | 0 | 9 | 20 | 29 |
| users-contract-migrator.md | High 2 · Medium 13 · Low 14 | 2 | 13 | 14 | 29 |
| web.md | High 2 · Medium 12 · Low 10 | 2 | 12 | 10 | 24 |
| tooling.md | High 5 · Medium 17(含 T-10a)· Low 7 | 5 | 17 | 7 | 29 |
| architecture.md | P0 3 · P1 12 · P2 3(ARCH-19 是台账,不计) | 3 | 12 | 3 | 18 |
| **合计** | | **13** | **81** | **83** | **177** |

折算规则:blocker/High/P0 → P0;major/Medium/P1 → P1;minor/Low/P2/P3 → P2。§1 的十条与折算 P0 的差异见 §0。

### 8.2 护栏执行表(压缩自 ARCH §5;§2.7 ARCH-14 引用于此)

| 规则(`AGENTS.md`) | 机器守 | 抽样违规 |
|---|---|---|
| 函数 ≤10 行 | TS:web 10(`apps/web/.oxlintrc.json:19-22`),其余包 `max-lines-per-function` 50(根 `.oxlintrc.json:146`);Python 无(`pyproject.toml:92-101` 未选 PLR0915) | `public_api.py` 23/58、`agent_turn.py` 13/21(`_run` 113 行)、`animichi_runner.py` 7/31;TS 按 10 行临时跑七个样本:5 处/4 文件 |
| 类 ≤50 行 | 无 | `RuntimeAPI` 299、`_RuntimeTurnExecution` 154、`_RuntimeSessionGateway` 100、`_RuntimeTurnSettlement` 64、`AgentTurn` 560 |
| 文件 ≤300 行 | 无(无 `max-lines`;`quality.sh` 无长度检查) | Python 生产 14;TS 生产 1(`agent-contract.ts` 316) |
| ≤2 缩进 | TS `max-depth: 2`(根 `:145`);Python 无 | Python 按 oxlint 计法 0;按函数体算一层则 `public_api.py`、`agent_turn.py` 各 2–3 处 `[sub]` |
| 圈复杂度 | TS `complexity: 10`;Python `C901` 10 | 两侧都守着 |
| 无 `any` / `dict[str, object]` | TS `no-explicit-any`(contract、infra 不在 CI lint);Python mypy 无 `disallow_any_explicit`(`:176-196` override 是 no-op),`ANN401` 未选 | TS 0;Python `dict[str, object]` 111 处 |
| 无压制 | TS:catalog 专用 `check-no-inline-config.ts` + 根 `ban-ts-comment`(允许带说明的 `@ts-expect-error`);Python 无;CI 两个 Ruby 契约断言无 `continue-on-error` | 生产:`persistence.py:49` `type: ignore`、`fastapi_service.py:33` `noqa: F401`、`geo_names.py:20` `noqa: PLW0603`;测试:9 `type: ignore`、5 env-gated skip、`spike-db.ts:142` `describe.skip` helper、6 `@ts-expect-error`(类型测试)、4 e2e `test.skip` |
| 测试文件 ≤200 行 | 无 | Python 29/328(`test_entities.py` 591);edge 2/156;catalog 1/105;users 1/13(256);migrator 1/12;web 3/283;contract 1/19;e2e 2/18 |
| ≤5 mocks / mock the clock / 无条件逻辑 | 无 | 未测量;实例见 §3 第 6 条与 web-M11 |
| 覆盖率只升 | 下限:agent 87、web 98/95/98/99、catalog 94/95/92/78、users 60/60/60/50、migrator 85/75/85/60、Codecov patch 95;方向守卫只拒字面 `cov-fail-under=82`;edge/contract/eval/infra 无下限 | `codecov.yml:16` 仍写 80 |
| naming-ownership | 无(rule 无 `paths:`,无 lint) | 21 文件、3 目录、~13 函数(ARCH-18) |
| 依赖方向 / hexagonal | 无 | ARCH-03、F1 |
| TS 7.0.2 + oxlint `--deny-warnings` 每包 | web、catalog、users、migrator、e2e、eval 六包 lint 与 tsc 都有(eval 无本地 `typescript` 依赖);**edge 有 lint 无 tsc**;**contract 有 tsc 无 lint**(只在 pre-commit 对 staged 文件跑);**infra ×2 无 lint,TS ^5** | `gate_*` 见 `pre-push.sh:169-262`;根 `package.json:9` 过滤表 |
| 无本地部署 | hook `block-local-deploy` 不在仓库(`git ls-files .claude/hooks` 只有 `check-pr-comments.*`) | 其它贡献者靠荣誉;CD-only 离线不可验 |
| 无 Supabase-auth / 自验证 | 三个缺席测试(`eddsa-shared-primitive`、`test_retired_retention_absence.rb`、`test_neon_test_infra_absence.rb`) | 同一模式把 `workers/jobs/wrangler.toml` 钉在原地(ARCH-11) |

### 8.3 报告间矛盾与本文开过的源码

1. **`saved_route_anime`**:catalog F25「仍开」、ucm-L4「declared-but-unwired」、ARCH-19「PARTIAL」。开 `workers/catalog/src/db/schema.ts:195-205` 并全仓 grep(排除测试):映射只在 `schema.ts:199`,`workers/users` 零引用,`…005_users.sql:60-61` grant 只给 `users_svc`/`readonly`。三份说的是同一状态;本文按仍开记(§4 #24)。
2. **`ai` 版本**:web.md 说 lockfile 是 `ai@7.0.77`,brief 与 `reference_frontend_stack_versions` 记忆说 6.x。开 `apps/web/package.json:30`(`"ai": "^7.0.77"`)与 `pnpm-lock.yaml` 的 `apps/web` importer 块(specifier `^7.0.77`):web.md 对,brief 与记忆过期;web-M6 里「verified at 7.0.47」的三处注释按 7.0.77 复验。
3. **`agent-turn.ts` 匿名判定的行号**:EA-21 引 `:89-91`、`:105-108`;EG-24 引 `:128-130`、`:144-147`。`grep -n`:`isAnonymousIdentity` 在 `:89-90`、`payerFor` 在 `:105`。EA-21 对,EG-24 行号错、发现相同;§3 第 3 条按 EA-21 引。顺带核了 EG-09 的 `:171`/`:64` 与 EA-04 的 `:249`/`:259`,都对。
4. **agent 表的 readonly grant**:ARCH-19 列「仍开 `[sub]`」,ucm §4 说链头已决。开 `migrations/neon/20260826000004_agent.sql:1-10`:头注写明 readonly 只授 `turn_outbox_events`、`turn_reservations`,其余 9 表含 PII 需逐表评审,并引 08-26 §3。ucm 对;§4 #13 记为已关。
5. **users 与 e2e 的测试文件数**:根 `AGENTS.md` 说 users「21 tests」,ucm-M7 说 15 个文件,ARCH-07 说 13 个 `*.worker.test.ts`。`ls workers/users/test`:16 项,13 个 `*.worker.test.ts`,其余是 fake/fixture;本文写 13。e2e:web-M6 说 18 个 spec,ARCH §5 表说 21;`ls e2e/*.spec.ts` = 18,`*.test.ts` = 0;本文写 18。
6. **catalog 冷启动自愈范围**与 **users `bearerAuth`**:两份报告判定相反,本文取读了全部源码的那一份并写明理由(§4 #4、#6),没有再开文件。
7. **`gh issue view`**:取了 §7 引用的 13 张票的标题与状态。#1054、#1322 已 CLOSED,#1326 的内容是「edge 与 agent-db fixture 共享 postgres readiness wait」(ARCH-13 说仓库里找不到它,票在 GitHub 上,不在仓库文本里)。

### 8.4 P2 余项(一行一条,已在 §3 收录的不重复)

- **edge-agent**:EA-08 `isJsonRecord` 接受数组(`json-record.ts:7-9`,加 `!Array.isArray`);EA-11 两个 `TranscriptRow` 与两条排序不同的 transcript SELECT,TS 里再按 ISO 串排第三次(`turn-store.ts:68-73` vs `transcript-message.ts:25-32`;`neon-turn-store.ts:92-97` vs `neon-conversation-records.ts:77-85`);EA-13 `web_search` 把 `EgressDenyReason` 等基础设施文本递给模型,与 catalog tools 的 SD-19 相反(`web-search-tool.ts:60-63`);EA-14 `Parts` 包是 service locator,`envelope.session` 一个对象三个名字(`turn-attempt.ts:31-62`,`session-turn.ts:216-218`);EA-17 租约测试缺同 owner 过期用例(→ A5);EA-19 throw 跳过 `finish`,alarm 中 re-arm 依赖未钉的平台语义(`agent-session.ts:87-91,128-130`,→ A5);EA-20 每个 `POST /v1/chat` 两次打同一个 singleton DO(`turn-intake.ts:157`、`session-wakeup.ts:102`;有记录的决定,一个 cron trigger 可去掉两跳)。
- **edge-gateway**:EG-17 两种日志约定互斥,请求记录以 warn 级每请求两行(`forward.ts:122-124` vs `request.ts:93-112`);EG-18 `classifyRatePolicy` 22 行三层嵌套、三个同值常量三个名字、每请求编译正则、`serviceCredential*` 只有测试消费者(`rate-policy.ts:55-64,116-151`);EG-19 `parseDecision` 占位值,`as Partial<X>` 四处而 `isJsonRecord` 存在(`rate-limiter.ts:142-147`、`edge-guard.ts:34-39`、`cost-breaker.ts:31-35,80`、`session.ts:70-78`);EG-20 coarse wall 实现两份、guard DO 解析 body 两次(`burst-guard.ts:51-62`,`edge-guard.ts:47,106-109`);EG-22 每个读都开新 `Pool` 并包事务,transcript GET 多付两次往返(`agent-database.ts:46-62`);EG-23 `HandleGatewayRequest` PascalCase、`handOff`/`handleGuardRequest`(`request.ts:136`,`agent-turn.ts:179`);EG-25 api-lane 三处空转断言(`api-test/agent-turn.test.ts:118`、`catalog-api.test.ts:43-49`、`operation-reachability.test.ts:80`);EG-26 catalog 出站 allowlist 手工字面量(`catalog-policy.ts:1-9`,dies in W4)。
- **catalog**:F10 `serveImage` 对 `points.image` 里任何绝对 URL 开放抓取并缓存,无 host allowlist,非 404 失败不负缓存(`media/img.ts:80-112`,`parse.ts:206-211`);F11 L1 preview 缺坐标时伪造 `[0,0]`,与 `parse.ts:151-156` 丢弃的行为相反(`preview.ts:78-90`);F14 Point 行→wire 映射五份(设计 §3.5 的 to-do);F16 `SnapshotDeps.db` 无人用,两处造 `NO_DB` 毒对象(`snapshot.ts:20-23`,`api/snapshot.ts:23-25`,`snapshot-source.ts:61-63`);F17 一个 ingest 概念三个 port 形状 + 七个同名 lambda 直通(`ingest-bangumi.ts:76-93,220-238`,`jobs.ts:41-69`);F18 `src/lib/`、`src/api/` 两个无归属目录,`raw_history.ts` 蛇形名,`handleError`(设计 S2/S8 未执行);F20 `CronDependencies` 11 方法,六份 11-mock 工厂(`ingest-schedule.ts:58-72`);F22 spike 测试手抄 SQL、hedge、测 2026-06 的 spike 本身,`/sql` 直通已不存在的 Neon proxy(`catalog-api.spike:105-134`,`postgis.spike`,`daily-run.spike:73`,`spike-upstream-stubs.ts:11-19`);F24 claim 被偷无心跳,fenced UPDATE 影响 0 行无信号(`jobs.ts:23,77-88,153-178`);F28 cron 非成功全压成 `skipped`(→ D9)。
- **users · contract · migrator**:ucm-L6 8 参数团、两个分类器顺序不一致、`row === undefined → "conflict"`(`save-saved-route-idempotent.ts:80-86,105-106,128-137`);ucm-L8 `title` NULL → `""`(→ C3);ucm-L11 drift 门漏 `agent-openapi.json`(`contract-drift.sh:25-28`);ucm-L12 `E'…'` + `create-app.ts:137` 的化石动态 import(→ D16);ucm-L13 migrator `hono: ">=4.12.34"` 无上界、users `compatibility_date = "2025-09-23"`;ucm-L14 `.dev.vars.example:2-3` 指向已退役的 `test-base` 分支。
- **web**:web-L1 `__root.tsx:155` `dangerouslySetInnerHTML` 注入未转义 `<` 的 JSON(`json-ld.ts:26` 有现成转义);web-L2 `wrangler.jsonc:68` 提交的 Neon Auth 主机名与 SD-31 相悖(代码有注释,spec 未改);web-L5 hooks import 组件文件,状态归属门只查顶层(`session-headers.ts:1`、`use-recompute-turn.ts:2`、`use-clarify-pick.tsx:3`);web-L6 `$routeId.tsx:41` render 里 `new Date()`,`hooks.ts:25-30` 重写读旅程,`siteOrigin()` 吞掉 `api/config.ts:51` 的 fail-loud;web-L7 三种字典形状、手写 `{x}` 替换已被 `$&` 咬过一次(`SelectionTray.tsx:32`,`route-copy.ts:39-43`);web-L9 可选 prop 当测试缝(`ChatActions.tsx:10`、`TimedItinerary.tsx:16`、`RouteCard.tsx:14`、`ByokSettings.tsx:20`、`AuthCallback.tsx:69-71`);web-L10 `HistoryList.tsx:27` index key。
- **tooling**:T-24 bash/Makefile 质量(`check-actions-pinned.sh:16-39` 头里 24 行运维 runbook、`Makefile:215` `env $(grep … | xargs)` 词分裂、`:177-178,235-236` `lsof | xargs kill` 杀任何占端口者、`:222` `sleep 3`、`:188-213` 已退役的 supabase CLI 回退、`contract-drift.sh`/`eval-fixture-drift.sh` 两份相同的 throwaway-index 例程);T-25 pipeline 实现(`PYTHON_VERSION`/`NODE_VERSION` 声明未用、四份 coverage job、四份 artifact-upload、七个契约测试在 `route` 与 `static-quality` 跑两遍、`agent-eval/action.yml:42-45` 未知 tier 最后才拒、`test_config_read_sets.py` 只为一个不可能抛的异常带整套 PEP 723 + `uv run --script --locked` 机制);T-26 `local-login.sh:59-74` argv 进 JSON 与 `ILIKE` 字面量、`e2e-setup.sh:23` 吞第一次失败原因、`staging.ts:38-50` 手写 IP 正则(`node:net` 有 `isIP`);T-27 eval 用 `../../../../apps/agent/…` 相对路径读 datasets 与 `uv.lock`(`case-strata.ts:16-18`,`pins.ts:16,62`);T-29 `database-access/index.ts:84-86,134-141` 并行数组,`secretName?` 可选而全部设置。

### 8.5 看着奇怪但有依据的(七份报告 §4 合并,免得再被标)

- **edge agent tier**:`respond` 作为终止工具而非 constrained decoding(`turn-answer.ts:6-41`,pi 0.84.4 实测);手写 `transformContext` 压缩(`context-compaction.ts:14-42`,四条实测理由);Gemini BYOK 走 Google 的 OpenAI 兼容面(`byok-family.ts:14-28`,spec Appendix D);`openai-compatible` 只钉 `api.openai.com`(`byok-headers.ts:26-36`,S5 第一条红线);session envelope 在 DO storage、stage-then-settle、`already_settled` 独立 phase(`durable-envelope-store.ts:4-17`,有测试);两个 `ProviderAllowlist` 与 keyless 搜索后端的哨兵 key(`web-search-egress.ts:17-33`);DuckDuckGo HTML 作为承重依赖,带 fixture(`duckduckgo-web-searcher.ts:5-22`);wire 形状的 snake_case 类型进 domain(SD-9 与 fallback 旗标的「客户端看不出差别」);`TurnCatalogSession` 实现三个 port(ISP);eager `api/openai-completions` import(esbuild chunk bug,`test:bundle-smoke` 守);drizzle SQL 模板而非 query builder(driver 可移植,`agent-db-test/` 证的就是 Neon 跑的语句);refs 存两份;85 s 每工具预算由工具持有(pi 无每工具超时);`web_search` 自身失败不 throw。
- **edge gateway**:`inventoryPath` 模块加载时 throw(fail-closed 绑 `AGENT_PATHS`);`retired` 类答同一 404(SESSION-2 #960);ja/zh/en 硬编码是 FALLBACK 旗标下的 Python wire,W4 后归 edge;staging `workers_dev = true`(owner 08-27,smoke 是消费者);每单元工作一个 `Pool`(Neon 的 Workers 形状;只有「读也包事务」是 EG-22);`container-fetch.ts:103-127` resolve-before-abort 与不可注入的 `setTimeout`(变异测过);两套 Turnstile pass 机制对应两条客户端流(缺一句文档);`container-env.ts:57-138` glob denylist + `denied-egress.test.ts` 用 `Function` 评估 vendored matcher(唯一跑真 matcher 的测试);`agent-tier-route.ts:13-30` 只在 edge 侧放宽匿名 transcript GET;三个 wrangler 块重复 binding(wrangler 要求,两个测试固定);`sleepAfter = "10m"` 与 55 s port-ready(#1220/#1239);`forward.ts:122-124` 对象日志是遵守规则的那一处;`MESSAGE_MAX_CHARS` 作常量;`read-key.ts` 信任 `CF-Connecting-IP`。
- **catalog**:`statementBuilder() = drizzle.mock()`(留,但退役「before merge」那句);`src/types.ts` 手镜像 + `expect(true).toBe(true)` 载体测试(编译期互赋值检查,zod 出 bundle 是理由);`AnitabiPoint = Record<string, unknown>` 原始区存原样 JSON 下游再窄化;`points.embedding vector(1024)` 映射不读(structured-first 规则冻结);`wrangler-private.worker.test.ts` 逐行解析 TOML(push to main 时 spike lane 不跑);staging DAILY_IMPORT 导自己的桶(#1148/#1016 AC2,按决定,即 §4 #16);冷启动自愈只在 `pointsByBangumiId`(§4 #4);`fullJitter` 用时钟亚秒相位(Sonar/CodeQL 规则);`pyRound` 与「matches Python」对等注释(eval 基线还是 Python,重基线前留);`connections.ts:35` 动态 import(大概为了让不开 DB 的测试不载 `@neondatabase/serverless`,未验证,加一行注释);`waitUntilFor` 吞 Hono 的 throw(入口 adapter 可以,消费者 `search.ts` 是问题);`Budget` 75 行是内聚值对象,问题在外面的四个自由函数。
- **users · contract · migrator**:`bearerAuth`(§4 #6);`reclaim()` 已闭(#1222);`GRANT ALL`/readonly/概念 FK 已决(§4 #13);Worker 生成 UUIDv7 的所有权(M8 只问手写);403 `SAVED_ROUTE_NOT_OWNED` 作存在性 oracle(UUIDv7 74 位随机,枚举不可行;`deleteOwned` 第二次探测不泄露 owner);`saved_routes.user_id NULL`(claim 流已设计未开);`STAGING_ONLY_BASELINE` 标记文件(`promote-release-unit.sh:263` 机器强制);`agent-openapi.json` 无 schema(CONTRACT-1 #938,模型由 `emit-agent-python.ts` 生成并有字节漂移门);HTTP apply 路径不运行时校验 `atlas.sum`(`gate_db` 与 promotion 各校验一次,bundle 来自同一不可变树);`category` 不上 wire(README「Categories drive behavior」);`~orpc` 私有字段读(exact pin 撑着,pin 移动时 L3 提醒);容器路径「until staging proof」(M11 只问到期)。
- **web**:`new Chat` 在 ref 里按 session scope + epoch 丢晚帧(只有 render 期 `stop()` 是 M4);`neon-auth.ts` SSR fold + `importProtection` + sourcemap 断言三层(#426 同类事故);`session-adoption.ts:141-143` `console.warn` 是唯一 sink(callback 屏是真实出口);`SearchMap`/`RouteTrailMap` index key(同名城市);`shiori.css:21-31` 重声明七个 root token(export-theme invariance,`export-theme-invariance.test.ts` 固定);`wrangler.jsonc:47,68` 顶层 `APP_ENV` 与提交的 staging runtime config;`/chat` 文档跳转(scope reset 是目的);`use-saved-route.ts:46-49` 纯函数请求(auth-callback replay 在 React 外);`theme-bootstrap.ts:15-17` inline `localStorage`(状态归属门点名的唯一例外);`LoginForm` 的 `.ds-*`(有记录,仍是 M8 的重复词汇);`token-store.ts:47-77` waiter 注册表(不向已 arm 的 edge 发无 token 的 turn);`tests/msw/contract-handler.ts:40-53` 请求响应双向经契约解析。
- **tooling**:`python-random.ts`/`python-sum.ts`/`python-number-text.ts` 的 MT19937、`fsum`、`.4f` 重实现(与 `gate.py` 位级对等,`fixtures/stats-oracle.json` 钉,`export-fixtures.sh:64` 钉 3.11);`Record<string, unknown>` 镜像 `Mapping[str, object]`;`official-argument-correctness.ts:52-54` 常量 1(#1300 待补,30 行警告成比例);`pre-push.sh:41` `unset "${!GIT_@}"`(linked worktree hook 继承 `GIT_DIR` 的事故);`quality.sh:86-89` `env -u`(macOS bash 3.2 堆损坏);`infra-check.sh` 正则分类(fail-closed,16 个探针);rollback action 三处 blank-out(子 action 密钥隔离,T-06 只问重复);`promote-release-unit.sh:227-250` 子串截断(SIGPIPE/`set -e`);`reset-staging-baseline.sh:40-51` 08-26 §2.6 已修;`staging-smoke-check.sh:45-50` 有界重试;集成 arm `--cov-fail-under=0`(钉住);`topology-staging.test.ts:91-108` 记录的变异结果;`build-release-unit/action.yml:25` `git restore package.json`(正确,缺注释);范围内无 helper/util/common/manager 命名。
