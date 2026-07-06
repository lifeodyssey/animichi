# 会话进度存档(无损底档) — 2026-07-06

> 本文件是本次 system design 长会话的**完整无损进度存档**,防丢底档。
> 已定案决策全部在 `2026-07-06-frontend-rebuild-inputs.md`(第一~十一节,SD-1~24 + X1-X15 + 飞轮手册),此处不重复,只引用编号 + 记录**尚未落入 inputs 的进行中讨论**。
> 配套接手文档(给新 agent):见 OS 临时目录 `/tmp/seichijunrei-handoff-2026-07-06.md`。

## 一、我们在做什么

基于 `~/Downloads/前端设计同步.zip`(claude.ai/design 项目导出)为 Seichijunrei(动漫圣地巡礼)做:前端重建 spec + 后端架构评审 + agent 架构 system design。流程走过:三路盘点(设计资产/代码现状/架构台账)→ grill-me 钉 scope → 派 Planner 写 spec → 逐项 system design interview。

**用户的元要求(贯穿全程,务必遵守)**:
- 每个 story 独立可发布(releasable)
- 用 sub agent 省 token(调研用 sonnet;核心方案设计用 fable5)
- 覆盖每一张设计稿(87 文件,顶层 21-24 个 html 全归属)
- 架构/技术选型不合适的可以推翻
- **逐步讨论,不擅自定**(用户对"不讨论就定"极敏感,曾因此中断;每个决策先给判断+论证+推荐,再让用户拍板)
- 讨论要有 system design interview 的质感(讲清 what/why/权衡,不抛问卷)
- 需要业界最新实践时派代理"上网搜一下最新的"(我的知识截 2026-01)
- **重构授权(2026-07-06)**:既有代码不合适可重构、无向后兼容义务;三纪律=boy-scout 自由/结构级立 story/过 check+eval 门禁(X16)
- **spec 用英文**(2026-07-06):9 spec 文件+seo-geo-plan=英文;inputs/底档/DD 台账=中文(SD-30 内记录)

## 二、权威文件(引用,勿复制)

- **worktree**:`.claude/worktrees/frontend-rebuild`(分支 `feat/frontend-rebuild`,基于 main `02cd7fa`)
- **输入总账**:`docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md` —— 决策登记册 G1-G8、默认项、用户附加 scope、迭代列车 0-7、三路盘点报告 A/B/C、第六~十一节 X1-X15 + SD-1~24 + 飞轮运行手册。**这是唯一权威输入**。
- **主 spec**:`docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md`(Planner 产出 399 行)
- **迭代 spec**:`docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md ~ iter-7.md`(67 story,289 AC,覆盖矩阵 24 html)
- **域名调研**:`docs/superpowers/specs/2026-07-06-domain-research.md`
- **设计导出**:`docs/design/2026-07-06-design-sync/`(Tester 视觉 oracle;5 份权威 md:user-journey/DESIGN/spec-chat-page-states/spec-chat-page-design/spec-route-detail)

⚠️ **Planner 的 9 个 spec 文件写于 SD 讨论早期**,SD-13~24 大量决策是之后定的,**需在评审阶段统一回填**(见任务 #5)。inputs 文件是最新真相,spec 文件滞后。

## 三、已定案清单(全在 inputs,只列编号 + 一句话)

**grill-me 定案(G1-G8)**:G1 基线=main 新分支 apps/web 迁代码不迁历史;G2 大爆炸切流;G3 SPA+选择性SSR(/s/:id,/anime/:id);G4 全栈纵切 enabler;G5 Chat 先行 8 迭代;G6 Walk 离线一步到位(迭代3);G7 匿名 Chat 全放开+Turnstile+配额+BYOK;G8 素材 AI 生成+用户过目。

**迭代列车**:0 地基 / 1 計画Chat / 2 详情+列表 / 3 歩くWalk / 4 残すしおり / 5 発見作品页+首页 / 6 工作台Phase2 / 7 开放接口。

**架构补充 X1-X15**(已过堂部分):X1 地图=MapLibre+pmtiles on R2;X2 chat首token SLO warm p95≤3s+保温;X3 BYOK Logfire scrub;X4 全局日预算熔断;X5 edge认证模型变更;X6 图片管线客户端化+剥EXIF;X7 SW对SSR路由network-first;X8 eval分层;X9 D7 Pyodide REJECTED;X10 平台适配层apps/web/src/platform;X11 SDK战略契约即产品;X12 agent去数据化+enabler归属规则;X13已撤回;X14 worker已TS+测试缺CI接线;X15 catalog数据质量门。

**SD interview 定案(SD-0~24,inputs 第七~十一节)**:
- SD-0 域名=animichi.com(kitsunavi.com 品牌升级备选)
- SD-1 双链+atlas-provider-drizzle(Drizzle TS schema 唯一真相)
- SD-2 用户域 API-first /v1/users/* oRPC;supabase-js 仅 auth
- SD-3 Supabase 纯 auth 化+数据归 Neon;selected_route 跨库混读修复进迭代1
- SD-4 **Python 容器定案不再议**(TS agent SDK 调研知情:Vercel AI SDK 可行但需自养重试基建,pydantic-ai 护城河保留);Eve 框架=Vercel 6月新品,平台锁定 CF 冲突,不采
- SD-5 会话状态沿用现有端点
- SD-6/X14 worker TS+测试接 CI
- SD-7 维持工具循环(ReAct 血统)+确定性旁路,不加路由层
- SD-8 per-session 记忆;user_memory 休眠
- SD-9 **AI SDK UI 消息流协议 via VercelAIAdapter**(5月 revert 系中途修复已重新落地;三事件语义:step徽章←tool parts / 渐进卡片←data parts同ID覆盖 / 等待仪式←前端状态机)
- SD-11 BYOK=pydantic-ai 原生多 provider(OpenAI兼容/Anthropic/Gemini 三族)
- SD-12 对外=任务型能力(resolve_anime/search_points/plan_pilgrimage 无状态幂等)
- SD-13 genUI 哲学A(语义payload+应用registry)+三规则(append-only卡片流/additive-only版本化抄MCP弃用策略/partial-tolerant)+presentation_hint服务端建议前端终裁+迭代7 MCP Apps最小子集
- SD-15 memory 事实台账 typed 化(带时间戳+supersede语义)+领域数据即记忆+压缩保留逐字片段
- SD-16 狐狸人设 A克制版+名字统一 Animichi(叫声コン日文独享降爱称)+五条persona规则
- SD-17 prompt 四补丁(few-shot打混淆/工具描述补何时不用/语言判定消歧/Field description)+长度治理2K红线+缓存序纪律
- SD-18 hook=usage计量+错误边界钩→D1-D9
- SD-19 注入防御全档 P0/P1/P2(定界+架构不变量+信源分级+Llama Prompt Guard 2)+eval G族+迭代7硬门槛
- SD-20 BYOK 透传不落盘+P8解析后IP校验SSRF(不加域名白名单,防vLLM式parser differential)+配额分层
- SD-21 trace 百米GPS截断
- SD-22/23 五飞轮排期+运行手册+self-evolve边界(人在环批准)
- SD-24(部分)运行时 subagent/skill/mcp-client 都不扩张
- SD-25 对外形态=OpenAPI 单一真源+四壳薄适配;顺序 Skill→MCP(FastMCP.from_openapi)→A2A 押后;前置清 dict→Pydantic/tool_state 显式参数;**agent 架构 8 步全绿**
- SD-26 图搜全定案=两阶段(vision 认作品→系列级候选;emb 粗筛标配+LLM vision 精排主力)+不建 ANN 索引+评测矩阵定终选+反向发现三层(LLM 直认/GPS 附近搜/全库 future)+图搜埋点信号
- SD-27 SEO/GEO 全定案=页面矩阵+爬虫政策+llms-full 砍+MCP-as-GEO+质量门+三语;落地包+迭代映射=2026-07-06-seo-geo-plan.md
- SD-28 路程规划全定案=层0 haversine×1.3(迭代1)/层1 OSRM 移迭代3 随 Walk/层2 铁路拓扑估算全自建(ekidata.jp+N02 令和7,条款已核绿灯;建图 join 邻接+station_g_cd 换乘组;精确时刻深链;验证 AC+埋点)/层3 → DD-21;Google Routes 出局(ToS 禁缓存);两轮作废版(深链MVP/兜底链)复审理由=估算链上时刻表级是假精度
- SD-26 管线补章 D1-D6=阶段1 独立 vision 调用基线/match_scene 单工具(粗筛+精排≤2批)/索引管线归 catalog/内含 LLM 工具三纪律/vision 供给决策树(BYOK→平台Gemini→引导卡,探测+金丝雀)/视觉注入硬 AC+图搜按次配额
- SD-29 检索总纲=结构化优先的 agentic 检索;不引 RAG 框架;检索器按数据形态分配;embedding 通则系统 key;文本向量→DD-22
- 回填冲突 C1-C6 已裁决(2026-07-06-backfill-conflicts.md):C1=routes 并入 S2.9/C2=MCP server 暂定 Python 迭代7复核/C3=SEO 归迭代5 笔误已修/C4C5=确认/C6=照推荐;spec 文字补丁待打
- 延迟决策登记册 docs/deferred-decisions.md 建成(DD-1~22 + agent 巡检指令)

## 四、进行中/待确认(**尚未落 inputs,有损风险最高,务必保全**)

### Step 8 对外形态 → **已定案 SD-25**(2026-07-06 晚用户确认,全文在 inputs 第十节)

OpenAPI 单一真源 + 四壳薄适配;顺序 Skill→MCP(FastMCP.from_openapi)→A2A 押后;前置清 dict→Pydantic + tool_state 显式参数。**agent 架构 8 步全绿。**

### 图片搜索(任务 #7)→ 架构与排期**已定案 SD-26**(2026-07-06 晚用户确认,全文在 inputs 第十节)

**已全部定案**(2026-07-06 晚,含用户三轮质疑修正:real.jpg 不存在/规模系列级 1000+/索引不建;反向发现三层;图搜埋点信号)。全文见 inputs 第十节 SD-26。任务 #1 关闭。

## 五、剩余排队(TaskList #5/#7/#8)

- **#7 图片搜索**:✅ 全定案(SD-26),关闭。
- **#8 SEO/GEO 方案**:✅ 全定案关闭(SD-27 + 落地包 `2026-07-06-seo-geo-plan.md` 含迭代映射/负清单/L3 增长分析);另建 `docs/deferred-decisions.md`(DD-1~20 延迟决策登记册 + agent 巡检指令)。
- **批量修订 spec**:把 SD-13~24 决策回填 Planner 的 9 个 spec 文件(它们写于早期,滞后)。
- **#5 双评审**:Fable 5(reviewer型,审AC质量/releasable/设计权威冲突)+ Codex(codex-rescue,第二视角;注意 codex 大报告易崩,要求增量写文件,崩了从 job log 提取)。
- **交付**:commit 到 feat/frontend-rebuild + 向用户汇报。

## 六、恢复时的下一步

全部功能域讨论收口(SD-0~30 + DD-1~24,2026-07-06 深夜)。回填四代理完成后,统一补丁四代理(C1/C2/C6 + SD-26补章D1-D6/28/29/30 回填 + **9 spec 全文英文化**)进行中。补丁完成 → **双评审**(Fable5 reviewer + Codex codex-rescue 增量写文件防崩),评审新增产出:**详细度热力图**(67 story × full/adequate/thin)+ iter-0/1 thin story 立即补清单(2026-07-06 用户批准);iter-3/4 四薄点(Walk GPS/打卡防伪/対比図对齐/离线打包)= DD-24 留迭代3 开工前。评审意见回修 → 交付总汇报(建议下一步 /iteration-execution)。

## 七、后台代理(均已完成,勿重复派)

设计盘点、代码盘点、架构台账、TS-SDK对标、后端核证、域名调研、genUI最新、memory最新、prompt审计、文案语气、注入防护、BYOK实现、对外形态审计、Eve对标 —— 全部已回,结论已并入 inputs 或本文件。

## 八、建议下次 invoke 的 skill

- `iteration-execution`(spec 定稿后,把 spec 转 cards + wave graph + 执行 Executor→Reviewer→Tester)
- `pgvector-semantic-search` / `neon`(图片搜索阶段2实现时)
- `claude-seo` 系列(任务#8 SEO/GEO)
- `code-review` ultra 或 reviewer/executor 子代理(双评审)
