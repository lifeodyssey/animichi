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

## 四、进行中/待确认(**尚未落 inputs,有损风险最高,务必保全**)

### Step 8 对外形态(研究已回,待用户点头才落档)

研究代理(a55d9b422d7c61d15)结论:
- **「一份 @agent.tool 直接生成四壳」不可行** —— 工具绑死 RunContext/RuntimeDeps/tool_state 时序,pydantic-ai 无导出机制(issue #4330 未解)。
- **「一份服务契约(OpenAPI)+ 四壳薄适配」可行,业界成熟模式** —— 单一真源在**服务 API 层**(packages/contract zod→OpenAPI + /v1),不在 agent 框架层。@agent.tool 只是该内核的"pydantic-ai 视图"。
- **落地顺序(推荐,待用户确认)**:① 先 Claude Skill(0.5-1天,零新基建;seichijunrei_client.py docstring 已自称 "for async agents/skills",半成品;SKILL.md+client进scripts/+巡礼礼仪进references/)② 顺手粗粒度 MCP server(`FastMCP.from_openapi(openapi.json)` 白嫖,对齐 MCP 2026-07-28 无状态核心)③ A2A 押后(生态在企业编排侧,C端弱相关)。
- **前置技术债(顺手清)**:9 工具 `dict[str,object]` 返回→Pydantic 模型(违反自家 CLAUDE.md 类型规范+MCP outputSchema 需要);tool_state 隐式时序→显式参数(catalog 契约已此形态,照抄)。
- Claude Agent Skills 现状:SKILL.md frontmatter(name≤64须等目录名 + description≤1024 + 可选 compatibility/metadata/allowed-tools),渐进披露3级,分发走文件系统/`/v1/skills` API/npx skills add;官方口径 Skill↔MCP 互补(MCP管连接,Skill管方法论)。
- **待办**:用户点头 → 落 SD-25 → step 8 关 → agent 架构 8 步全绿。

### 图片搜索(任务 #7,讨论进行中)

已达成:
- **文本 RAG 不引入**(结构化数据 SQL/PostGIS 精确查询,套向量是负优化,同 memory 那轮"领域数据即记忆");图片搜索≠RAG,是视觉问题。
- 用户选了野心边界=**「认到具体场景/机位」**(不只认作品),这锁定要上向量检索。
- **独家资产洞察**:Anitabi 每点位带「动画帧+现实照片」配对(compare/anime.jpg+real.jpg),是跨域匹配的天然训练/匹配对;+飞轮3闭环(用户打卡现场照→越用越准)。
- **两阶段架构(缝合路径A+B)**:阶段1 LLM vision 粗筛认作品(搜索空间几万点→单作品几十点)→ 阶段2 作品内向量精匹配机位(规模已压到几十,pgvector on Neon 绰绰有余)。跨域难点=动画帧↔现实照,通用CLIP打折。
- **分层排期**:阶段1(认作品)进迭代1(chat「写真」态入口,复用现有resolve);阶段2(认场景/机位)进迭代4(和対比図迭代4/Walk机位迭代3共享参考图数据,顺路建索引最省)。

**两个待定(恢复时问用户)**:
1. 两阶段架构+分层排期认不认?
2. 阶段2 embedding 选型(多模态LLM vision embedding / 专用CLIP·DINOv2 / 动漫专用模型 / BYOK)—— 主会话倾向**派代理核实2026最新跨域/动漫场景图搜最佳实践**再拍,已问用户"要我派吗",等答复。

## 五、剩余排队(TaskList #5/#7/#8)

- **#7 图片搜索**(in_progress):见上,卡在 embedding 选型待派代理。
- **#8 SEO/GEO 方案**(pending):inputs 已 sketch(迭代0技术SEO地基/迭代4动态OG/迭代5 programmatic SEO+GEO可摘引事实块+AI爬虫策略/迭代7 llms-full+MCP),待展开为正式方案。含 animichi.com 迁移SEO影响、sitemap/JSON-LD细节、claude-seo插件审计工序衔接。
- **批量修订 spec**:把 SD-13~24 决策回填 Planner 的 9 个 spec 文件(它们写于早期,滞后)。
- **#5 双评审**:Fable 5(reviewer型,审AC质量/releasable/设计权威冲突)+ Codex(codex-rescue,第二视角;注意 codex 大报告易崩,要求增量写文件,崩了从 job log 提取)。
- **交付**:commit 到 feat/frontend-rebuild + 向用户汇报。

## 六、恢复时的下一步

用户此刻在图片搜索 embedding 选型处,已收到"要不要派代理核实最新实践"的提问。**恢复时先等用户答这个 + 两阶段架构认不认**,再继续任务 #7,然后 #8 SEO/GEO,最后批量修订 spec + 双评审 + 交付。

Step 8 对外形态的推荐也待用户一句"采纳吗"。可一并确认。

## 七、后台代理(均已完成,勿重复派)

设计盘点、代码盘点、架构台账、TS-SDK对标、后端核证、域名调研、genUI最新、memory最新、prompt审计、文案语气、注入防护、BYOK实现、对外形态审计、Eve对标 —— 全部已回,结论已并入 inputs 或本文件。

## 八、建议下次 invoke 的 skill

- `iteration-execution`(spec 定稿后,把 spec 转 cards + wave graph + 执行 Executor→Reviewer→Tester)
- `pgvector-semantic-search` / `neon`(图片搜索阶段2实现时)
- `claude-seo` 系列(任务#8 SEO/GEO)
- `code-review` ultra 或 reviewer/executor 子代理(双评审)
