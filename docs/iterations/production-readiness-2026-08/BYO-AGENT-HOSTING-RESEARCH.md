# BYO-Agent 宿主平台化调研

> 决策快照：2026-08-29；仓库基线：`eba12971c`；外部规范固定为 MCP `2026-07-28`、A2A `v1.0.1`。
> 记号：**[F]** 可核事实；**[I]** 基于事实的设计推断；**[U]** 尚无足够证据。本文是架构/许可研究，不是法律意见。

## 结论先行

- **[I] 推荐 A，且仅推荐到“能力提供者”这一层**：Animichi 保持 task-shaped HTTP API，再增加一个无状态、只读、薄适配的 remote MCP surface；调用方自己的 agent、模型、会话与 BYOK 都留在调用方。MCP 当前 GA 核心正是无状态 request/response，HTTP transport 可按请求返回 JSON 或 SSE；这与当前 catalog Worker 的无状态边界相合（[MCP GA](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/blog/content/posts/2026-07-28-spec-ga/index.md)、[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[本仓库架构](../../ARCHITECTURE.md)）。
- **[I] A 现在只可做内部/受邀、合成数据 conformance pilot，不能公开发布真实 catalog 数据**：Bangumi 的缓存/再分发/商业授权仍是 **[U]**，Anitabi 点位许可是 CC BY-NC-SA 4.0，且截图/封面还存在独立权利链；当前公共 `Point` 又缺 `origin_url`、license 与 attribution（[Anitabi API](https://github.com/anitabi/anitabi.cn-document/blob/main/api.md)、[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)、[Point schema](../../../packages/contract/src/models.ts)）。
- **[I] B（A2A gateway）当前 no-go**：只有当至少两个真实合作方要求异步 task/artifact/push，而 MCP/HTTP 工具调用表达不了时才升级。A2A 的价值是远程 agent 的 Agent Card、task 状态机与 artifact，而不是更好的 catalog 工具协议（[A2A v1.0.1](https://github.com/a2aproject/A2A/releases/tag/v1.0.1)、[A2A specification](https://a2a-protocol.org/latest/specification/)）。
- **[I] C（托管第三方代码/runtime）当前明确 no-go**：它把软件供应链、隔离、秘密、任意 egress、计量、数据删除和运行时 SLO 一并变成 Animichi 的责任；AWS AgentCore 与 Cloudflare Sandbox 的官方边界说明，这是一整套执行平台而非 MCP 的自然下一步（[AgentCore runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)、[Cloudflare Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)）。

## 1. 已核仓库基线

- **[F]** catalog 的跨服务 schema 单一来源是 Zod/oRPC [`catalogContract`](../../../packages/contract/src/contract.ts)，现有操作为 `search`、`resolve`、`pointsByBangumiId`、`spots`、`nearby`、`geocode`、`planItinerary`、`animeOverview`、`popular`；不存在一个可直接映射的 `plan_pilgrimage(anime,constraints)` 操作。
- **[F]** edge 只信任自己验证后的 Neon Auth 身份，剥离来访 bearer、伪造的 `X-User-*` 和 `x-byok-endpoint`，再注入内部身份（[`forward.ts`](../../../workers/edge/src/gateway/forward.ts)）。`SERVICE_CREDENTIAL`/`svc:` 已在 rate policy 建模，但注释明确说明尚无路由接线（[`rate-policy.ts`](../../../workers/edge/src/gateway/rate-policy.ts)）。
- **[F]** 当前身份合同只有 public/anonymous/authenticated 三类，没有 tenant、OAuth client 或 agent principal（[`identity-contract.ts`](../../../packages/contract/src/identity-contract.ts)）。因此“现有用户 JWT 直接等于 MCP 机器身份”没有证据。
- **[F]** SD-12 要求 task-shaped、幂等/可缓存的能力；SD-25 的路线是 Skill → coarse MCP → A2A，并把 A2A 延后为 DD-10（[`frontend-rebuild-spec.md`](../../specs/2026-07-06-frontend-rebuild-spec.md)）。iter-7 S7.4 则提议在 Python agent container 用 `FastMCP.from_openapi` 暴露三个粗工具（[`iter-7.md`](../../specs/2026-07-06-frontend-rebuild/iter-7.md)）。
- **[F]** 既有 Pi 调研已经证明 runtime event/streaming 不消除 workerd、DO、alarm、BYOK 的宿主责任；本研究仅复用该边界结论，不复算 runtime 选择（[`PI-AGENT-CORE-RESEARCH.md`](./PI-AGENT-CORE-RESEARCH.md)）。

## 2. 行业格局：三类产品解决的是三件事

| 类别 | 2026-08-29 可核成熟度 | 身份 / 计费 / 状态 / 工具治理 | 对 Animichi 的意义 |
|---|---|---|---|
| HTTP + OpenAPI 能力 API | **[F]** OpenAPI 3.2.0 是语言无关的 HTTP 接口描述；security scheme 描述认证，但执行仍由服务器负责（[OAS 3.2.0](https://spec.openapis.org/oas/latest.html)）。 | **[I]** 身份、配额、计费与幂等键都由 Animichi gateway 定义；调用方持有 agent 状态。schema 是合同，不是 tool admission policy。 | **[I]** 最稳的主接口；也应继续是 MCP 的业务实现源，避免双写逻辑。 |
| Remote MCP 能力提供 | **[F]** MCP `2026-07-28` 已 GA；tools 是 model-controlled、带 input/output JSON Schema 的调用面，resources 是 URI-addressed、application-controlled context（[tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)、[resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)）。HTTP authorization 使用 OAuth protected-resource metadata、resource indicator 与 scopes（[authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)）。 | **[F]** 协议规定工具发现、schema、结构化结果及错误，但不替服务方实现访问控制、限流、输出清洗；规范反而要求 server 自行验证输入/权限/速率/输出（[tool security](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)）。**[I]** 会话与模型账单仍由外部 host 持有。 | **[I]** 最适合把 catalog 变成受治理的能力面，不等于托管 agent。 |
| Remote-agent 互操作（A2A） | **[F]** A2A `v1.0.1` 提供 Agent Card、message/task/artifact、轮询/stream/push 与 JSON-RPC/gRPC/REST bindings；task 有持久 lifecycle（[release](https://github.com/a2aproject/A2A/releases/tag/v1.0.1)、[spec](https://a2a-protocol.org/latest/specification/)）。 | **[F]** Agent Card 声明 security schemes，但授权策略由实现决定；可选 `tenant` 只是 opaque routing id，不证明隔离（[spec](https://a2a-protocol.org/latest/specification/)）。**[I]** gateway 要增加任务索引、delegation token、回调验证、远端计量与争议归因。 | **[I]** 只在“对方本身是长任务 agent”时有增量；catalog read/tool call 不需要它。AG-UI 是 agent↔用户前后端事件协议，不替代 A2A（[AG-UI introduction](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/introduction.mdx)）。 |
| 托管执行（AgentCore / Sandbox / Agent runtime） | **[F]** AgentCore Runtime 支持 MCP/A2A、每 user session 独立 microVM、内建 identity/tracing，并按 CPU、内存等用量计费（[runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)、[sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)、[pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)）。Cloudflare Sandbox 为每 sandbox 提供隔离 VM、文件系统/进程/网络/配额，但明确要求应用自己做 auth、rate limit 与输入验证（[security](https://developers.cloudflare.com/sandbox/concepts/security/)、[pricing](https://developers.cloudflare.com/sandbox/platform/pricing/)）。 | **[I]** 平台承担 artifact、image、session/fs、secrets、egress、quota/billing 和 teardown；第三方托管可减少底层实现，但扩大供应商锁定与责任面。 | **[I]** 这是独立业务，而非 catalog MCP 的“第二阶段默认项”。 |

## 3. 三个互斥架构选项

| 决策面 | A — task API + remote MCP capability | B — remote-agent / A2A gateway | C — 托管第三方 agent code/runtime |
|---|---|---|---|
| 定义 | **[I]** Animichi 只执行已知 catalog tools；不运行/代理外部 agent。 | **[I]** Animichi 注册并调用外部 agent，保存 task 索引，但不运行其代码。 | **[I]** Animichi 接收第三方 artifact/image/code，并调度执行。 |
| request plane | `/v1` HTTP + 单一 `/mcp` Streamable HTTP；MCP 薄映射 service binding。 | A2A gateway 收 message/task，按 Agent Card 路由并处理 polling/SSE/push。 | admission → scheduler → 每 deployment/session sandbox → tool/model egress。 |
| data plane | 仍是 catalog Worker + Neon/R2/upstream；MCP 不建副本。 | catalog 数据与远端 agent 数据分属双方；本地只存 task/callback/audit 最小索引。 | 每租户 volume/session snapshot、artifact registry、运行日志与 catalog access。 |
| control plane | contract→schema、tool allowlist、OAuth scopes、license policy、quota。 | 再加 agent registry、Card 签名/审核、delegation、callback、partner billing/SLO。 | 再加镜像签名/SBOM/扫描、admission policy、资源/网络策略、secret broker、计费/删除。 |
| 隔离 / 身份链 | **[I]** OAuth client/user → edge 验证 issuer/audience/resource/scope → 剥离来访身份头 → 注入 `principal_id`/`tenant_id`；无执行隔离。 | caller → gateway → 短期 scoped delegation/mTLS → remote agent；tenant/task namespace 分开，绝不透传原 bearer。 | workload identity + 每 tenant/deployment 独立 VM；控制面、秘密面、数据面账号/权限分离。Cloudflare 明示 sandbox ID 不是认证凭据（[security](https://developers.cloudflare.com/sandbox/concepts/security/)）。 |
| BYOK / egress | 外部 agent 自持 model key；Animichi 不收 BYOK。server egress 固定为已知 upstream。 | key 仍由远端持有；gateway egress 只允许已注册 origin，需 DNS rebinding/SSRF 与签名 callback 防护。 | secret broker 注入短期凭据，默认 deny egress、按 provider/tenant allow；运行时代码永不见长期平台 key。 |
| 状态归属 | caller 持 conversation/task；Animichi 只持 catalog/cache/audit。 | remote agent 持 canonical compute/session state；gateway 持 task index、状态镜像与幂等记录。 | Animichi 持 session/fs/snapshot/lifecycle，并承担 retention/erasure。 |
| 可观测性 | tool/principal/tenant-hash/status/latency/cache/upstream/row-count；不记 query、精确坐标、token/body。MCP 2026 支持 OTel trace context（[changelog](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx)）。 | 端到端 trace + task id + remote attempt/callback；跨组织 payload 默认不采集。 | 再加 admission/image digest/syscall/network/CPU/memory/secret-access/teardown audit。 |
| 成本 / 锁定 | 最低；标准 HTTP/MCP，可替换 host。成本主要是 catalog query/egress 与网关。 | 中等；task store、长连接/push、partner support 与纠纷计量；协议锁定低、运营耦合高。 | 最高；持续 compute/storage/egress/security operations；AgentCore/Workers/Sandbox API 与账单锁定明显。 |
| 失败域 | MCP adapter、edge、catalog；外部 agent 故障不进入 Animichi。 | 再加 registry、remote agent、跨网、callback；必须区分 accepted 与 completed。 | 再加恶意/失控代码、逃逸、资源耗尽、供应链、残留秘密/数据与平台级 noisy neighbor。 |
| go / no-go | **GO**：机器身份、scope/tenant/rate、schema parity、license allowlist、审计与撤销均通过；**NO-GO**：任何真实输出仍含 quarantine 字段。 | **GO**：≥2 个签约 partner 明确需要 async task/artifact/push，完成 DPA/SLO/billing/回调安全；否则 **NO-GO**。 | **GO**：有付费需求和独立 on-call/security budget，sandbox escape/egress/secrets/deletion/abuse/billing 演练通过；现在 **NO-GO**。 |

**[I] 升级触发器**：A 的工具调用不能表达两个以上真实 partner 的异步协作需求时才评估 B；只有 B 的伙伴明确要求“上传代码且由 Animichi 运行”、并能覆盖隔离与运营成本时才评估 C。协议流行度、demo 可运行或已有 sandbox 产品都不是触发器。

## 4. 最小可行第一步：catalog MCP server 草案

### 4.1 边界与放置

- **[I]** 新建专用 TypeScript Worker（或 edge 内独立模块），位于 edge 认证之后，经 Cloudflare service binding 调 catalog；不连 Neon、不抓 upstream、不复制 resolve/route 逻辑。Cloudflare 当前对新无状态 server 推荐 `createMcpHandler()`，`McpAgent` 属 legacy/deprecated path（[Remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)）。
- **[F]** MCP TS SDK 的 Web Standard handler 是每请求 fresh server，且不会自动做 auth/origin validation，必须在 handler 前置（[Web Standard serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md)）。**[I]** 固定 `POST /mcp`，无 DO、无 alarm、无 server-side MCP session；只在客户端请求 SSE 时使用 request-scoped SSE，连接关闭即取消该请求（[transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)）。
- **[U]** npm SDK 的确切版本、2026 wire opt-in 与各目标客户端的 version negotiation 尚未验证；官方迁移文档说明 2026 行为可能需显式开启，故必须 pin + interoperability spike（[SDK migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)）。

### 4.2 v0 工具与资源（全部一对一调用合同）

| MCP 名称 | inputSchema → outputSchema | v0 决策 |
|---|---|---|
| `catalog.resolve` | `ResolveInput {query: trim,min(1)}` → `ResolveOutcome`（resolved / needs_disambiguation / not_found / upstream_unavailable） | **[I]** 候选；只调 `/catalog/resolve`，不做 agent 推理。当前输出含 Bangumi 标题/封面，真实数据先 quarantine（[contract](../../../packages/contract/src/contract.ts)）。 |
| `catalog.search` | `SearchInput {query,origin?}` → `SearchResult {rows,synced_at,partial?}` | **[I]** 候选；只调 `/catalog/search`。合同没有 page/limit，不能公开 bulk surface；先补 SoT 的有界输出再开放。 |
| `catalog.points` | `{bangumi_id:^\\d+$}` → `SearchResult` | **[I]** 候选；一对一调 `/catalog/points-by-bangumi-id`，名称只做协议友好别名。点位/图片许可未清前 quarantine。 |
| `catalog.itinerary` | `{point_ids:string[],origin?,pacing?:chill|normal|packed}` → `Itinerary` | **[I]** 候选；只调 `/catalog/itinerary`。router 有 500 IDs cap，但 Zod schema 没有 max（[`router.ts`](../../../workers/catalog/src/router.ts)、[contract](../../../packages/contract/src/contract.ts)）；必须先在 SoT 对齐，MCP 不私设第二份规则。 |
| `animichi://catalog/capabilities` | 静态、版本化的 tool/schema hash、limits、data classes | **[I]** 允许；不含业务数据。 |
| `animichi://catalog/data-policy` | 静态、版本化的 source/field allow/quarantine/deny 与 attribution 要求 | **[I]** 允许；policy hash 写入每次审计。 |

**[I] v0 不暴露** `spots`、`nearby`、`geocode`、`animeOverview`、`popular`：不是因为它们“不安全”，而是四个粗能力已经足以验证 MCP；缩小 license/rate/隐私审计面。以后每加一个 tool 都从同一 contract 生成 schema，并单独过数据政策。

### 4.3 横切合同

- **认证/租户** — **[I]** 服务器发布 protected-resource metadata；token 必须匹配 issuer、audience/resource、expiry 与 tool scope，例如 `catalog.resolve:read`、`catalog.points:read`、`catalog.itinerary:read`。edge 从受信 token 映射 principal/tenant；拒绝来访 tenant/identity header。机器凭证撤销、轮换和审计是 launch gate（[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)）。
- **速率/计费** — **[I]** key 为 `{principal,tenant,tool}`，另有全局 upstream/bulk budget；按 response rows/point_ids 加权，429 给稳定 `retry_after`。不能复用人类 daily-message quota，也不能让不同 tenants 共用 `svc:` key。
- **错误** — **[F]** MCP 建议把工具执行/业务失败放在 tool result 的 `isError:true`，协议/schema 错误才用 JSON-RPC error（[tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)）。**[I]** 结构化内容固定 `{code,retryable,trace_id}`，不泄漏 upstream body/URL/secret；HTTP/oRPC error registry 是 code 来源。
- **取消** — **[F]** 客户端关闭 request SSE 时 server 必须取消该请求（[transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)）。**[U]** service-binding fetch 到 catalog/upstream 是否完整传播 abort 尚未有仓库级测试。
- **遥测** — **[I]** 接受/传播 `traceparent`；记录 schema/policy version、tool、hashed principal/tenant、status、latency、cache/upstream、row count 与 quota，不记录自由文本 query、精确 GPS、返回 body、token 或图片 URL。

### 4.4 与 iter-7 S7.4 的冲突/复核

1. **[F] SoT 冲突**：S7.4 从 agent FastAPI OpenAPI 生成；现在 catalog Zod/oRPC contract 才是这些能力的源（[contract](../../../packages/contract/src/contract.ts)）。应生成/手写“薄而策展”的 MCP schema，不镜像 agent HTTP。
2. **[F] 能力冲突**：草案的 `plan_pilgrimage(anime,constraints)` 没有现成 route；现有 `planItinerary` 需要调用者先 resolve/search 再传 point IDs。MCP 层若拼装三步会复制 orchestration，违反薄适配。
3. **[I] runtime 冲突**：把 FastMCP 放 Python container 会把 catalog capability 绑回容器生命周期；无状态 TS Worker 更贴近 contract/edge。FastMCP 官方也把 OpenAPI conversion 定位为 bootstrap/prototype，并建议 curated MCP，而非镜像复杂 API（[FastMCP OpenAPI](https://gofastmcp.com/integrations/openapi)）。
4. **[U] 版本复核**：S7.4 早于 MCP 2026 GA；`from_openapi`、OAuth middleware、SSE/abort 与 target clients 的 2026 negotiation 必须重新 spike，不能沿用旧 session 假设。

### 4.5 安全与验收 AC

- **AC-M1（contract）**：每个 tool 的 input/output JSON Schema 与固定 commit 的 Zod 生成物结构等价；contract 增删/limit 漂移时 CI 失败，MCP 层没有业务分支。
- **AC-M2（auth）**：缺失/过期/错 issuer、audience、resource、scope 的 token 均 fail-closed；伪造 identity/tenant header 不影响内部 principal；撤销立即生效。
- **AC-M3（isolation/rate）**：两个 tenants 的 quota/cache/audit key 不串；同一凭证并发、超大 query、>limit IDs 与枚举/bulk 测试得到稳定 4xx/429，不触达超额 upstream。
- **AC-M4（data policy）**：snapshot test 枚举每个 output field/source，只有 ALLOW 可序列化；QUARANTINE/DENY 的标题、点位、图片、raw payload 不会因 schema 新字段自动外泄。
- **AC-M5（transport）**：JSON 与 request-scoped SSE conformance；disconnect/abort 终止下游工作；Origin/Host、content type、version negotiation 与 oversized body 都有负测。
- **AC-M6（errors/telemetry）**：业务失败是 `isError:true` 且 code/retryable 可判；协议错误为 JSON-RPC；trace 串通 edge→MCP→catalog，日志断言不含 token/query/坐标/body。
- **AC-M7（license）**：发行 artifact 附 source/field policy hash 与所需 attribution；任何 UNKNOWN 或过期许可 snapshot 使 public release fail-closed。

## 5. 数据许可红线

### 5.1 当前真实来源与权利矩阵

**[F]** 生产 ingest 直接请求 `api.bgm.tv` 与 `api.anitabi.cn`，原始 JSON 进入 raw zone（[`sources.ts`](../../../workers/catalog/src/ingest/sources.ts)）；点位图片首次访问时还会从 Anitabi 拉取并长缓存到 R2（[`img.ts`](../../../workers/catalog/src/media/img.ts)）。gazetteer 的 MLIT/GeoNames 版本、抓取日与 SHA256 已固定（[`data-sources.md`](../../data-sources.md)），地图面另使用 OSM/Protomaps（[`map ADR`](../../adr/0001-map-stack-maplibre-protomaps.md)）。因此下表按实际字段链判定，而不是按供应商名称猜测。

| 来源 / 当前用法 | 可查询 | 可缓存 | 可衍生 | 可再分发 | 商业 / 批量 | 署名 / share-alike | 判定 |
|---|---:|---:|---:|---:|---|---|---|
| Bangumi API：标题、别名、简介、评分、封面；本地 provenance 的 `license=null`（[`run-ingest.ts`](../../../workers/catalog/src/ingest/run-ingest.ts)） | ⚠ | ? | ? | ? | ? / ? | ? | **[U] QUARANTINE**。官方开发页/API repo 规定开发者身份、User-Agent 等接入要求，但本次核查未找到授予缓存、再分发或商业使用的明确许可证；“API 可访问”不等于可再分发（[dev](https://bgm.tv/dev)、[API repo](https://github.com/bangumi/api)、[User-Agent policy](https://github.com/bangumi/api/blob/master/docs-raw/user%20agent.md)）。 |
| Anitabi API：点名、坐标、集数/时间、origin/originURL、截图 | ✓ | ✓* | ✓* | ✓* | **非商业** / full-size image discouraged | attribution + **BY-NC-SA**；改编同许可 | **[F] COMMERCIAL DENY / otherwise conditional**。API 文档将站点地点信息置于 CC BY-NC-SA 4.0，并要求显示图片来源；图片可能来自多站，额外权利不被该许可保证（[API](https://github.com/anitabi/anitabi.cn-document/blob/main/api.md)、[license](https://creativecommons.org/licenses/by-nc-sa/4.0/)）。当前 provenance 误把 homepage 当 `license` 且 field map 不含 origin/origin_url（[`run-ingest.ts`](../../../workers/catalog/src/ingest/run-ingest.ts)）。 |
| GeoNames `cities500` 本地快照：城市/坐标（[`data-sources.md`](../../data-sources.md)） | ✓ | ✓ | ✓ | ✓ | ✓；web service 另有 quota，当前不是该路径 | CC BY 4.0 attribution + 标注修改 | **[F] ALLOW with attribution**。下载数据库明确 CC BY 4.0，可商业使用；不得把免费 web-service quota 当 bulk 许可（[about](https://www.geonames.org/about.html)、[export](https://www.geonames.org/export/)）。 |
| MLIT 国土数值信息 N02-2023/2025：铁路站点/线网派生数据 | ✓ | ✓ | ✓ | ✓ | ✓；仍须看 dataset-specific notes | CC BY 4.0 attribution + 标注加工 | **[F] ALLOW with attribution**（[N02-2023](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2023.html)、[N02-2025](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html)、[usage rules](https://nlftp.mlit.go.jp/ksj/other/agreement_01.html)）。当前 transit asset 已输出 MLIT attribution（[`build.ts`](../../../workers/catalog/src/lib/transit/etl/build.ts)）。 |
| 駅データ.jp：站/线拓扑，构建 transit index | ✓ | ✓ | ✓ | 条件式 | ✓；未加工第三方提供须免费 | 无强制署名 | **[F] ALLOW derived / raw bulk DENY**。条款允许商业、加工和第三方提供，但限制未加工数据的有偿提供（[terms, 2025-06-04](https://ekidata.jp/agreement.php)）；仓库资产声明相同边界（[`build.ts`](../../../workers/catalog/src/lib/transit/etl/build.ts)）。 |
| OSM/ODbL → Protomaps PMTiles/MapLibre（[`map ADR`](../../adr/0001-map-stack-maplibre-protomaps.md)） | ✓ | ✓ | ✓ | 条件式 | ✓ | attribution；Derivative Database share-alike + 可机器读取副本/要约 | **[F] ALLOW only with ODbL compliance**。不得调用 OSM 公共 tiles/API 当免费生产 bulk；v0 MCP 不输出 PMTiles/raw geometry（[OSM copyright](https://www.openstreetmap.org/copyright)、[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)）。 |
| Anitabi scene image、Bangumi cover、本地 R2 image cache（[`img.ts`](../../../workers/catalog/src/media/img.ts)） | 条件式 | 已发生 | ? | ? | ? | 每对象权利链/来源 | **[U] DENY external MCP**。站点/API 元数据许可不能替代动漫画面、海报或原图版权许可；先做逐对象 chain-of-title 与缓存依据审计。 |

`*` Anitabi 的 ✓ 仅指遵守 BY-NC-SA 的非商业路径；它不是 Animichi 商业公共 MCP 的许可。**[U]** “商业”包括免费产品内的商业服务是否落入 NC，需要权利人/法律意见，本文不自行解释。

### 5.2 MCP 工具/字段执行政策

| Policy | 工具 / 字段 | 条件 |
|---|---|---|
| **ALLOW** | `animichi://catalog/capabilities`、`animichi://catalog/data-policy`；未来只含 `source=mlit|geonames` 的 geocode 结果；MLIT/ekidata 派生 transit attribution | 静态资源无业务数据；数据输出携 source/license/attribution/modified_at，license snapshot 未过期。 |
| **QUARANTINE** | `catalog.resolve/search/points/itinerary` 的真实结果；Bangumi id/title/title_cn/summary/rating；Anitabi point name/coordinates/episode/time/origin；`seed|manual` geocode | Bangumi 权利未知；Anitabi 商业不兼容；seed/manual provenance 未逐字段审计。只可用 synthetic fixtures 或有书面许可的私有 pilot。 |
| **DENY** | `screenshot_url`、图片二进制、`cover_url`；raw upstream response/dump；PMTiles/raw OSM geometry；未加工駅データ.jp bulk | 无独立图片权利链，或会把数据库/付费 bulk 直接变成下载面。MCP serializer 必须字段 allowlist，不能只在 UI 隐藏。 |

**[F] 结构性 launch blockers**：`Point` 没有 `origin_url`/license/attribution；provenance 表虽能存 attribution/license/field map，但 Anitabi 记录不完整、Bangumi license 为 null（[`models.ts`](../../../packages/contract/src/models.ts)、[`provenance.ts`](../../../workers/catalog/src/ingest/provenance.ts)、[`run-ingest.ts`](../../../workers/catalog/src/ingest/run-ingest.ts)）。**[I]** 这些应先在 catalog SoT/发布政策修正，不能在 MCP 层另造版权逻辑。

## 6. 非目标、决策点与下一步 spike

**非目标**：托管任意代码、模型代理/BYOK vault、跨 agent delegation、聊天 UI、写入用户收藏/路线、公开图片代理、raw dataset export、MCP 内重写 resolve/route。本文不实现服务、不部署、不修改 SAFE-1。

| 决策 / spike | 最小证据 | 通过后动作 |
|---|---|---|
| L1 权利清理（最高优先） | Bangumi 对查询/缓存/派生/再分发/商业/bulk 的书面答复；Anitabi 商业许可与 screenshot/cover chain-of-title；OSM produced-work/derivative-DB 法务分类 | 生成 source×field machine policy；否则真实 catalog 永不 public。 |
| M1 MCP interop | pin TS SDK；至少 3 个目标 host 对 2026-07-28 JSON/SSE/auth/version/abort 的黑盒记录 | 选定 wire compatibility 窗口与退役日期。 |
| I1 machine identity | OAuth protected-resource metadata、resource indicator、scope、revoke/rotate；edge service-principal 接线和跨 tenant 负测 | 才允许非合成数据的受邀 pilot。 |
| C1 contract/payload | Zod→MCP schema parity；`point_ids.max(500)`、search/points pagination/row cap、policy envelope 的单一 SoT 决策 | 才冻结 v0 tools。 |
| O1 egress/observability | abort 贯穿 service binding/upstream；per-tool weighted quota；redaction/trace/billing reconciliation 故障演练 | 才承诺 pilot SLO。 |
| B1 A2A demand（延后） | ≥2 partner 的 async task/artifact/push 场景与互操作 spike | 满足才立 B ADR；否则维持 A。 |
| H1 hosted runtime demand（延后） | 付费需求、threat model、sandbox escape/secret/egress/data deletion/cost ceiling/on-call 演练 | 满足才比较 AgentCore/Cloudflare/自建；否则维持 no-go。 |

## 最终决策

**[I] Conditional GO for A / NO-GO for public data today；NO-GO for B and C.** 先把 `catalogContract` 变成可验证、受 OAuth scope 和字段许可 allowlist 约束的 remote MCP 能力面。A 的首个可交付物应是“合成数据 + 静态 policy resources + 四个薄工具”的 conformance pilot；真实 catalog public launch 必须等待 L1、I1、C1、O1 全部通过。B/C 不进入实现 backlog，只保留由真实伙伴需求触发的 ADR 决策门。
