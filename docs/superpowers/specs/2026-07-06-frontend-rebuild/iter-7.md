# Iteration 7 — 开放接口

详细度:**开工前细化**。Story 数:7。

依赖顺序建议:S7.1(独立,先行)→ {S7.3, S7.5}(可并行)→ S7.4(依赖 S7.3 的底层实现)→ {S7.2, S7.6, S7.7}(可并行,依赖前面几项分别就绪)。

**SD-12 定案(对外能力形状,主 spec §②)**:迭代 7 的 MCP/A2A 对外只暴露**任务型能力**——`resolve_anime` / `search_points` / `plan_pilgrimage(anime, constraints)`,无状态、幂等、可缓存;两者都是 Workers 侧薄适配器,调用同一套既有容器 `/v1` 契约,**不暴露 chat 直通**。本迭代所有涉及 agent 行为面的变更必须先过 X8 的 eval 门禁(S7.1)。

---

### S7.1 Eval gate 解禁 + baseline

**Scope**:在本迭代任何触及 agent 行为面的改动之前,先跑一次 617 全量 baseline;每个可能影响 agent 面的 story 完成后跑对比。

**设计依据**:无视觉画布;X8(S0.1 已建立的分层门禁,本 story 是使用方)。

**核心 AC**:
- 快乐路径:本迭代任何 agent 行为面改动前,捕获并记录一次 617 全量 baseline eval 结果 -> eval
- 快乐路径:S7.3/S7.4(即使是薄适配器)落地后的对比 eval 显示 `score >= baseline - 10pp` -> eval
- 空:若本迭代实际未发生任何 agent 行为改动(纯 Workers 侧适配器,零业务逻辑),对比 eval 平凡通过(无回归可报告)-> eval

**变更文件**:无新增业务代码;主要是 CI 流程执行与 eval 报告存档,若 baseline 捕获步骤尚不存在则在 `.github/workflows/` 新增。

**依赖**:S0.1(eval 分层门禁已存在)。

---

### S7.2 Agent skill 发布 + llms-full.txt

**Scope**:发布描述巡礼规划能力的 skill manifest;生成 llms-full.txt(在 Iteration 0 的 llms.txt v1 基础上扩展为全量机器可读内容)。

**设计依据**:无视觉画布;inputs SEO scope 迭代 7;G7(agent skill)。

**核心 AC**:
- 快乐路径:发布的 skill manifest 描述巡礼规划能力及其任务型输入输出(与 SD-12 的三个任务对齐)-> integration
- 快乐路径:llms-full.txt 生成并可访问,内容覆盖全站机器可读摘要 -> unit
- 空:生成时 catalog 数据稀疏,llms-full.txt 仍产出合法(即使较小)的文档,不是空文件/损坏文件 -> unit

**变更文件**:`apps/web/public/llms-full.txt`、skill manifest 文件(如 `apps/web/public/.well-known/skill.json` 或等效约定,具体格式留开工前细化确定)。

**依赖**:S5.6/S5.7(SEO 基建)。

---

### S7.3 A2A 端点(任务型能力,SD-12 定案)

**Scope**:发布 A2A 协议端点,只暴露 `resolve_anime`/`search_points`/`plan_pilgrimage(anime, constraints)` 三个无状态幂等任务。

**设计依据**:无视觉画布;SD-12(定案)。

**核心 AC**:
- 快乐路径:A2A 端点精确暴露 `resolve_anime`/`search_points`/`plan_pilgrimage(anime, constraints)` 三个任务,均无状态、幂等、可缓存 -> integration
- 快乐路径:对 `plan_pilgrimage` 用相同输入重复调用返回等效的可缓存结果(验证幂等性)-> integration
- 错误:该端点**不**暴露任何 chat 直通能力(反向验证:没有任何路由/方法接受自由格式对话输入并像 `/v1/chat` 一样流式返回)-> integration
- 架构 AC:A2A 端点是调用既有容器 `/v1/*` 能力端点的 Workers 侧薄适配器,零重复业务逻辑(通过测试断言 handler 是委托调用而非重新实现业务逻辑)-> integration

**变更文件**:`workers/a2a/src/index.ts`(新建服务,或作为 root Worker 新路由,具体拓扑留开工前细化),复用既有 `/v1` 契约。

**依赖**:S7.1(eval gate 已就绪)、既有 agent `/v1/*` 能力。

---

### S7.4 MCP server(同一任务型能力,薄适配器)

**Scope**:发布 MCP server,暴露与 S7.3 相同的三个任务型能力。

**设计依据**:无视觉画布;SD-12(定案)+ X11⑤。

**核心 AC**:
- 快乐路径:MCP 客户端可发现并调用 `resolve_anime`/`search_points`/`plan_pilgrimage` 三个工具,收到结构化结果 -> integration
- 快乐路径:MCP server 是薄 Workers 侧封装,委托给与 A2A(S7.3)相同的 `/v1` 端点,两个适配器之间无重复逻辑 -> integration
- 错误:携带无效/格式错误约束的 MCP 工具调用返回规范的 MCP 错误响应,不是崩溃 -> integration

**变更文件**:`workers/mcp/src/index.ts`(新建,或复用 S7.3 的底层调用逻辑)。

**依赖**:S7.3(共享底层 `/v1` 调用逻辑)。

---

### S7.5 OpenAPI 自动发布 + API 文档页

**Scope**:把 agent 既有的 FastAPI 自动生成的 OpenAPI schema 公开发布,并提供人类可读的文档页。

**设计依据**:无视觉画布;X11②。

**核心 AC**:
- 快乐路径:agent 的 FastAPI OpenAPI schema(框架自带自动生成,非本 story 从零构建)在公开可访问的 URL 上发布 -> integration
- 快乐路径:基于该 schema 渲染出人类可读的 API 文档页(如 Swagger UI/Redoc)-> browser
- 边界确认:catalog 的独立契约式 OpenAPI(`emit-openapi.ts`)保持非公开(除 S5.4 白名单路由外),不被本 story 意外整体暴露 -> unit(断言性质)

**变更文件**:`apps/web/src/routes/api-docs.tsx`(新增,渲染 Swagger UI/Redoc)、agent 侧确认生产环境已启用 OpenAPI schema 公开访问(若框架默认关闭需显式开启)。

**依赖**:无(可独立开工)。

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

**依赖**:无(可独立);建议与 S7.3/S7.4 的任务型端点命名保持一致。
