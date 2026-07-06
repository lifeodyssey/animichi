# Iteration 7 — 开放接口

详细度:**开工前细化**。Story 数:**9**(可执行 story;另有 S7.3「A2A」已冻结为占位说明,不计入本列车工作项——见 DD-10。原 7 个 - 1(A2A 冻结)+ 3 新增(S7.8/S7.9/S7.10)= 9)。

依赖顺序建议:S7.1(eval gate 解禁,独立先行)→ S7.8(工具类型化技术债清理,S7.4 前置)→ S7.5(OpenAPI 发布,可与 S7.8 并行)→ S7.4(MCP server,依赖 S7.8)→ S7.9(MCP Apps 最小子集,依赖 S7.4)→ S7.10(MCP-as-GEO 发布清单,依赖 S7.4)→ {S7.2(Claude Skill)、S7.6、S7.7}(可并行,依赖 S7.5 已发布)。S7.3(A2A)已冻结 → DD-10,不参与本迭代依赖链。

**SD-12 定案(对外能力形状,主 spec §②)**:迭代 7 的 MCP 对外只暴露**任务型能力**——`resolve_anime` / `search_points` / `plan_pilgrimage(anime, constraints)`,无状态、幂等、可缓存,是调用同一套既有容器 `/v1` 契约的薄适配器,**不暴露 chat 直通**。本迭代所有涉及 agent 行为面的变更必须先过 X8 的 eval 门禁(S7.1)。

**A2A 押后(回填自 SD-25③/DD-10)**:A2A 端点建设已冻结,登记于 `docs/deferred-decisions.md` DD-10(触发条件:企业编排侧真实信号/合作询盘/生态明确 C 端案例出现,类型=需求+外部)。本迭代不为 A2A 分配可执行 story——原 S7.3 位置改写为占位说明(见下),不写成本列车工作项。

**前置技术债(回填自 SD-25 前置清单)**:S7.4(MCP server)依赖 S7.8——9 个 `@agent.tool` 的 `dict[str,object]` 返回改 Pydantic 模型(`FastMCP.from_openapi` 生成 `outputSchema` 需要具名模型)+ `tool_state` 隐式时序改显式参数(照抄 catalog 契约形态)。

**SD-19 迭代 7 硬门槛(定案)**:入站——调用方需独立签名身份、工具 scope 默认只读、参数复用既有注入检测中间件、限流按调用方计数,已写入 S7.4 的硬 AC。出站规则(禁 token passthrough / 第三方工具描述当不可信 = 工具投毒防护 / URL SSRF 校验)主要面向"我方消费第三方 MCP"场景——该能力本身已冻结为 DD-8(mcp-client 推迟),故出站规则本迭代不产生新的工作项,仅作为 DD-8 解冻时的前置约束记入 Decision Log。

**注入隔离 sub-agent 的定位(回填自 SD-19/SD-24①/DD-4)**:注入隔离子 agent 在迭代 7 仅为**评估点**(视 eval G 族分数决定是否立项),不是承诺交付项;旧文若曾写死为交付项,以此为准改为 DD-4 冻结引用。

---

### S7.1 Eval gate 解禁 + baseline

**Scope**:在本迭代任何触及 agent 行为面的改动之前,先跑一次 617 全量 baseline;每个可能影响 agent 面的 story 完成后跑对比。

**设计依据**:无视觉画布;X8(S0.1 已建立的分层门禁,本 story 是使用方)。

**核心 AC**:
- 快乐路径:本迭代任何 agent 行为面改动前,捕获并记录一次 617 全量 baseline eval 结果 -> eval
- 快乐路径:S7.4/S7.8(即使是薄适配器/纯类型收窄)落地后的对比 eval 显示 `score >= baseline - 10pp` -> eval
- 空:若本迭代实际未发生任何 agent 行为改动(纯 Workers 侧适配器,零业务逻辑),对比 eval 平凡通过(无回归可报告)-> eval

**变更文件**:无新增业务代码;主要是 CI 流程执行与 eval 报告存档,若 baseline 捕获步骤尚不存在则在 `.github/workflows/` 新增。

**依赖**:S0.1(eval 分层门禁已存在)。

---

### S7.2 Claude Skill 发布(回填自 SD-25①,定案)

**Scope**:把巡礼规划能力(SD-12 的三个任务型能力)封装为标准 Claude Skill 包并分发,作为四壳中"零新基建、0.5-1 天"的第一顺位落地形态。

**设计依据**:无视觉画布;SD-25①(定案,官方口径 Skill↔MCP 互补:MCP 管连接、Skill 管方法论)。

**核心 AC**:
- 快乐路径:发布的 `SKILL.md` 遵循 Claude Skill frontmatter 规范——`name` ≤64 字符且等于技能目录名,`description` ≤1024 字符,准确描述 `resolve_anime`/`search_points`/`plan_pilgrimage` 三个任务型能力(与 SD-12 对齐,不描述 chat 直通)-> integration
- 快乐路径:技能包内 `scripts/` 目录包含 `seichijunrei_client.py`(与 S7.7 转正的 Python SDK 同源,见 S7.7 的关联说明)-> unit
- 快乐路径:技能包内 `references/` 目录包含巡礼礼仪(圣地巡礼マナー/摄影与隐私礼仪要点)参考文档 -> unit
- 快乐路径:技能可经 `npx skills add` 从公开渠道安装,或经 `POST /v1/skills` 端点程序化获取 -> integration
- 空:技能包零业务逻辑重复——所有实际调用委托给既有 `/v1` 任务型端点,不在 skill 内重新实现 resolve/search/plan 逻辑 -> unit(断言性质)

**变更文件**:`skills/seichijunrei-pilgrimage/SKILL.md`(新建,目录名即 skill name)、`skills/seichijunrei-pilgrimage/scripts/seichijunrei_client.py`、`skills/seichijunrei-pilgrimage/references/pilgrimage-etiquette.md`、新增 `POST /v1/skills` 分发端点(具体宿主服务留开工前细化)。

**已删除(回填自 SD-27/负清单)**:原「llms-full.txt」交付项已从本 story 移除。SD-27 定案「llms.txt 降级为静态一页,llms-full 管线砍掉」,数据依据为 Ahrefs 137K 站点日志实测 97% 零请求[实测]。Iteration 0 的 llms.txt v1 维持静态一页规格;本迭代仅在 S7.10 里为其追加一行 MCP endpoint 引用,不重新引入 llms-full 管线。

**依赖**:S7.5(OpenAPI/任务型能力已发布,skill 描述据此对齐)。

---

### S7.3 A2A 端点 —— 已冻结,见 DD-10(回填自 SD-25③)

**状态**:不建。SD-25③ 定案「A2A 押后:生态在企业编排侧,C 端弱相关,等真实信号」,已登记为 `docs/deferred-decisions.md` DD-10(触发条件:企业编排侧真实信号/合作询盘/生态明确 C 端案例出现,类型=需求+外部)。

本迭代不为 A2A 分配 story/AC/变更文件,不计入 Story 数与依赖链。若 DD-10 未来解冻,预期实现路径沿用本文件已确认的架构基座(既有 `/v1` 契约的薄适配器,复用 S7.8 的技术债清理成果与 S7.4 已验证的硬门槛模式),届时另开新 story,不追加占用本编号。

---

### S7.4 MCP server(FastMCP.from_openapi,回填自 SD-25②,定案)

**Scope**:用 `fastmcp` Python 库的 `FastMCP.from_openapi(openapi_spec)` 直接从既有(SD-12 范围的)公开 OpenAPI schema 自动生成 MCP server,暴露 `resolve_anime`/`search_points`/`plan_pilgrimage` 三个任务型工具;对齐 MCP 协议 2026-07-28 版本的无状态核心(stateless core)要求。

**设计依据**:无视觉画布;SD-25②(定案)+ SD-12(能力范围)+ SD-19(迭代 7 硬门槛)。

**架构注记(重要,供 Coordinator 排期核实)**:`fastmcp`/`FastMCP.from_openapi` 是 Python 生态的库,本 story 因此落在 `apps/agent`(既有 FastAPI 容器)侧,而非 Workers/TypeScript 侧——这与旧文档中曾假设"MCP server 是 Workers 上的薄适配器(TS)"不同,是本次回填按 SD-25②原文校正的架构调整,已在下方"变更文件"体现。

**前置**:S7.8(工具返回类型/`tool_state` 显式化——`FastMCP.from_openapi` 生成 `outputSchema` 依赖具名 Pydantic 模型,而非 `dict[str,object]`)。

**核心 AC**:
- 快乐路径:MCP 客户端可发现并调用 `resolve_anime`/`search_points`/`plan_pilgrimage` 三个工具,`outputSchema` 由 Pydantic 模型自动派生,收到结构化结果 -> integration
- 快乐路径:MCP server 是从公开 OpenAPI schema 自动生成的薄封装——变更 `openapi.json` 后重新生成即同步,不需要手改工具定义,不重新实现业务逻辑 -> unit(断言性质)
- 架构 AC:server 遵循 MCP 2026-07-28 无状态核心——不依赖服务器侧会话状态,每次工具调用自包含 -> integration
- 错误:携带无效/格式错误约束的工具调用返回规范的 MCP 错误响应,不是崩溃 -> integration
- **硬门槛(定案,回填自 SD-19,迭代 7 生效)**:入站——调用方需携带独立签名身份(不得复用最终用户会话凭据)-> integration;工具 scope 默认只读(与既有"9 工具全只读"架构不变量一致)-> unit;工具参数复用既有注入检测中间件(SD-19 P0 架构)-> integration;限流按调用方(而非全局)计数 -> integration

**变更文件**:`apps/agent/agent/interfaces/mcp_server.py`(新建,Python 侧,基于 `fastmcp` 库)、`apps/agent/pyproject.toml`(新增 `fastmcp` 依赖)。

**依赖**:S7.8(前置技术债)、S7.1(eval gate)。

---

### S7.5 OpenAPI 自动发布 + API 文档页

**Scope**:把 agent 既有的 FastAPI 自动生成的 OpenAPI schema 公开发布,并提供人类可读的文档页。

**设计依据**:无视觉画布;X11②;SD-25(单一真源 = 服务 API 层)。

**核心 AC**:
- 快乐路径:agent 的 FastAPI OpenAPI schema(框架自带自动生成,非本 story 从零构建)在公开可访问的 URL 上发布 -> integration
- 快乐路径:基于该 schema 渲染出人类可读的 API 文档页(如 Swagger UI/Redoc)-> browser
- 边界确认:catalog 的独立契约式 OpenAPI(`emit-openapi.ts`)保持非公开(除 S5.4 白名单路由外),不被本 story 意外整体暴露 -> unit(断言性质)

**变更文件**:`apps/web/src/routes/api-docs.tsx`(新增,渲染 Swagger UI/Redoc)、agent 侧确认生产环境已启用 OpenAPI schema 公开访问(若框架默认关闭需显式开启)。

**依赖**:无(可独立开工)。本 story 产出的 OpenAPI schema 是 S7.4 `FastMCP.from_openapi()` 的输入源(回填自 SD-25②),排期时建议提前于或至少同步于 S7.4。

---

### S7.6 `@seichijunrei/sdk` npm 包

**Scope**:发布 contract client 的薄壳 npm 包。

**设计依据**:无视觉画布;X11③。

**核心 AC**:
- 快乐路径:`npm install @seichijunrei/sdk` 后,用其类型化客户端调用公开的 `/v1` 任务型能力(SD-12)成功 -> integration
- 快乐路径:该 SDK 是对 oRPC/OpenAPI 派生类型的薄封装转发,不是业务逻辑的重新实现 -> unit
- 空:调用 SDK 方法时缺少必填参数在编译期(TS 类型)就报错,不需要真正发起网络请求才发现 -> unit

**变更文件**:`packages/sdk/`(新建包:`src/index.ts`、`package.json`)。

**依赖**:S7.5(OpenAPI 已发布,SDK 类型据此对齐)。

---

### S7.7 Python client 转正

**Scope**:把既有的手写 Python 客户端正式转正为官方发布、有版本、有测试的 SDK。

**设计依据**:无视觉画布;X11④;Planner 风险登记发现的 docstring 过时问题(见主 spec §⑨)。

**核心 AC**:
- 快乐路径:既有 `apps/agent/agent/clients/python/seichijunrei_client.py` 作为正式、有版本号、有测试覆盖的 Python SDK 发布(维持手写 httpx 客户端路线,不上 codegen)-> integration
- 快乐路径:该文件的 docstring/注释被修正,不再暗示"从 OpenAPI codegen 生成"(该暗示与 catalog-only 的 `emit-openapi.ts` 无关,是历史遗留误导)——改为明确标注"手写客户端,面向 agent `/v1/*` 能力面" -> unit
- 空:`search()` 方法对零结果作品返回良好类型化的空响应,不是异常 -> unit

**变更文件**:`apps/agent/agent/clients/python/seichijunrei_client.py`(docstring 修正 + 视需要补充 SD-12 任务型方法如 `plan_pilgrimage`)、发布说明文档、`pyproject.toml`(若需独立打包发布)。

**关联(回填自 SD-25①,待 Coordinator 确认)**:本 story 转正的 SDK 源文件与 S7.2 Claude Skill 包内 `scripts/seichijunrei_client.py` 是同一份手写客户端的两个分发面。若两处后续需要独立演进(例如 skill 包需要更精简的裁剪版本),需在两 story 排期时确认是否要拆分维护——本文件不擅自裁决,记入冲突清单。

**依赖**:无(可独立);建议与 S7.3/S7.4 的任务型端点命名保持一致。

---

### S7.8 Agent 工具类型化技术债清理(回填自 SD-25 前置清单)

**Scope**:为迭代 7 的 MCP server(S7.4)扫清类型面前置障碍——9 个 `@agent.tool`(`resolve_anime`/`search_bangumi`/`search_nearby`/`plan_route`/`greet_user`/`answer_question`/`clarify` 等)的返回值从 `dict[str,object]` 改为具名 Pydantic 模型;`tool_state` 从"调用顺序隐式约定"改为显式参数传递,形态照抄 `packages/contract` 的 catalog 契约风格。

**设计依据**:无视觉画布;SD-25(前置技术债清单)+ 自家 CLAUDE.md 类型规范(禁 `dict[str,object]`,禁隐式时序耦合)。

**核心 AC**:
- 快乐路径:9 个工具的返回值均为具名 Pydantic 模型(非 `dict[str,object]`),`mypy --strict` 通过 -> unit
- 快乐路径:`tool_state` 的读写通过显式函数参数/返回值传递(不是隐式共享可变字典的时序耦合),形态照抄 `packages/contract` 已用的契约风格 -> unit
- 回归:改造后跑一次对比 eval(见 S7.1),确认纯类型收窄不改变工具实际行为(intent/response 语义一致,`score` 不低于 baseline)-> eval
- 架构 AC:`FastMCP.from_openapi` 生成的 `outputSchema` 对应每个工具的具名模型字段,而非通用 object schema -> integration

**变更文件**:`apps/agent/agent/agents/tools.py`(或按现有文件拆分,各工具返回类型改造)、`apps/agent/agent/agents/models.py`(新增/调整 Pydantic 输出模型)、`apps/agent/agent/agents/tool_state.py`(如需新建,承载显式状态传递)。

**依赖**:S7.1(eval baseline 已捕获,本 story 改动需过对比 eval)。

---

### S7.9 MCP Apps 只读卡片最小子集(回填自 SD-13 Step1,定案)

**Scope**:用 `@mcp-ui/server` 把至少 TimedItinerary 打包为 `ui://` 只读资源,随 S7.4 的 MCP server 一并分发,支持跨宿主(Claude 及其他 MCP 客户端)内嵌渲染。范围严格限定为"最小子集",不为 ChatGPT 特有字段扩展。

**设计依据**:无视觉画布;SD-13 Step1(定案:"迭代 7 新增 MCP Apps 最小子集");`docs/deferred-decisions.md` DD-19(冻结:不为 ChatGPT 特有字段过度设计)。

**核心 AC**:
- 快乐路径:MCP 客户端调用 `plan_pilgrimage` 时,响应附带至少一个 `ui://` 只读资源(TimedItinerary 卡片),支持宿主内嵌渲染 -> integration
- 快乐路径:该 `ui://` 资源为只读(不接受宿主侧回写/交互事件),符合"最小子集"范围声明 -> unit(断言性质)
- 空:不支持 `ui://` 渲染的宿主仍能拿到可用的结构化数据(优雅降级为纯数据响应,不因缺少 UI 渲染能力而调用失败)-> integration
- 边界确认(回填自 DD-19):本 story 显式不做——ChatGPT 特有渲染字段扩展、除 TimedItinerary 外更多组件的打包——已记入 `docs/deferred-decisions.md` DD-19,不在本 story 范围内追加 -> unit(断言性质)

**变更文件**:`apps/agent/agent/interfaces/mcp_apps.py`(新建,或在 `mcp_server.py` 内扩展)、依赖清单新增 `@mcp-ui/server`。

**待确认(开工前细化,记入冲突清单)**:`@mcp-ui/server` 是 TypeScript/npm 生态的库,而 S7.4 的 MCP server 落在 Python(`fastmcp`)侧——两者的语言边界如何桥接(例如 Python 侧只生成符合 MCP UI 资源规范的 JSON,不直接依赖该 npm 包;或另起一个薄 Node 层专职渲染层)需要在开工前细化阶段确定,本 story 暂不预设具体桥接方案。

**依赖**:S7.4。

---

### S7.10 MCP-as-GEO 发布清单(回填自 SD-27 + seo-geo-plan.md §7)

**Scope**:MCP server(S7.4)上线后的 GEO 发现性收尾——提交 MCP Registry 与 mcp.so/Glama 目录,过 isitagentready 五维自检,给 Iteration 0 已上线的静态 llms.txt 补一行 MCP endpoint 引用。

**设计依据**:无视觉画布;`docs/superpowers/specs/2026-07-06-seo-geo-plan.md` §7 迭代 7 行("MCP-as-GEO:MCP Registry + mcp.so/Glama 提交 + isitagentready 五维自检 + llms.txt 补 MCP endpoint");SD-27(定案)。

**核心 AC**:
- 快乐路径:MCP server 元数据已提交至 MCP Registry 及 mcp.so/Glama 第三方目录 -> integration(以提交记录/核对清单形式验证)
- 快乐路径:过 isitagentready 五维自检,自检结果存档 -> integration
- 快乐路径:`llms.txt`(Iteration 0 静态一页版本)新增一行 MCP endpoint 引用,不改变其"静态一页"定位 -> unit
- **负清单确认(回填自 SD-27/负清单,防回潮)**:本 story 明确不建 llms-full.txt 维护管线,数据依据为 Ahrefs 137K 站点日志实测 97% 零请求[实测]-> unit(断言性质)

**变更文件**:`apps/web/public/llms.txt`(追加 MCP endpoint 行)、提交材料/自检记录(存档于 `docs/ops/` 或等效位置,具体留开工前细化)。

**依赖**:S7.4(MCP server 已上线可供登记)。
