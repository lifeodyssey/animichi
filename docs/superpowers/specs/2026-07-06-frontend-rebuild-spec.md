# 前端重建(Frontend Rebuild)— 主 Spec

Status: DRAFT for Coordinator planning (rev. 8 — 回填 A 对齐 inputs §七~十一/SD-13~27,取代 rev.7 中已被推翻的 SD-9 三事件 SSE 提案;含收窄后的 [提案待确认] 标注项,见下方说明)
Date: 2026-07-06
Author: Planning agent(rev.7 基于 `2026-07-06-frontend-rebuild-inputs.md` §一~§九);回填 A(rev.8,基于 §一~§十一全文,commit 见 git log,权威性分层见下)
Baseline: `main` (`02cd7fa`), new branch `feat/frontend-rebuild`

唯一权威输入:`docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md` 第七~十一节(回填自 SD-13~27,本次回填覆盖)。**权威性分层(重要,2026-07-06 主会话勘误;2026-07-06 晚间回填 A 复核更新)**:
- **定案**(可直接执行,不需要额外用户确认):§一~§五(决策登记册/迭代列车/三份盘点报告)、§六 X1-X15、§七~§十一 SD interview 结论中的 **SD-0 至 SD-27**(含 §八 对 SD-7 的补充确认措辞)。**SD-9 已修订**(见下,回填自 §十 Step2):三事件自定义 SSE 提案已被推翻,现定案为 AI SDK UI 消息流协议 via pydantic-ai `VercelAIAdapter`。**SD-13/15/16/17/18/19/20/21/22/23/24/25/26/27**(§八~十一逐项经用户过堂后转定案,回填自本节)一并纳入定案范围,取代旧版标注的对应 [提案待确认] 项:P2→定案(SD-19)、P3→撤销由 SD-18 usage 计量钩取代、P8→定案(SD-20)、P9→定案(SD-21)、P10→定案(SD-13 规则②)、Generative UI 核心哲学(语义 payload + 应用自有 registry)→定案(SD-13);内部 skill 框架不引入、MCP client 推迟按需接入→定案(SD-24)。
- **[提案待确认]**(仍待用户逐项确认,未被 §十/十一 任何后续轮次覆盖):P6(SSE `turn_id`/`seq`/断线不续传细节,今按 AI SDK 协议语境重述)、消息长度上限、D16(模型更换 eval 门禁)、D18(BYOK 只覆盖主循环的具体论证)、D19(不做模型分层)、Generative UI 宪法中 "payload URL 仅允许 catalog/白名单来源渲染" 的具体边界(SD-13 只确认了整体哲学,未逐条覆盖此细则——回填 A 存疑,见报告)。

设计原稿:`docs/design/2026-07-06-design-sync/`。与旧 spec(`2026-06-22-frontend-rebuild-tanstack-design.md` 等)冲突处,以 inputs 文件与本 spec 为准。

---

## ① 愿景与范围

Seichijunrei 前端从 Next.js + OpenNext-SSR 全量重建为 `apps/web`(TanStack Start,SPA + 选择性 SSR,Cloudflare Worker 运行时),部署到**定案域名 `animichi.com`**(SD-0),一次大爆炸切流直接替换生产;后端保持 PydanticAI 容器化 agent(SD-4 终局定案)+ TS catalog 的混合微服务,新增**第三个** TS 服务 `workers/users` 承载用户域数据(SD-2 定案);归属规则终局:catalog 域数据→`workers/catalog` oRPC,用户域数据→`workers/users` oRPC(Neon+Drizzle),agent 不再新增数据端点。Agent 认知架构维持现状(SD-7:单工具循环+确定性旁路,不新增路由层);对外能力面(迭代 7)是**任务型**而非对话型(SD-12:`resolve_anime`/`search_points`/`plan_pilgrimage`,无状态幂等,不暴露 chat 直通)。Chat 的流式协议终局为 **AI SDK UI 消息流协议**(pydantic-ai 官方 `VercelAIAdapter` + 前端 AI SDK v7 `useChat`,回填自 SD-9 修订版,取代旧版"三事件自定义 SSE"提案);自有契约收缩为自定义 data parts 的 zod schema,进 `packages/contract`。BYOK 首发覆盖 OpenAI 兼容/Anthropic/Gemini 三家(SD-11)。**以下安全/契约细化项已定案**(回填自 SD-19/20/21/13):外源内容定界+架构不变量(P2/SD-19)、SSRF 出口守卫(P8/SD-20,严格版解析后 IP 校验)、GPS 精度截断至百米级(P9/SD-21)、payload 契约 additive-only 演进 + registry 治理策略(P10/SD-13 规则②);原"成本累计中间件"(P3)已撤销,由 SD-18 新增的 usage 计量钩 + 容器入口熔断取代。**仍待用户过堂**:P6(SSE 断线语义,今按 AI SDK finish 事件 + GET messages 兜底重述)、消息长度上限。8 个迭代(0-7)按巡礼之环的顺序建造——Chat 计划先行,详情/列表承接保存,Walk 现场审判,しおり产出回流,発見页引新人(続きから只依赖 sessions/routes,SD-8),工作台增效,开放接口对外(任务型能力,SD-12;对外发布顺序按 SD-25 = Claude Skill 先行→顺手粗粒度 MCP server→A2A 押后至 DD-10 冻结触发)——每个迭代结束都是可独立部署到生产的 releasable 增量。范围覆盖 `docs/design/2026-07-06-design-sync/` 下全部 24 个页面级 HTML 画布(见 §⑥)、SEO/GEO 可执行化(回填自 SD-27,见 `2026-07-06-seo-geo-plan.md`)。

不追求"从第一天就功能对等旧站",追求"每个迭代结束时,线上没有死路 UI、没有裸错误、视觉与画布一致"。

---

## ② Decision Log

### G1-G8(grill-me 定案,2026-07-06)

| # | 决策 | 定案 |
|---|---|---|
| G1 | 基线落点 | 基于 main(02cd7fa)新分支 `feat/frontend-rebuild`,新前端落 `apps/web/`;spike 代码(分支 `docs/frontend-rebuild-plan` 的 `frontend/`,11 个功能 commit)**迁代码不迁历史** |
| G2 | 切流 | **大爆炸**:迭代 0 的 walking skeleton 直接替换生产前端;旧 Next.js `frontend/` 与 OpenNext 链路同迭代删除 |
| G3 | 渲染 | SPA + **选择性 SSR**(`/s/:id`、`/anime/:id` 两族路由)——对旧 spec「纯 SPA」决策(D4)的正式修订 |
| G4 | 后端归属 | **全栈纵切**:需要新后端能力的 story 自带最小 enabler。归属细则终局:catalog 域数据→`workers/catalog` oRPC;**用户域数据→新建 TS 服务 `workers/users` 的 oRPC 路由(`/v1/users/*`),Neon+Drizzle 承载,契约进 `packages/contract`**;`apps/web` 的 `supabase-js` **仅用于 auth**,不直连任何数据表;**禁止往 agent 服务新增任何数据端点**,agent 只保留会话/编排(单工具循环+确定性旁路,SD-7)。**X11 纪律**:自家 `apps/web` 消费能力面/用户数据面一律走 `/v1` 公开 API,不开私有后门;迭代 7 的 SDK/MCP 复用同一契约,且对外只暴露**任务型能力**(SD-12),不透传 chat |
| G5 | 迭代列车 | Chat 先行,8 个迭代(0-7) |
| G6 | Walk 离线 | 迭代 3 内**一步到位**(service worker + 地图/路线缓存 + 打卡离线队列同步),不拆分、不推迟 |
| G7 | 匿名 Chat | **完全放开**:未登录可完整用 Chat,登录墙只在保存(P5);配套 edge 限流 + Cloudflare Turnstile + 匿名配额 + BYOK(三 provider 族,SD-11);对外开放接口进迭代 7,顺序按 SD-25(回填):Claude Skill 先行 + 顺手粗粒度 MCP server;**A2A 押后**(→ DD-10 冻结,等企业编排侧真实信号) |
| G8 | 素材生产 | fox 小跑 8 帧 sprite + 20 枚产品图标集以 AI 生成管线产出;AC 必须含「用户过目收编后才算完成」 |

### D1-D15(架构决策台账判决,定案)

| # | 决策 | 判决 | 关键事实 |
|---|---|---|---|
| D1 | TanStack Start | 保留 | spike 已跑通;文档/CI 全部仍写 Next.js——迭代 0 文档回写一并处理 |
| D2 | animal-island-ui-tailwind | 保留,升 1.0.x 最新 | 兼容性验证进迭代 0 |
| D3 | Capacitor | **推迟**(non-goal,环闭合后) | LOCKED 纸面决策,零代码 |
| D4 | 渲染策略 | **修订**:SPA + 选择性 SSR(= G3) | `wrangler.toml [assets]` 与 CI 均按旧假设,迭代 0 必修 |
| D5/D6 | monorepo + oRPC 契约 | 保留,**范围扩大** | 本列车起新增 `workers/users` oRPC 契约 + chat AI SDK UI 消息流自定义 data parts 的 zod schema(回填自 SD-9 修订版,取代旧"三事件 SSE schema"表述),同样进 `packages/contract` |
| D7 | Agent Pyodide Worker 化 / TS 重写 | **双双 REJECTED,终局(SD-4)** | 容器化 Python + 保温策略为最终架构;X2 首 token SLO 由此升级为硬性要求 |
| D8 | Neon/Supabase 拆分 | **SD-3 激活,渐进执行** | Supabase 收缩为纯 auth,数据面归 Neon,5 子点(① selected_route bug 修复/② 新表建 Neon/③ Supabase catalog 表冻结/④ sessions 等迁移/⑤ 远期 Auth 迁移非本列车) |
| D9 | Pulumi IaC | non-goal | 例外:R2 bucket 绑定直接声明 |
| D10 | 多环境 | non-goal | 现状单环境 tag→prod |
| D11 | i18n | 保留 | spike 的 Context+字典机制直接沿用 |
| D12 | 测试策略 | 保留 + 补洞 | `apps/web` 覆盖率地板从迭代 0 实测值起建;agent-eval 分层常开(X8) |
| D13 | tag-based deploy | 保留机制,重写内容 | `workers/users` 需与 `workers/catalog` 同等 CI/部署步骤 |
| D14 | agent 认知循环架构 | **维持不变(SD-7 终定,用户已确认)** | 单工具循环(native tool-calling,ReAct 血统)+ 类型化终局 + `ModelRetry`/`output_validator` 双守卫 + 确定性旁路(SP8/SP9、`selected_point_ids`);意图准确率走 eval-driven 提示词/few-shot/工具描述调优,不新增路由/dispatch 层 |
| D15 | 会话记忆范围 | **per-session,`user_memory` 休眠**(SD-8);**记忆机制细化定案(回填自 SD-15)** | `user_memory` 表休眠不删除不投入;"続きから"(迭代 5)只依赖 `sessions`/`routes` 列表。SD-15 细化:① 事实台账 = `tool_state` typed 化,起步字段=已提方案摘要/当前选中集/用户硬约束/已解析作品/话数场景引用,全字段带时间戳 + 新增/修正/作废(supersede)语义(迭代 1 落地,S1.7 附近);② 匿名→登录会话归属迁移(设备 token→user_id)进迭代 1;③ `user_memory` 唤醒蓝图(非本列车)= 自建 profile 表(不引 Mem0/Letta/Zep)+ 用户可见可编辑可删可关 + GEM 写入语义 + 轻量"待促升"软事实缓冲;④ 语义压缩保留逐字片段兜底,迭代 1 顺手 AC |

### D16-D19(源自 inputs §九"模型策略"/"Subagent 终定"散点;**回填 A 更新 2026-07-06 晚**:D17 已被 §十 Step8/SD-24 逐条过堂后转定案,D16/D18/D19 未被 §十/十一 任何后续轮次覆盖,仍待用户确认)

| # | 决策 | 状态 | 内容 |
|---|---|---|---|
| D16 | 模型更换门禁 | **[提案待确认]**(未被后续 SD 轮次覆盖) | 换主力模型须过 eval gate(617 套件,重点 locale+intent,score/円 综合决策);与 X8 分层 eval 门禁共用基础设施 |
| D17 | Subagent 使用范围 | **定案(回填自 SD-24①,§十 Step8"部分定案"逐条过堂已确认)** | 产品 runtime 零 subagent,仅保留翻译子 agent(边界干净纯函数);注入隔离子 agent 推迟迭代 7 评估(→ DD-4 冻结);**不拆规划/澄清/搜索**(拆出=多一个出错的 LLM 判断点,伤 IntentMatch 54%);SP9 是"同一 agent 带约束重调",非多 agent;开发 harness 的多 agent 编排与产品 runtime 严格区分 |
| D18 | BYOK 覆盖范围 | **[提案待确认]**(SD-20 内容与之不矛盾,但未见用户就此专项确认,回填 A 存疑,见报告) | 只覆盖主循环 LLM 调用,内部调用一律用服务端自有 key |
| D19 | 模型分层 | **[提案待确认]**(未被后续 SD 轮次覆盖) | 不做模型分层(YAGNI 论证:工具执行是代码逻辑非 LLM 调用) |

### X1-X15 架构补充意见(主会话追加,2026-07-06 全天,定案)

| # | 意见 | 落点 |
|---|---|---|
| X1 | **地图选型 ADR**:MapLibre GL + Protomaps(pmtiles 存 R2),static-first;**禁用 Mapbox** | S0.4;S1.4/S1.5/S2.2/S5.2;移除 `NEXT_PUBLIC_MAPBOX_TOKEN`(S0.3) |
| X2 | **Chat 首 token SLO**:warm p95 ≤3s + 容器保温;**SD-4 后为硬性要求** | S1.2 `-> api` |
| X3 | **BYOK × Logfire scrub**:key 剥除所有观测面;**SD-11 后覆盖三 provider 族** | S1.11 硬 AC `-> integration` |
| X4 | **全局日预算熔断**:超阈值自动降级弹登录墙 | S1.8 `-> unit/api` |
| X5 | **Edge 认证模型变更显式化** | S1.8 enabler + S0.9 |
| X6 | **图片管线客户端化**:R2 只存成品,分享物默认剥 EXIF | S4.2/S4.6/S4.7 |
| X7 | **SW/SSR 绕行规则**:network-first for `/s/:id`、`/anime/:id` | S3.6/S4.3/S5.1 `-> browser` |
| X8 | **eval 分层常开**:5 条 smoke PR 门禁,617 全量 nightly | S0.1;S7.1 依赖 |
| X9 | **D7 双双 REJECTED** | 见 D7 行 |
| X10 | **平台能力适配层**:camera/geo/haptics/wake-lock/clipboard-share | S1.3/S2.5/S3.3/S4.2/S4.6 |
| X11 | **SDK 战略**:①②已入 G4;③④⑤展开为 S7.5/S7.6/S7.7,MCP 新增 S7.4,均按 SD-12 任务型能力收口。**发布顺序回填自 SD-25**:单一真源 = `packages/contract` zod→OpenAPI + `/v1`,四壳(Skill/MCP/A2A/SDK)皆薄适配;迭代 7 落地顺序 = ① Claude Skill(零新基建,SKILL.md + `seichijunrei_client.py` 进 `scripts/`)② 顺手粗粒度 MCP server(`FastMCP.from_openapi`)③ **A2A 押后**(→ DD-10 冻结);前置技术债顺手清:9 工具 `dict[str,object]` 返回→Pydantic 模型 |
| X12 | 用户域 enabler 归属——已被 SD-2 取代 | 见 G4、SD-2 |
| X13 | 迁移工具链——已被 SD-1 取代(双链+atlas-provider-drizzle) | 见 SD-1 |
| X14 | edge worker 转正——已被 SD-6 修正(TS+16 用例,缺口仅 CI) | S0.3 |
| X15 | **catalog 数据质量门**:坐标校验/去重/話数完整性+数量漂移告警 | S5.8 |

### SD Interview 结论(inputs §七~§十一为准,**定案**;详见 inputs 第七~十一节全文,本节仅一行索引 + 关键差异)

| 轮次 | 结论 |
|---|---|
| SD-0 域名 | **`animichi.com` 定案**;`aninavi.app` 301 或非阻塞放养;kitsunavi.com 品牌升级备选 → DD-20 冻结 |
| SD-1 迁移链 | 双链 + atlas-provider-drizzle;边界写 `docs/ops/migrations.md`(S0.9) |
| SD-2 用户域访问 | API-first,`/v1/users/*` oRPC(`workers/users`),`supabase-js` 仅 auth |
| SD-3 数据面 | Supabase 收缩为纯 auth,数据归 Neon(5 子点,D8);⑤远期 Auth 迁移 → DD-1 冻结 |
| SD-4 agent 运行时 | Python FastAPI 容器定案,不再议(D7) |
| SD-5 会话状态 | Iteration 1 沿用现状端点,best-effort,随 SD-3④ 迁 Neon |
| SD-6 edge worker | TS+16 用例,缺口仅 CI 接线(S0.3) |
| SD-7 认知循环 | **终定(用户已确认)**:单工具循环(native tool-calling,ReAct 血统)+ 类型化终局 + `ModelRetry`/`output_validator` 双守卫 + 确定性旁路;意图准确率走 eval-driven 调优,不做架构改造(D14);路由层改造 → DD-2 冻结 |
| SD-8 会话记忆 | per-session + 会话列表;`user_memory` 休眠(D15);唤醒 → DD-3 冻结 |
| SD-9 流式协议(**修订版,回填自 §十 Step2,取代下方"三事件 SSE"旧提案**) | **AI SDK UI 消息流协议定案**:后端 pydantic-ai 官方 `VercelAIAdapter`(`/v1/chat` 已在跑),前端 AI SDK v7 `useChat`(TanStack 内)。语义映射:step 徽章 ← tool parts 状态机;渐进卡片 ← data parts 同 ID 覆盖更新;等待仪式/狐狸情绪 ← 前端状态机推导;终局+断线 ← finish 事件 + P6 GET 兜底(AI SDK resume 能白拿则拿)。自有契约收缩为自定义 data parts 的 zod schema(进 `packages/contract`)。迭代 1 spike:typed output 经 `VercelAIAdapter` 能否渐进流出,否则改为后端在工具间隙主动推 data parts。统一 `/v1/chat`,退役 `/v1/runtime/stream` 自定义 SSE,不留双协议。**注**:P6(turn_id/seq/断线语义细节)仍属 [提案待确认],今按此协议语境重述,见下 |
| SD-11 BYOK 范围 | pydantic-ai 原生多 provider,首发三族(OpenAI 兼容/Anthropic/Gemini),per-request model override,X3 scrub 全族生效 |
| SD-12 对外能力形状 | **迭代 7 MCP/A2A = 任务型能力**:`resolve_anime` / `search_points` / `plan_pilgrimage(anime, constraints)`,无状态、幂等、可缓存;Workers 薄适配器 → 同一 `/v1` 契约;**不暴露 chat 直通** |
| SD-13 Generative UI(§十 Step1,回填) | **哲学 A 定案**:语义 payload + 应用自有 registry(业界背书:MCP Apps/AI SDK7/A2UI)。三规则:①append-only 卡片流(E1);②additive-only 版本化,治理抄 MCP 弃用策略(Active/Deprecated/Removed,≥12 个月);③partial-tolerant 组件。`presentation_hint`=服务端建议值+前端终裁+未知值优雅降级。迭代 7 新增 MCP Apps 最小子集(`@mcp-ui/server`,ChatGPT 特有字段扩展 → DD-19 冻结)。**取代/覆盖旧 P10(additive-only 演进)**,详见下方安全速查表 |
| SD-15 会话记忆细化(§十 Step3,回填) | 见上方 D15 行完整内容 |
| SD-16 狐狸人设(§十 Step4 议题1,回填) | **A 克制版第一人称狐狸 + 名字统一 Animichi**(文案库 23 句语气样本背书)。叫声"コン"降为爱称/彩蛋(日文独享双关,中英无对应梗)。三语落法:日「アニミチだよ/コンって鳴く」、中「我是 Animichi,带你巡礼的小狐狸」、英「I'm Animichi, your pilgrimage fox」。五条 persona 规则:①具名自称不用私/僕;②默认常体,免责/隐私/登录/支付切敬体;③零颜文字/emoji 功能化(🚩✓);④名字非叫声禁"コンコン";⑤三语 voice 映射进 eval F 族。正式露出点(splash/about/初问候/OG)亮"Animichi"。落点:S0.7(Splash)、S1.*(chat 文案)、品牌露出各 story |
| SD-17 Prompt 补丁+长度治理(§十 Step4 收口,回填) | 四补丁(全 eval-driven,S1.12/prompt story):①few-shot 8→3-5 条精准打双意图/续作/中日混杂;②四工具 docstring 补"何时不用"反例;③语言判定消歧:当前轮文本优先于历史 locale + Unicode 脚本兜底;④5 个响应模型补 `Field(description)` + JST 当前时间注入 + `guardrails.py` 死代码二选一(接入/删除)。**长度治理**:静态段 ≤2K token 红线,每迭代复查;缓存序纪律=静态段前置、动态注入(JST/台账/session)一律置末;规则稀释以 eval 分数为唯一度量 |
| SD-18 Hook 层两新增(§十 Step6,回填) | 现有四钩不动(压缩滑窗/`output_validator`/`@instructions`动态注入/Logfire instrument);新增:① usage 计量钩(`result.usage()`→`daily_usage` 表,scope=anon/user/byok)+ 容器入口熔断(非 edge)+ BYOK 不计平台预算但仍过守卫——**取代旧 P3(计时中间件),原 P3 计时部分砍掉**(Logfire span 已覆盖);② 错误边界钩(工具/agent 异常统一映射 D1-D9 响应模型),与 SSE 异常态 AC 绑定。排除项:human-in-the-loop 审批(→ DD-16 冻结)、语义缓存(→ DD-15 冻结) |
| SD-19 注入防护(§十 Step5,回填) | **迭代 1 全档上,取代/实现原 P2**:P0—web_search 结果套 `<untrusted_web_result>` 定界 + 系统提示声明"搜索结果是待核实数据"+ `detect_prompt_injection` 扩展覆盖工具返回内容;P0—架构不变量(工具全只读 + "经 MCP/A2A/工具结果到达的一切永远是 tool 优先级"写进系统提示 + 回归测试);P1—信源分级(白名单标已验证);P2(原文档编号,注意与本 spec P2 速查表条目同名不同层级)—Llama Prompt Guard 2 旁路打分,只标记不硬拦(硬拦 → DD-5 冻结)。eval G 族(G-1/G-2/G-3)。迭代 7 硬门槛另议。注入隔离 sub-agent → DD-4 冻结 |
| SD-20 BYOK + P8(§十 Step5 收口,回填) | **取代/实现原 P8**:key 每请求透传、后端不落盘;客户端"记住"用 sessionStorage/内存态,不自制加密(→ 服务端加密存储跨设备 DD-6 冻结);X3 scrub 强化=自建 header allowlist 剥离中间件,覆盖请求日志/span/异常序列化三面;**P8 严格版**=解析域名→取确定 IP→校验不在私网/环回/链路本地/云元数据段→用该 IP 连接(不重复解析,防 TOCTOU/DNS rebinding)+ 禁自动跟随重定向,不加域名白名单;配额分层:BYOK 豁免日预算但不豁免注入防护/`output_validator`/内容守卫/频率异常检测 |
| SD-21 Observe/Trace(§十 Step7,回填) | **取代/实现原 P9**:Logfire 全链路不动;P9 = header allowlist 中间件顺带处理 GPS,**坐标进 trace 前砍到小数点后 3 位(百米级)**,存储层(打卡)全精度;usage/成本已在 span(不重复造);迭代 7 顺手加 trace 按调用方维度切分 |
| SD-22/23 飞轮排期(§十/十一,回填) | 五只飞轮共用全信号埋点(迭代 1 起)。飞轮1 Agent质量(迭代1全速转:trace→eval_candidates 表→人审→正式集);飞轮2 意图口味(迭代1只埋字段,迭代3-5 析);飞轮3 UGC→catalog(迭代1埋 schema 留位,审核管线 → DD-7 冻结);飞轮4 SEO增长(迭代5,见 SD-27);飞轮5 记忆个性化(休眠 → DD-3 冻结)。**self-evolve 边界**:入库/写库/改门禁一律人批准,不做无人自动闭环 |
| SD-24 subagent+mcp-client(§十 Step8,回填) | 见上方 D17 行(subagent 部分);mcp-client(消费第三方 MCP)推迟按需接入 → DD-8 冻结;运行时内部 skill 框架不引入(YAGNI,触发点工具膨胀到 20+ → DD-9 冻结) |
| SD-25 对外发布形态(§十 Step8 收口,回填) | 见上方 X11 行;单一真源 = `packages/contract`→OpenAPI+`/v1`,四壳皆薄适配;顺序 Skill→MCP→A2A 押后(→ DD-10 冻结) |
| SD-26 图搜两阶段(§十一,任务#7,回填) | 文本 RAG 不引入。两阶段:①LLM vision 粗筛认作品(迭代1,chat"写真"态,走现有 `resolve_anime`,认不出走 clarify 降级);②作品内精匹配机位(迭代4,embedding 粗筛[标配]+LLM vision 精排为主力,系列合并规模 1000+,作品匹配单位=系列)。反向发现三层(世界知识直认→GPS 附近搜→全库向量搜);层3/ANN 索引/contrastive 微调均 → DD-11/12/13 冻结。图搜埋点五信号(query_type/gps_available/layer_hit/candidates_shown/user_confirmed)进迭代1 全信号埋点清单 |
| SD-27 SEO/GEO(§十一,任务#8,回填) | 落地包 → `docs/superpowers/specs/2026-07-06-seo-geo-plan.md`。要点:作品页 `/anime/:id` SEO 主力(SSR);点位不独立成页(→ DD-14 冻结);robots 挡训练爬虫放行搜索/引用/Agent 爬虫;**llms.txt 降级为静态一页,llms-full 管线砍掉**(负清单,取代旧版 Iteration 7 提及的 `llms-full.txt`);JSON-LD 收缩=Organization/WebSite/BreadcrumbList+页面级 geo,**FAQPage schema 不做**(已停显);三语子路径 /ja /zh /en + hreflang + 每语言 title/H1/slug 本地化硬 AC;MCP-as-GEO 进迭代7;质量门=X15+模板占比检查;完整迭代映射见 seo-geo-plan.md §7、负清单见 §8 |

**Planner 核证的补充代码级证据**:
- `packages/contract/scripts/emit-openapi.ts` 目前只覆盖 `catalogContract`;SD-2 的 `/v1/users/*` 契约是全新增量。
- `apps/agent/agent/agents/selected_route.py` 第 30-31/33 行确认 SD-3① 所指的跨库读取路径(`SupabaseClient` 读点位,与同会话搜索路径的 Neon/CatalogClient 不同步)。
- `apps/agent/pyproject.toml` 第 46 行声明 `pydantic-ai-guardrails>=0.2.2`,全仓库无 import——**确认僵尸依赖**(此发现是 Planner 自行代码核查所得,不受 P 系列"提案待议"状态影响,处理方式见 S1.6/S1.12)。
- `/v1/chat` 现状用 `VercelAIAdapter`——**回填 A 更正(2026-07-06 晚)**:此前版本将其记为"与 SD-9 三事件命名不完全对应"的风险项;SD-9 已修订为 AI SDK UI 消息流协议本身就是 `VercelAIAdapter`,两者现已一致,不再是需要对齐的风险,而是既有正确实现,S1.1/S1.2 的工作转为"确认现有 `/v1/chat` 端点符合 SD-9 修订版语义映射并补齐自定义 data parts schema",而非"协议归属对齐"。

### 全局约定:平台能力适配层(X10,定案)

`apps/web/src/platform/` 建一层薄接口,封装 camera / geo / haptics / wake-lock / clipboard-share;**产品组件禁止裸调 `navigator.*`**。凡涉及相机/定位+震动/剪贴板+分享的 story,AC 要求「经由适配层」`-> unit`。

### 全局约定:用户域数据访问路径(SD-2,定案)

用户自有数据一律经**新建的 `workers/users` TS 服务**的 oRPC 路由(`/v1/users/*`)访问,数据落 **Neon**,契约进 `packages/contract`。`apps/web` 的 `supabase-js` **仅用于 auth**。

### 全局约定:Chat 流式协议(**SD-9 修订版,定案,回填自 inputs §十 Step2,取代本节此前"三事件 SSE"表述** + P6 提案待确认细节)

**定案部分**:协议 = AI SDK UI 消息流,后端 pydantic-ai 官方 `VercelAIAdapter`(`/v1/chat` 现状已是此实现),前端 AI SDK v7 `useChat`(TanStack Start 内)。语义映射:step 徽章 ← tool parts 状态机;渐进卡片 ← data parts 同 ID 覆盖更新;等待仪式/狐狸情绪 ← 前端状态机推导(非协议自带字段);终局 ← `finish` 事件。自有契约收缩为**自定义 data parts 的 zod schema**(进 `packages/contract`),不再是独立的三事件 schema。generative registry 组件从第一天起按 partial-tolerant 设计(承接 SD-13 规则③);协议必须可降级;判别式联合的 `intent` 字段须先于其余字段到达(此约束延续,不受协议改动影响)。迭代 1 spike:确认 typed output 经 `VercelAIAdapter` 能否渐进流出为 data parts,若否则由后端在工具调用间隙主动推送 data parts。统一使用 `/v1/chat`,现有 `/v1/runtime/stream` 自定义 SSE 待 chat 迁移完成后退役,不留双协议。

**[提案待确认]部分(P6,inputs §八,今按 AI SDK 协议语境重述)**:自定义 data parts 额外带 `turn_id`+`seq`;**不支持断线续传**(不做 SSE Last-Event-ID 式续传,一次 run 不可中途恢复,AI SDK 原生 resume 能力若可直接复用则优先复用而非自建);断线后客户端调用 `GET messages` 拉取终态,不尝试恢复流;生成中断在 UI 上显示为 D 系异常态卡片(D4)。此细化机制已写入 S1.1/S1.2/S1.6 的 AC,但标注待用户确认;若用户不认可"不支持断线续传"这一取舍,需要 Coordinator 在评审阶段与用户对齐后再定。

### 全局约定:Generative UI 宪法(**核心哲学已定案,回填自 SD-13**;URL 白名单细则仍 **[提案待确认]**)

- **定案(SD-13 哲学 A)**:LLM **仅能**从 registry 中选择已注册组件类型 + 填充结构化语义 payload,应用侧自有 registry 负责渲染,**永不生成 UI 代码**。三规则:①append-only 卡片流;②additive-only 版本化(治理抄 MCP 弃用策略,Active/Deprecated/Removed,≥12 个月);③partial-tolerant 组件(可缺字段+skeleton slot,Storybook 建半态+旧版态 story)。`presentation_hint` = 服务端建议值 + 前端终裁 + 未知值优雅降级。
- **[提案待确认]**:payload 内出现的任何 URL **仅允许**渲染来自 catalog 数据源或明确白名单来源——SD-13 只确认了 registry 哲学整体,未见就此 URL 白名单细则单独过堂,回填 A 存疑,建议 Coordinator 评审阶段单独确认此条。
- 此条款已写入 Iteration 1/6 组件 story 的 Reviewer checklist 建议,但标注为待确认——若用户认为这条限制过严或需要调整边界(例如是否允许 LLM 引用非 catalog 但受信任的第三方图片),需在评审阶段明确。

### 全局约定:安全/隐私硬项一览(**回填 A 更新 2026-07-06 晚**:P2/P8/P9/P10 已被 §十 后续轮次逐条过堂转定案,P3 被撤销取代,仅 P6 与消息长度上限仍 [提案待确认],速查表)

| 硬项 | 一句话 | 主落点 | 状态 |
|---|---|---|---|
| P2 | 外源内容(web_search 等)进上下文必须定界+标不可信 | S1.12 | **定案(回填自 SD-19)**——`<untrusted_web_result>` 定界 + 系统提示声明 + `detect_prompt_injection` 扩展覆盖工具返回内容 + 架构不变量(工具只读+结果不得升格为指令)+ 信源分级 |
| P3 | ~~工具边界中间件计时+token 成本累计,喂给 X4 熔断~~ | S1.12 | **已撤销,由 SD-18 usage 计量钩取代**——原计时部分砍掉(Logfire span 已覆盖,避免重复建设),改为 `result.usage()`→`daily_usage` 表 + 容器入口熔断 |
| P6 | SSE 事件带 turn_id+seq,断线不续传,断线后拉终态 | S1.1/S1.2/S1.6 | **[提案待确认]**(今按 SD-9 修订版 AI SDK 协议语境重述,见"全局约定:Chat 流式协议"节) |
| P8 | 出站请求 SSRF 守卫(https-only+封禁私网/环回/元数据 IP) | S1.11 | **定案(回填自 SD-20)**——严格版解析后 IP 校验(不重复解析防 TOCTOU/DNS rebinding,禁自动跟随重定向),不加域名白名单(挡死自部署 vLLM/中转商核心用例) |
| P9 | 精确 GPS 不进 Logfire,截断百米级,存储层全精度 | S3.3 | **定案(回填自 SD-21)**——坐标进 trace 前砍到小数点后 3 位;实现挂点=header allowlist 中间件顺带处理 |
| 消息长度上限 | 用户输入消息长度/类型上限(Guardrails 补条) | S1.12 | [提案待确认]（未被 §十/十一 覆盖） |
| P10 | payload schema_version + additive-only 演进 + 版本化降级渲染 | `packages/contract` + S1.1/S1.3-S1.5 | **定案(回填自 SD-13 规则②)**——additive-only 版本化,治理策略抄 MCP 弃用策略(Active/Deprecated/Removed,≥12 个月) |

**Coordinator 处理指引**:上表已定案条目可直接作为合并阻塞的硬门槛;**仅 P6、消息长度上限**仍需评审阶段带用户过一遍,确认后把状态从"[提案待确认]"改为"定案",或按用户意见调整/移除对应 AC。在用户就这两项明确表态前,Reviewer 不应把它们当作"必须通过才能合并"的硬门槛来卡 PR。

### 主会话设定的默认项(定案部分)

- PR #206(atlas CI 修复)列为**迭代 0 前置条件**——见 §⑩。
- `animal-island-ui-tailwind` 升级到 **1.0.x 最新**,兼容性验证进 S0.2/S0.5。
- **Zen Maru Gothic 自行 @import 为硬性 AC**。
- D7(REJECTED)、D9/D10(non-goal)、SD-3⑤、Supabase catalog 表实际删除——均不在本列车动手。
- Capacitor 推迟到环闭合后。
- **域名定案 `animichi.com`(SD-0)**——`CANONICAL_DOMAIN` 配置项名称保留,值从 S0.8 起直接写 `animichi.com`。
- 设计导出已入库,作为 Tester 视觉基准(oracle)。
- **Planner 补充默认(定案,本 spec 判断)**:
  1. `apps/web` 覆盖率地板从迭代 0 实测值起建。
  2. R2 bucket 复用同一个桶 `seichijunrei-assets`,前缀区分。
  3. `workers/catalog` Iteration 5 新增少量公开只读路由(`isPublicCatalog` 白名单模式),需 eng review 确认。
  4. 既有 agent 数据端点本列车不强制迁移/不强制砍。
  5. `pydantic-ai-guardrails` 僵尸依赖二选一处理(接入或移除),Planner 推荐移除——此为 Planner 代码核查发现,独立于下方"[提案待确认]"分层,不需要额外用户确认。
- **无内部 skill 框架** — 已由 SD-24③ 逐条过堂转定案(YAGNI,触发点=工具膨胀到 20+ → DD-9 冻结)。
- **MCP client(agent 主动消费第三方 MCP 能力,区别于迭代 7 对外发布 MCP server)推迟到真实需求出现** — 已由 SD-24② 逐条过堂转定案(→ DD-8 冻结)。

### 主会话设定的默认项([提案待确认]部分,inputs §八散点;**回填 A 更新**:MCP client/内部 skill 框架已移至上方"定案部分",此处仅剩未被后续轮次覆盖的散点)

- prompt 保持代码内管理(不上独立的 prompt 管理系统)。
- 生产会话抽样评分 — → **DD-17 冻结**(运营带宽 + 会话量 ≥500/周 触发,不是本列车工作项)。
- `greet_user`/`answer_question` 伪工具怪癖(实为输出整形器)记录不动,不重构。

### 用户附加 scope(SEO/GEO + 覆盖矩阵)已按迭代摊派,见迭代列车表与 §⑥。

---

## ③ 迭代列车总览表

| 迭代 | 主题 | Story 数 | 详细度 | 核心交付 | 文件 |
|---|---|---|---|---|---|
| 0 | 地基 | 9 | 全量细化 | apps/web skeleton + 部署链修复(worker/** CI 接线)+ 地图 ADR + eval 分层 + DS 底座 + spike 搬运 + 删旧前端 + SEO 地基(**回填自 SD-27**:域名迁移全清单 animichi.com + robots.txt/llms.txt 静态一页 + sitemap 骨架+IndexNow key + GSC/Bing/CF Analytics + Organization/WebSite/BreadcrumbList + CF 爬虫可达硬 AC,详见 `2026-07-06-seo-geo-plan.md` §7)+ 文档回写(`docs/ops/migrations.md`) | `2026-07-06-frontend-rebuild/iter-0.md` |
| 1 | 計画:Chat | **12** | 全量细化 | Chat Phase 1 单列流全态(44 态)+ **AI SDK UI 消息流协议**(SD-9 修订版定案,取代旧"三事件 SSE"表述,P6 断线语义仍提案细节)+ 匿名放开/配额/Turnstile/BYOK 三族(SD-11 定案,各自独立 story)+ P5 登录墙 + 首 token 硬性 SLO + `selected_route` 跨库 bug 修复 + **Agent 守卫强化**(S1.12,含 SD-19 注入防护[定案]+ SD-18 两新增 hook[定案]+ 消息长度上限[仍提案待确认]+ guardrails 僵尸依赖清债)+ 图搜阶段1(SD-26,chat"写真"态,LLM vision 粗筛认作品)+ 全信号埋点(飞轮1-5 燃料箱 + 图搜五信号,SD-22/23/26) | `iter-1.md` |
| 2 | 承接:详情+列表 | 9 | 全量细化 | 路线详情 v2 + マイルート本棚 + 保存/列表 enabler(`workers/users` oRPC + Neon)+ sessions 数据迁移;作品页事实台账(SD-15)相关字段随 chat 沉淀 | `iter-2.md` |
| 3 | 歩く:Walk | 9 | 开工前细化 | Graduation 转场 + Walk 10 态 + 离线一步到位 + 打卡 enabler(`workers/users` oRPC + Neon,含 **SD-21 定案** GPS 截断:trace 层砍到小数点后 3 位/百米级,存储层全精度)+ fox sprite + conversation_messages 数据迁移 | `iter-3.md` |
| 4 | 残す:しおり | 7 | 开工前细化 | しおり版式族(客户端图片管线,默认剥 EXIF)+ /s/:id 公开分享(SSR,动态 OG 回填自 SD-27)+ 対比図作成(客户端 canvas)+ R2 上传 + 图搜阶段2(SD-26,作品内精匹配机位:embedding 粗筛+LLM vision 精排)+ 対比図/対比図 image sitemap(SD-27) | `iter-4.md` |
| 5 | 発見:作品页+首页 | 8 | 开工前细化 | 作品公開页 A 図鑑型(SSR)+ catalog 新公开 oRPC 路由 + 数据质量门(X15)+ 首页(続きから只依赖 sessions/routes)+ programmatic SEO/GEO(**回填自 SD-27**:事实速览块三语+JSON-LD 收缩+地区页+新番 sitemap SLA+质量门进 CI,详见 `2026-07-06-seo-geo-plan.md` §7)+ 飞轮2 意图口味/飞轮4 SEO增长开始析(SD-22/23) | `iter-5.md` |
| 6 | 工作台 | 6 | 开工前细化 | Chat Phase 2 桌面双栏(地图常驻/lightbox/SP8/SP9) | `iter-6.md` |
| 7 | 开放接口 | 7 | 开工前细化 | eval gate 解禁 + **对外发布顺序按 SD-25**:agent skill(先行)+ 顺手粗粒度 MCP server(**A2A 押后,→ DD-10 冻结,不在本迭代做**)+ MCP(SD-12 定案:任务型能力,Workers 薄适配器)+ OpenAPI 发布 + npm SDK + Python client 转正 + MCP Apps 最小子集(SD-13)+ MCP-as-GEO 提交(SD-27:MCP Registry/mcp.so/Glama/isitagentready 自检)+ llms.txt 补 MCP endpoint(**不做 llms-full.txt,回填自 SD-27 负清单,取代旧版本此处的 llms-full.txt 提法**) | `iter-7.md` |

**依赖链**:Chat 产路线 → 详情/列表承接保存 → Walk 走路线 → 残す留成果 → 発見引新人 → 工作台增效 → 开放接口对外。

**Story 数超「3-8」guideline 的说明**:Iteration 0(9)/Iteration 1(12,匿名四拆分+44 态+新增 S1.12 守卫)/Iteration 2、3(各 9,数据迁移独立 story)/Iteration 7(7,SDK/MCP 展开)——均已按"单执行者一天可完成"逐条核实。

---

## ④ Releasable 定义

每个 story merge 到 main 后必须满足:

1. CI 全绿(lint + typecheck + test + coverage ratchet,不新增抑制注释)。
2. 打 tag 即可部署 prod,无需额外手动步骤。
3. 部署后**无死路 UI**——每个可见入口要么有真实现,要么按设计稿呈现降级态/空态,绝不裸白屏/裸报错。
4. `/healthz` 的 `git_branch` 字段可验证已部署到对应 commit。
5. 视觉与对应画布一致——Tester 用设计原稿逐态截图比对。
6. 三语(ja/zh/en)文案完整。

**注**:标注 [提案待确认] 的 AC(现仅剩 P6、消息长度上限、D16/D18/D19、Generative UI 宪法 URL 白名单细则——其余原提案待确认项已由 SD-13/18/19/20/21/24/25 逐条过堂转定案,见 §②)在用户未确认前,不构成 Releasable 的阻塞条件——即该 story 其余(定案)AC 全部通过时仍可合并/发布,提案待确认部分待 Coordinator 拿到用户结论后另行补齐或调整,不倒回卡住整个 story。

---

## ⑤ 全局 DoD

在 ④ 基础上叠加(定案部分):

- 每条 AC 有测试类型注解(`unit|integration|eval|browser|api`)且 `ac_total == ac_with_test`。
- 不新增任何 lint/type 抑制注释。
- 覆盖率阈值只升不降,新代码提升覆盖率时回填阈值配置。
- Lighthouse CI CWV 预算:LCP ≤2.5s、CLS ≤0.1,迭代 0 起生效。
- 素材类 story 含「用户过目收编」人工 AC。
- 每迭代结束 Tester 按对应画布逐态走查。
- **X8**:agent 行为面变更须先有 5-smoke PR 门禁 + 617 全量 nightly 跑通。
- **X3/SD-11**:BYOK 三 provider 族的密钥不落观测面,合并前须有 integration test。
- **X10**:camera/geo/haptics/wake-lock/clipboard 调用必须经 `apps/web/src/platform/`。
- **SD-2/G4**:新增后端能力先问三选一归属;禁止在 agent 服务新增数据端点。
- **X2/SD-4**:Chat 首 token warm p95 ≤3s 是硬性门禁。
- **SD-9(修订版)**:generative registry 组件声明 partial-tolerant 字段清单;协议为 AI SDK UI 消息流,自定义 data parts schema 进 `packages/contract`。
- **SD-13**:generative registry 组件 additive-only 版本化,`presentation_hint` 前端终裁未知值优雅降级。
- **SD-19**:web_search 等外源内容进上下文前完成定界+标不可信,架构不变量回归测试立此存照。
- **SD-20**:BYOK 三 provider 族出站请求经 P8 SSRF 出口守卫(解析后 IP 校验)。
- **SD-21**:精确 GPS 坐标不得进 Logfire trace,截断至小数点后 3 位(百米级)。

**[提案待确认]的 DoD 追加项**(用户确认前仅作为"已写入 AC、待生效"记录,不纳入强制门禁):P6 断线语义、消息长度上限、Generative UI 宪法 URL 白名单细则。

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
| 6 | `Chat 状态总览.html` | 实现(**主交付**) | S1.1–S1.12 | 44 态全量映射;含 C2t 帧(§⑧) |
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
| `docs/spec-chat-page-design.md` | 规范画布(权威五件套) | 地图部分按 X1 改读 MapLibre;流式协议部分按 **SD-9 修订版**改读 AI SDK UI 消息流(取代旧"三事件 SSE"读法) |
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

- **D7 Agent Pyodide Worker 化 / TS 重写 — 双双 REJECTED**(SD-4 终局)。
- **D9 Pulumi IaC 扩展**(R2 bucket 例外)、**D10 多环境**:均不做。
- **SD-3⑤ 远期 Neon Auth 迁移**(**→ DD-1 冻结**)、**Supabase catalog 表实际删除**:不进本列车。
- **既有 agent 数据端点整体迁移**:方向性已确认,不在本列车动手。
- **agent 认知循环架构改造**(D14):不新增路由/dispatch 层(路由层改造 **→ DD-2 冻结**)。
- **跨会话/全局用户记忆**(D15):不做(唤醒 **→ DD-3 冻结**)。
- **Capacitor 集成**:推迟到环闭合后。
- **catalog 独立部署 job 的历史遗留问题**:不在本列车修。
- **J16 同行协作**:原设计导出无对应页面,不产出。
- **Chat 规模场景 supercluster GL/mega-map(>500 点)**:按原判推迟。
- **しおり OG 竖图渲染管线的像素级实现细节**:留 Executor 开工前细化。
- **A2A server**(**回填自 SD-25,→ DD-10 冻结**,等企业编排侧真实信号):本列车只做 Skill + 顺手粗粒度 MCP server,A2A 不建;第三方合规认证同样只做功能性薄适配器。
- **BYOK provider 族扩展超出三家**:SD-11 首发范围明确三族。
- **生产会话抽样评分体系**(**→ DD-17 冻结**,运营带宽+会话量≥500/周触发):不是本列车工作项。
- **`greet_user`/`answer_question` 伪工具重构**:记录怪癖不动(默认项,回填自 SD-24 默认项确认)。
- **内部 skill 框架、mcp-client(消费第三方 MCP)**:均已由 SD-24 定案不做(**→ DD-9/DD-8 冻结**),非[提案待确认]。
- **产品 runtime 引入 subagent 扩展**:D17 已定案维持零 subagent(仅翻译子 agent),注入隔离子 agent **→ DD-4 冻结**(迭代 7 评估)。
- **(仍 [提案待确认],待用户确认前默认不做)** 模型分层(D19)、模型更换 eval 门禁的具体形式(D16)、BYOK 覆盖范围论证(D18)。
- **图搜层3(全库跨作品向量搜)、ANN 索引、embedding contrastive 微调**(**回填自 SD-26,→ DD-11/DD-12/DD-13 冻结**):本列车只做图搜阶段1(迭代1)+ 阶段2(迭代4),层3 与索引优化均待信号触发。
- **点位独立页(SEO)**(**回填自 SD-27,→ DD-14 冻结**):点位级 UGC 厚度不足前不拆分独立页,锚点 `/anime/:id#point-:pid` 承担分享。
- **llms-full.txt 维护管线、FAQPage schema、GA4、独立 GEO 预算/修辞优化**(**回填自 SD-27 负清单**):明确不做,详见 `2026-07-06-seo-geo-plan.md` §8。

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
| Q5 | 写真から探す保留? | **已由 SD-26 取代此处"推荐默认",转为定案两阶段架构**:阶段1(迭代1,S1.3)LLM vision 粗筛认作品,零索引白嫖 LLM 动漫世界知识,认不出走 clarify 降级(不阻塞主线,原"D1 兜底文案"表述并入 clarify 流程);阶段2(迭代4)作品内精匹配机位,embedding 粗筛[标配]+LLM vision 精排为主力。反向发现三层(世界知识→GPS附近搜→全库向量搜,层3 → DD-11 冻结) | SD-26(inputs §十一);generative-ui.md 组件目录 | S1.3(阶段1)、S4.6 附近(阶段2,与迭代4 対比図共享数据管线) |

### 8.3 C2t 帧

**正式采纳为规范**:`ds-审计.md` 已裁决"出发时间+地点必问",C2t 是该决策的具体实现,非孤立提案。落点 S1.3。

### 8.4 舞台毕业模型

**采纳**:已有完整 storyboard(F0-F5,时长/缓动已给出)。落点 S3.1。

### 8.5-8.7 — 全部已解决(RESOLVED)

D7 终判(SD-4)、用户域数据访问路径(SD-2)、域名(SD-0)三项此前记录的不确定性均已拍板。**回填 A 补充**:Generative UI 核心哲学(SD-13)、注入防护(SD-19)、BYOK+SSRF(SD-20)、GPS trace 截断(SD-21)、subagent/mcp-client 范围(SD-24)、对外发布顺序(SD-25)六项此前标"提案待议"的架构补章内容,已由 inputs §十经逐条过堂转定案,不再是本节意义上的"待用户过目"。

### 8.8 本 spec 的 [提案待确认] 项清单(需 Coordinator 带用户逐项过堂,**回填 A 更新:范围已收窄**)

**回填 A 更新(2026-07-06 晚)**:见 §② 标注表——D16-D19 表中现仅 D16/D18/D19 三项待确认(D17 已转定案);安全/隐私硬项速查表中现仅 P6、消息长度上限两项待确认(P2/P3/P8/P9/P10 已转定案或撤销);Generative UI 宪法中仅 URL 白名单细则待确认(核心哲学已转定案)。这些**不是**"未回答的开放设计问题"(不同于 8.1/8.2 那种需要 Planner 给推荐默认的场景)——它们是**已经写好完整方案、但流程上跳过了用户讨论**而被主会话叫停的内容,处理方式是"确认或调整",不是"从头设计"。

---

## ⑨ 风险登记

| 风险 | 影响 | 缓解 | 涉及 story |
|---|---|---|---|
| `wrangler.toml [assets]` 断链 + `worker/entry.ts` 硬编码 `.open-next/worker.js` | 不修则无法部署 TanStack 产物 | S0.3 替换为 `cloudflare-module` preset 产物,Hono 路由不变 | S0.3 |
| Zen Maru Gothic 字体缺失 | 全日文产品字体事故 | S0.5 vendor + CI 断言 | S0.5 |
| DS 对比度 FAIL 2 处 | WCAG AA 不达标 | 消费这两个 token 的组件加 a11y AC(≥4.5:1) | S0.5、S1.*、S3.* |
| `animal-island-ui-tailwind` 版本漂移 | 升级后组件 API/样式可能破坏性变更 | S0.2 锁 1.0.x 并跑视觉回归 | S0.2 |
| MapLibre+Protomaps 迁移是净新增(X1) | pmtiles 生成/托管可能超预期耗时 | S0.4 独立 spike,卡住时先用插画静态底图路径撑到 Iteration 1 | S0.4 → 阻塞 S1.4/S1.5 |
| 容器保温成本 vs SLO(X2,硬性)| 常驻实例=持续计费;定时 ping=冷启动仍可能撞上 | 需用户确认预算上限 | S1.2,owner=用户 |
| 全局日预算熔断阈值(X4)无具体数字 | 太低误伤、太高失效 | env 变量可配置,不写死 | S1.8,owner=用户 |
| BYOK 泄露面覆盖三 provider 族(X3/SD-11) | 只测一族会漏测其他两族 | S1.11 integration test 三族各自验证 | S1.11 |
| PR #206 未合并 | 阻塞迭代 0 CI 基线 | 列为硬前置条件 | 全局阻塞 |
| eval smoke 5 条具体选取(X8) | Planner 不掌握 617 条内容 | AC 只锁选取原则,具体 case 执行时定 | S0.1 |
| `apps/web` 覆盖率地板起点未知 | 无法写死具体百分比 | 实测后写入配置注释 | S0.2 |
| **catalog 首次公网暴露** | 新开 `/catalog/public/*` 白名单扩大攻击面 | 严格只读白名单,eng review 签字 | S5.4 |
| **R2 presign 路由新增在 root Worker** | 需防越权 presign | presign URL 按 JWT `sub` 限定前缀+短 TTL | S4.7 |
| **`workers/users` 是全新服务**,零既有基线 | 鉴权/CI/部署全部从零搭 | 完整参照 `workers/catalog` 模式克隆 | S2.8 |
| **SD-3① 跨库 bug 修复的回归风险** | 修 bug 可能引入新 bug | 修复前后两条路径数据形状快照对比测试 | S1.7 |
| **SD-3④ 历史数据迁移** | 一次性脚本仍有小概率遗漏 | 行数核对 + 抽样内容校验 | S2.9、S3.9 |
| **SD-5:会话状态 best-effort,无事务保证** | 已知且接受的过渡期风险 | 迁移到 Neon 后自然收敛 | 记录,不阻塞 |
| **SD-9 协议现状与终局定义之间的落差**(**回填 A 更正,风险已解除**:此前记为"三事件命名不完全对应"待对齐;SD-9 修订版已把 AI SDK UI 消息流/`VercelAIAdapter` 定为终局本身,现状即定案,不再有落差) | 原风险描述已失效,保留记录供审计 | S1.1/S1.2 的工作从"协议归属对齐"改为"确认 `/v1/chat` 现有实现符合 SD-9 修订版语义映射 + 补齐自定义 data parts schema + 验证 typed output 能否渐进流出" | S1.1、S1.2 |
| **`pydantic-ai-guardrails` 僵尸依赖** | 声明未导入,占依赖面不提供实际防护 | S1.6/S1.12 二选一处理(接入或移除) | S1.6、S1.12 |
| **[提案待确认]项被误当定案执行**(**回填 A 更新**:范围已收窄为 P6/消息长度上限/D16/D18/D19/Generative UI 宪法 URL 白名单细则;P2/P3/P8/P9/P10 已转定案或撤销,不再属于此风险):如果 Coordinator/Executor 跳过用户过堂环节,直接把剩余待确认项当成必须完成的硬门槛去卡 PR | 会重演"未经讨论就推进"的同一问题,浪费返工 | Coordinator 排期前必须先完成一轮用户过堂,把状态从"[提案待确认]"更新为"定案"或"调整"或"移除",再进入执行 | S1.1、S1.2、S1.6(P6)、S1.12(消息长度上限) |
| **若 P6 的"断线不续传"被用户否决** | S1.1/S1.2/S1.6 里已经按"不续传+GET messages 拉终态"写的 AC 需要返工为"支持续传"的替代方案 | 保留当前 AC 作为默认方案,注明依赖用户确认;返工范围仅限这几个 story,不影响 SD-9 修订版协议本身(AI SDK UI 消息流那部分定案不受影响) | S1.1、S1.2、S1.6 |

---

## ⑩ Dependencies(spec 级)

- **PR #206** 必须先合并。
- `ANON_DAILY_COST_BUDGET_USD` 初始阈值需用户提供(X4)。
- 容器保温预算上限需用户确认(X2)。
- S0.4(地图 ADR+spike)完成前,S1.4/S1.5/S2.2/S5.2 的地图 AC 不能开工。
- S5.4(catalog 首次公网暴露)需 eng review 签字后才能合并。
- S0.9 的 `docs/ops/migrations.md` 应先落地,S2.8/S2.9/S3.7/S3.9 的 Neon 迁移工作流参照它执行。
- S2.8(`workers/users` 首次搭建)是 S2.9/S3.7/S3.9/S4.5/S4.7 的地基。
- S1.1/S1.2(SD-9 修订版:确认 `VercelAIAdapter` 现状符合语义映射 + 补齐 data parts schema)是 S1.3-S1.7 全部 generative 组件的地基。
- **回填 A 更新**:S1.11(BYOK/P8)、S1.12(守卫/P2)、S3.3(Walk/P9)三个 story 的相关 AC 已转定案(SD-20/SD-19/SD-21),不再是待过堂项;仍需 Coordinator 显式规划"用户过堂"动作的仅剩 S1.1/S1.2/S1.6(P6)与 S1.12(消息长度上限)。

## ⑪ Verification Plan

- Coordinator 每迭代收尾:pull main → `supabase start` → `make serve` → `apps/web` 构建预览 → 等 `/healthz` 绿。
- Tester 逐迭代对照设计原稿做状态级截图走查。
- Reviewer 核对 `ac_total == ac_with_test`,Codecov patch ≥95%;对标注 [提案待确认] 的 AC,Reviewer 核实状态是否已被 Coordinator 更新为定案,未更新则不将其计入强制门禁。
- Iteration 5 发布后跑 `claude-seo` 插件审计出分。
- Iteration 7 依赖 X8 门禁已存在,跑 baseline → 变更后比对 `score >= baseline - 10pp`。
- 全部通过后 Tester 打 tag,CI 部署 prod。

**Planner 核实说明**:覆盖矩阵实测 `docs/design/2026-07-06-design-sync/` 顶层为 **24 个 `.html`**(`ls *.html | wc -l` 核实),与 inputs 文件行文"21"不一致,已按实测 24 个逐一归属。本 spec 经历 8 轮追加澄清,第 8 轮(inputs §八/§九)一度被主会话勘误为"未经用户讨论,降级为提案待议"。X15 的落点已更正为 S5.8(与 `iter-5.md` 的实际 story 归属对齐)。

**回填 A 补充说明(2026-07-06 晚,基于 inputs §十/十一逐条过堂结果)**:§八/§九标"提案待议"的内容此后经 inputs §十(Step1-Step8)/§十一逐轮用户过堂,**绝大部分已转定案**:SD-13(Generative UI 哲学+P10)、SD-15(记忆细化)、SD-16(Animichi 人设)、SD-17(prompt 补丁+长度治理)、SD-18(hook 两新增,原 P3 撤销)、SD-19(注入防护,原 P2)、SD-20(BYOK+P8)、SD-21(GPS 截断,原 P9)、SD-22/23(飞轮排期)、SD-24(subagent/mcp-client/skill 框架范围,含原 D17)、SD-25(对外发布顺序:Skill→MCP→A2A 押后)、SD-26(图搜两阶段)、SD-27(SEO/GEO,落地包见 `2026-07-06-seo-geo-plan.md`)。**同期 SD-9 本身被推翻重议**:三事件自定义 SSE 提案已被 AI SDK UI 消息流协议(via `VercelAIAdapter`)取代为终局(§十 Step2)。本次回填后,**仍处 [提案待确认] 的仅剩**:P6(SSE 断线语义细节)、消息长度上限、D16(模型更换门禁)、D18(BYOK 覆盖范围论证)、D19(不做模型分层)、Generative UI 宪法中 URL 白名单细则——这六项未见 inputs 任何后续轮次专项覆盖,仍需 Coordinator 带用户过堂确认。
