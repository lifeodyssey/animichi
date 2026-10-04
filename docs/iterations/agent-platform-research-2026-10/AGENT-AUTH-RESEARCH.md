# 对外鉴权与身份设计调研（2026-10-03）

状态：调研记录，不是决定。2026-10-03 由一个九 agent 的 workflow 产出：四路调研（A2A 协议鉴权、MCP 与 skill 鉴权、
机器与 agent 身份模式、本仓库现状），每路各配一个核验 agent 重新打开每条出处、换关键词重搜每条"未找到"，最后一路汇总。
只收录核验为 confirmed/corrected 的结论（corrected 取更正后说法）。§6 的 owner 问题待定；决定落到
`docs/agents/owner-decisions.md`。§8 是主会话事后复核。起因：owner 问未来的 A2A 与"BYOA"（用户自带 agent）怎么鉴权，
以及身份设计怎样才有足够的扩展性。

**术语**。仓库里没有 "BYOA" 一词（全库 grep 仅有 lockfile 哈希噪音）；最近的是 `docs/iterations/production-readiness-2026-08/BYO-AGENT-HOSTING-RESEARCH.md` 的 "BYO-Agent"。本报告按"用户自带 agent（Claude、ChatGPT 或其他 A2A agent）来消费我们的能力"理解，对应该文档的方案 A（调用方的 agent、模型、会话与 BYOK 都留在调用方，:8,10,34）；请 owner 确认。方案 B（Animichi 调用外部 agent）与 C（托管第三方代码）不在范围内。

标注：【事实】一手出处；【建议】来源文档的建议；【推断】我们的判断。路径省略仓库根，`edge/`=`workers/edge/src/`，`contract/`=`packages/contract/src/`；方括号键见文末源表。

## 1. 成熟方案怎么鉴权

**A2A（v1.0.1，2026-05-28；main 多出 7.6.4，dev-1.1 分支无鉴权改动）**
- 【事实】Agent Card 用 `security_schemes`（apiKey / http / oauth2 / openIdConnect / mutualTLS）和 `security_requirements` 声明要求，AgentSkill 可带自己的要求；oauth2 含 authorization_code(PKCE)、client_credentials、device_code；mTLS 只有 description 字段。[A2A-proto] #L380-383, #L500-644
- 【事实】服务端 MUST 验证每个请求、授权每个操作并把结果限定在调用者范围；payload 不带身份，身份在传输层；无 A2A 级鉴权错误码，用 HTTP 401/403。[A2A-spec] #L1891-1897, #L3073-3101；[A2A-ent] #L36-38
- 【事实】v1 删掉了 v0.3 的 "OR of ANDs" 选择规则；Python SDK `AuthInterceptor` 取第一个有凭据的 scheme，不强制 AND 组合。客户端如何从卡片得知 client 注册与取 token 方式仍是开放 epic #1990。[A2A-py-auth] #L36-93；[A2A-1990]
- 【事实】扩展卡 MUST 鉴权，但两个 SDK 都把门留给集成方，JS 在静态卡配置下对未认证调用静默返回公开卡。[A2A-js-handler] #L151-174
- 【事实】任务内二次认证：进入 `TASK_STATE_AUTH_REQUIRED` 后凭据带外传递；main 的 7.6.4 规定该状态转换本身不构成授权；SDK 只实现状态机。[A2A-spec-main] #L1964-1973
- 【事实】推送：服务端用客户端注册的 `authentication{scheme,credentials}` 回调 webhook，接收方 MUST 验证真实性；SSRF 过滤仅 SHOULD，a2a-js 发送端无过滤（issue #584）。[A2A-spec] #L842-889, #L3103-3134
- 【事实】协议无委托 / on-behalf-of / token exchange 原语，社区提案（#2028、#1937、#153）零维护者回应。Cloudflare 无官方 Workers 适配器，自家只有一个无鉴权的 v0.3 示例和一张社区论坛的非合规卡片。[CF-a2a-example]
- 【事实】Foundry（仅 Entra）、AgentCore（SigV4/OAuth）、Gemini Enterprise（OIDC ID token）都在网关层鉴权，不进 A2A payload。docs.claude.com/llms-full.txt 与 developers.openai.com 的 llms-full.txt 全文 A2A 零次。[Foundry-a2a]；[AgentCore-a2a]；[Gemini-a2a]
- 【推断】若解冻我们的 A2A 服务端，它是 `/v1` 之上的薄适配，但身份工作至少四项：非人类主体类；按已验证主体键控的 task/context 存储（两个 SDK 默认把所有匿名调用并入一个 owner scope）；15 分钟 JWT 下每次 Get/Subscribe/Cancel 重新授权；匿名 owner 策略或直接拒绝。[A2A-spec] #L3075-3101；[A2A-js-owner]；[A2A-py-owner]

**MCP（2026-07-28）**
- 【事实】授权为 OPTIONAL；HTTP 服务一旦做授权：RFC 9728 PRM 且 `authorization_servers` 必填、AS 元数据（RFC 8414/OIDC）、S256 PKCE、授权与 token 请求都带 RFC 8707 `resource`、逐请求校验 audience、不得透传 token、401/403 带 `WWW-Authenticate`（`resource_metadata`、`scope`）；CIMD 为 SHOULD，DCR 已 deprecated；短寿命 token、公共客户端 refresh 轮换、RFC 9207 `iss`。[MCP-auth]；[MCP-disc]；[MCP-sec]
- 【事实】该版取消协议级会话与 initialize，持有 handle 不等于认证。托管 Claude 文档仍写遵循 2025-03-26/06-18/11-25 授权规范，2026-07-28 "rolling out"。[MCP-changelog]；[Claude-index]
- 【事实】client_credentials 是 draft 扩展（SEP-1046，仅 mcpc 实现），Enterprise-Managed Authorization 为 stable；Claude web/Desktop 与 ChatGPT 都未勾选。[MCP-matrix]；[MCP-cc]
- 【建议】官方教程：不要自写 token 校验；scope 最小化、按工具。[MCP-tutorial]

**Claude 连接器**
- 【事实】三种方式：按用户 OAuth（`oauth_cimd`/`oauth_dcr` 默认，`oauth_anthropic_creds` 需联系 Anthropic）、组织 Owner 配置的 static_headers（beta、最多 4 个、组织级、不能标识用户）、无鉴权；不支持 client_credentials。Claude Code 另可发任意 `--header`/`headersHelper`。[Claude-auth]；[ClaudeCode-mcp]
- 【事实】客户端比规范严：必须 401 才开始登录；只用第一个 authorization_server；PRM `resource` 须等于用户输入的 URL；仅当 AS 元数据同时有 `client_id_metadata_document_supported: true` 且 `token_endpoint_auth_methods_supported` 含 `none` 才用 CIMD，否则 DCR；发现/注册/token 限 10 s；回调 `https://claude.ai/api/mcp/auth_callback`；出口网段 160.79.104.0/21。[Claude-auth]
- 【建议】高流量服务优先 CIMD 或 `oauth_anthropic_creds`，DCR 每次新连接都注册新 client。[Claude-auth]

**ChatGPT**
- 【事实】只读匿名可接受；私有数据或写操作要按用户 OAuth 2.1；CIMD 优先，仅当 AS 支持 RFC 9207 `iss` 才用固定 `client_id https://chatgpt.com/oauth/client.json`；S256 须在元数据声明；不支持 client_credentials、服务账号、自定义 API key、客户 mTLS；出站带 OpenAI 管理的 mTLS 证书（标识宿主而非用户）；`resource` 应复制进 `aud`。【建议】用成熟 IdP。[OpenAI-auth]

**Cloudflare 路径**
- 【事实】`@cloudflare/workers-oauth-provider` 1.2.1（2026-09-28）：AS 与 RS 分离，RS 经 Service Binding 调 `validateToken`；RFC 9728/8414；CIMD（仅 `none`，元数据确有 `none`）、预注册、可选 DCR；grant 为 authorization_code、refresh、可选 RFC 8693 exchange、实验性 jwt-bearer，**无 client_credentials**（conformance/README.md:65）；token 不透明、KV 只存哈希、吊销即时。"用户在别处"模式：MCP 服务仍是 AS，`/authorize` 交给上游 IdP 后把上游 user id 存进 props。[CF-WOP]
- 【事实】Agents SDK：`McpAgent` 已标 legacy，新服务用 `createMcpHandler`；`workers/edge` 已依赖 `agents@0.23.0`（`workers/edge/package.json:31`）。[CF-mcp-auth]
- 【事实】Access Managed OAuth（Beta）把 Access 变成 OAuth AS：不透明 token、默认 15 分钟、基于用户、需 Access IdP，会替换你自己的 401 行为。Access 服务令牌默认两个头 + Service Auth 策略（可配单头模式）；其 JWT `sub` 为空、`common_name`=Client ID、`aud`=应用 AUD tag；Cloudflare 要求源站（含 Worker）校验该 JWT，除非经 Tunnel；2026-10-05 后新建组织默认严格模式（401/403 而非 302）。Linked App Token 只解决 Access 应用之间的委托。【推断】它不适用于不在 Access IdP 里的公网 Claude/ChatGPT 用户。[CF-managed-oauth]；[CF-app-token]；[CF-svc-token]；[CF-linked]
- 【事实】API Shield JWT 校验不支持 EdDSA，替代不了 Neon 校验。[CF-apishield]

**Claude Skill 调 API 时凭据怎么带**
- 【事实】Skill 格式无凭据字段；API 平台的 Skill 无网络，claude.ai 由管理员设置，Claude Code 全网络。【建议】Anthropic 把 Skill 内硬编码凭据列为高风险，凭据放环境变量或安全存储。[Skill-spec]；[Skill-overview]；[Skill-ent]
- 【事实】Skill 以 `ServerName:tool_name` 引用 MCP 工具，凭据只存在连接器的 OAuth 授权里；Skills-over-MCP（SEP-2640）在客户端矩阵里 Claude web/Desktop 未勾选，ChatGPT 仅提交时快照。唯一安全槽位是 Claude Code plugin 的 `userConfig sensitive:true`。[Skill-bp]；[MCP-matrix]；[ClaudeCode-plugins]
- 【事实】S7.2 计划的 `seichijunrei_client.py` 当年围绕 `SK=sk_xxx` 构建（`docs/archive/plans/2026-03-31-iter-auth.md:746,915,932`），该路径已被 AUTH-1 删除。

## 2. 主体模型

成熟度：OAuth 2.1 仍是 draft-16（2026-09-03）[OAuth21]；Auth0 Agent as Principal 为 Early Access [Auth0-aap]；WorkOS Agent Auth 为 early access [WorkOS-changelog]；Okta for AI Agents GA（2026-04-30）[Okta-ga]；MCP client_credentials 扩展为 draft [MCP-cc]；Access Managed OAuth 为 Beta [CF-managed-oauth]。

| 主体 | 凭据形态 | 寿命与刷新 | 吊销 | 审计字段 |
|---|---|---|---|---|
| 人 | 会话换取的短 JWT（Neon：EdDSA、15 分钟、`sub`=用户、无自定义 claim）[Neon-jwt] | 用会话 cookie 再调 `/token` | 到期为止 | sub |
| 服务 | client_credentials（RFC 6749 §4.4，仅机密客户端，SHOULD 不发 refresh）；RFC 9068 要求 iss/exp/aud/sub/client_id/iat/jti，`sub`=客户端标识；MCP 扩展推荐 private_key_jwt（RFC 7523）；或联邦 token（GitHub OIDC、SPIFFE JWT-SVID，后者禁 EdDSA）[RFC6749]；[RFC9068]；[MCP-cc]；[SPIFFE-jwt] | Stytch、GitHub 安装 token 1 h；WorkOS agent ≤1 h；Access 服务令牌 1 年；Clerk M2M 默认不过期 | JWT 靠到期（除非 RFC 7009/7662）；不透明 token 即时 | client_id、jti 哈希，不记 token |
| 代人行事的 agent | 授权码 + PKCE 得到的 token：`sub`=用户、`client_id`=宿主平台（ChatGPT 唯一能产生的形态，托管 Claude 的默认形态）；委托链用 RFC 8693 `act` | 5–60 分钟 + 轮换 refresh | 在 AS 吊销 | sub、client_id、act.sub、scope、决策、关联 id |

- 【事实】OAuth 2.1 §7.4：资源服务器必须能区分发给客户端的 token 与发给用户的 token，否则 client 可冒充用户。这是"主体种类必须显式"的规范依据。[OAuth21]
- 【事实】RFC 8693 区分 delegation（A 保留自身身份）与 impersonation；`act` 标记当前 actor，消费者 MUST 只看顶层 claims 与当前 actor。[RFC8693]
- 【事实】各家都用 `act` 表达委托链、用 `sub_profile: ai_agent` 标记 agent，但 agent 放哪个 claim 不一致：Auth0 与 WSO2 草案 `sub`=用户、`act.sub`=agent；WorkOS 反过来 `sub`=agent 实例、`act`=用户；IETF klrc/AIMS 草案 agent=`client_id`；Okta 两篇文章互相矛盾。[Auth0-tokens]；[WorkOS-bp]；[klrc]
- 【事实】跨域委托走 ID-JAG/XAA（OAuth WG draft-04）；Okta 明说 XAA 不适用于无人会话的自治 agent。[IDJAG]；[Okta-xaa]
- 【建议】klrc/AIMS §11 审计最小集：agent 标识、被委托主体、资源/工具、动作与决策、时间戳与关联 id、吊销事件；不记完整 token。[klrc]
- 【事实】生产先例：GitHub App 三种主体（app 自身 JWT、installation token 1 h、代用户 token）各有限流桶；Stripe MCP 对交互客户端用 OAuth、对自治客户端用 agent API key；Atlassian 用 OAuth 2.1 加管理员开启的服务账号 key。[GH-apps]；[Stripe-mcp]；[Atlassian-mcp]
- 【事实】静态 API key 有分歧：klrc 称反模式，Okta 与 WorkOS 变更日志称长寿命 key 是坏选项；但 WorkOS 2026-05 博客、Clerk、Claude static_headers、Stripe、Atlassian 和我们自己的 Access 服务令牌都在用。[WorkOS-keys]；[WorkOS-changelog]；[Clerk-overview]

## 3. 可扩展性的共同模式

- 【事实】Kubernetes AuthenticationConfiguration（v1.34 Stable）：最多 64 个 jwt authenticator，`issuer.url` 唯一，各带 audiences、claimValidationRules、claimMappings，映射成一个 UserInfo；多认证器无顺序保证、首个成功即短路。Envoy jwt_authn 用命名 provider（issuer/audiences 可选）。Spring 按 `iss` 选验证器，但只限可信列表。[K8s-auth]；[Envoy-jwt]；[Spring-mt]
- 【推断】共同模式 = 一个验证接缝 + 按发行方键控的注册表（JWKS 来源、audience、claim 规则）+ 映射成一个内部身份。逐条目的 alg/typ 规则不是这些系统的特性，会是我们自己的加法；"未知发行方在取 key 前拒绝"只在 Spring 有文档。
- 【事实】一致点：audience 限定（Envoy 未配置时例外）；`act` 表达链；不透传；短寿命；RFC 9728 + 8707 作对外发现契约（A2A 用 Agent Card 代替）。分歧点：静态 key；默认寿命（15 分钟到永不过期）；JWT 还是不透明（Clerk 明说取舍：离线可验 vs 即时吊销）；agent 是否独立主体类型（Auth0/WorkOS/Okta/Entra/AgentCore/Google 是，MCP、A2A、ChatGPT、Stytch 只当 OAuth client，Clerk 介于其间）；`sub` 含义（Access 服务令牌 `sub` 为空，Txn-Token 的 `sub` 不绑定 `iss`）；Access 前置的源站要不要再校验 Access JWT。【推断】因此单靠 `sub` 识别不了主体种类；可行的来源是发行方条目或 grant 类型。[Clerk-formats]；[CF-app-token]
- 【事实】限流记账：GitHub 按主体分桶，代用户的 token 共用该用户的桶。[GH-ratelimit]【推断】按 (kind, issuer, subject) 键控可避免机器与人共用限流器，仓库 `svc:` 前缀已有此意；MCP `clientInfo` 是自报的，不能作键。
- 【事实】我们今天的接缝：单发行方来自单个 env（`edge/identity/auth.ts:150-152,200-210`）、EdDSA 钉死（`contract/jwt.ts:13`）、只能产出 human（`auth.ts:68-72`）、下游两个头（`edge/gateway/forward.ts:22-26`）。边缘之外另有三处自验机器凭据：migrator 的 GitHub OIDC（`contract/oidc-github.ts:119,149`）、catalog 管理端静态 bearer（`workers/catalog/src/import/admin-routes.ts:99-141`）、anitabi-egress 的 HMAC 签名（`apps/anitabi-egress/src/request-signature.ts:1-75`，2026-09-19 加入，晚于 ADR 0008 原则）。

## 4. 我们的约束与现状

- 【事实】身份矩阵只有 public/anonymous/authenticated，schema `.strict()`，三处测试钉死"agent 类必须被拒"（`contract/identity-contract.ts:20,43-47`；`packages/contract/test/identity-contract.test.ts:50-53,69-72`；`workers/edge/test/identity-policy-matrix.test.ts:71-77`）。`routing-policy.ts` 已不含身份表（#1737 删除），`edge/identity/auth.ts:28-35` 的 ANON_V1 注释已过期。
- 【事实】唯一能产生 human 身份的凭据是 Neon EdDSA JWT（匿名身份走另一条管道，见本条后半）；边缘只读 `sub`、硬编码 `human`、iss=aud=JWKS 源（`auth.ts:164-236`）；三种失败：absent 401（匿名开放的 turn/transcript/stream 路由上，absent 转入匿名管道而非 401，`edge/gateway/agent-tier-route.ts:113-123`；匿名关闭时管道返回 null，仍答 401，`edge/identity/anonymous-flow.ts:51-54,72-73`、`agent-tier-route.ts:123`）、invalid 401、JWKS 不可达 503，均不带 `WWW-Authenticate`（`edge/gateway/responses.ts:18-90`）。匿名类是 Worker 自铸 HMAC cookie + Turnstile，两个已部署环境中按提交的配置仅 staging 开，本地开发环境也开（`workers/edge/wrangler.toml:110`；`edge/identity/anonymous-id.ts:1-77`；`workers/edge/wrangler.toml:266,464`）。userType 至少流经两条下游接缝：users 绑定头（`edge/gateway/forward.ts:21-35`；`workers/users/src/index.ts:58-63` 只收 `human`）与进程内 agent tier、`edge/identity/session-adopt.ts:25-27`；`payerFor` 的 else 分支把任何未知 userType 当 `user`（`edge/gateway/native-submission.ts:13-16`）。
- 【事实】文档漂移：`docs/ops/deployment.md:256` 说 `/v1/*` 总要 Bearer，但 turn/transcript/stream 允许匿名（`edge/gateway/agent-tier-route.ts:96`）；`deployment.md:241-243` 与 `docs/ops/cloudflare-hardening.md:49-50` 说 agent tier 看不到原始 bearer，实际原 Request 整体传入（`agent-tier-route.ts:79-80`）；`docs/ops/secrets.md:225` 说 ESC 只导出两个名字，实为三个（`.github/workflows/cd.yml:98-104`）。
- 【事实】`SERVICE_CREDENTIAL` 格与 `svc:` 前缀已建模但无路由使用，repo-smell 审计列为清理项 D14（`edge/gateway/rate-policy.ts:56-61,137-148`；`docs/specs/2026-09-05-repo-smell-audit.md:405,489`）。
- 【事实】AUTH-1 #945 / AUTH-2 #950 正文为空、零评论；理由在父规格 #936："Make Neon Auth the only human identity authority and remove Animichi machine API keys"（:34），第 17 项删除全部 `sk_*` 与 `api_keys` 表（:95），"Changing any cell or value is a later owner-level product decision"（:96），"no code-level compatibility window"（:100）。被删的是用户自助从 Settings 页签发、供 "Agent (CLI/skill)" 使用的长寿命 key，出处 `docs/archive/plans/2026-03-31-iter-auth.md:12-31`。【推断】删除理由是战役范围与卫生，不是事故或安全缺陷，也无文字说机器访问永久不要。后续规格把"不改 edge 鉴权模型"列为非目标（`docs/specs/2026-09-09-agent-on-pi-harness-spec.md:56`）。
- 【事实】Neon 托管 Better Auth 只暴露 Admin、Email OTP、JWT、Magic Link、Organization（部分）、Open API、Phone Number；Neon 托管侧的 Better Auth 为 1.4.18（SD-31 记录，2026-07-07），上游 1.7.7 已有 `@better-auth/oauth-provider`（含 fail-closed 的 client_credentials）、`mcp`、`cimd`、`api-key`；JWT 固定 EdDSA、15 分钟、aud=Neon 源、无自定义 claim；Neon 自家 skill 写明 "MCP / OAuth Provider: Not Managed Auth"；bearer 插件关闭（`docs/ops/auth-migration-neon.md:82,85`）。[Neon-plugins]；[Neon-jwt]；[Neon-skill]；[BA-oauth]
- 【事实】Access 仅 staging：一个应用、两条策略（Service Auth `non_identity` 优先级 1，邮箱 allow 优先级 2）、一个服务令牌（8760h，2026-09-08 铸造，#1523 提醒续期，到期无人告警），由 CD `stage` job、evidence recorder、e2e、api-test 共用；边缘从不读 `Cf-Access-Jwt-Assertion`；ADR 0006 明记 "staging 不自验"；N4b 实测未列入 destinations 的路径可未鉴权到达 Worker（`infra/src/staging-access.ts:24,35,110-127,197-230`；`docs/adr/0006-platform-over-handwritten-ci.md:63,65`）。生产：无 Access、showcase 模式 403、匿名关、JWKS 未设（`workers/edge/wrangler.toml:255-274`）。
- 【事实】BYOK：四个请求头、需登录、与身份分轴（payer `byok|anon|user`，SQL CHECK 封闭）、不落盘、出口精确主机白名单；`forward.ts:33` 只剥过期的 `x-byok-endpoint`，四个真头透传到 users（未读取）。BYO-Agent 文档方案 A：外部 agent 自持 model key，Animichi 不收 BYOK（:39）。
- 【事实】规则：AGENTS.md:14 "Do not add Supabase-auth or self-verification code"；【推断】其语境是内部 worker 不自验（边缘本身用 jose 验 Neon）；ADR 0008（proposed）：平台或已采用库有的不自写，桶 C 须在代码里写明平台缺什么，新依赖属桶 B 的读法 ADR 自称未决（:56-66）；ADR 0006：门交给平台访问层，每个依赖方一个 `aud`。SD-19 入站硬杠：独立签名身份、默认只读、按调用者限流（`docs/specs/2026-07-06-frontend-rebuild/iter-7.md:13,80`）。Owner 2026-09-23：不建 S2–S7 故事；S7.4 MCP 服务 2026-10-02 关为 NOT_PLANNED；DD-10 冻结。
- 【事实】对外现状：无 MCP/Skill/A2A/服务的 OpenAPI；仅 users 文档声明 `bearerAuth`，agent 文档无任何 security（`packages/contract/scripts/emit-openapi.ts:77-111`）；`robots.txt` 对 ChatGPT-User/Claude-User 禁 `/v1/`；`llms.txt:18` 称 `/v1` "not a documented public interface"。CI 不持任何 edge 接受的应用身份：evidence recorder 拒绝携带 Neon bearer（`.github/scripts/release/record-evidence.mjs:91-98`），但 CD 持有并发送 Access 服务令牌（`.github/workflows/cd.yml:98-108`；`record-evidence.mjs:82-88`）。评测的 SUT 是 agent 而非网关（owner 2026-09-09），本报告不为评测设计身份。

## 5. 可选方向（不排序）

**方向一：只给 CI 一个服务主体（GitHub OIDC 边缘 audience）**
- 矩阵：新增 `service` 主体种类，接到 `svc:` 格；users/adopt 继续拒绝非 human。
- 发行方：GitHub Actions OIDC，复用 `contract/oidc-github.ts`（RS256），边缘另开一个 `aud`（ADR 0006 一依赖方一 aud）。
- 覆盖：CI 的 staging 探测。不覆盖 MCP、A2A、用户自带 agent；不能替代手动 api-test lane 的人类 token（该 lane "never in CI"），CD evidence recorder 现在刻意不带登录身份（Neon bearer），只带 Access 服务令牌。BYOK 无关。
- 代价：第二条自验路径（ADR 0008 桶 C，需写明缺口：Workers 无原生联邦，与 migrator 同理）；三处 pin 测试与 wrangler 变量联动。

**方向二：Cloudflare Access 作机器门，边缘校验 Access JWT，`common_name` 映射为服务主体**
- 矩阵：`service` 种类来自 Access 服务令牌，每个自动化或对端一个令牌。
- 发行方：Cloudflare Access（Pulumi 已管）；按 Cloudflare 指引用 jose 验 `/cdn-cgi/access/certs`、iss、aud。
- 覆盖：CI、A2A 对端（默认两个头，Python `AuthInterceptor` 无法同时套；Access 可配单头模式后声明为一个 apiKey scheme，未实测）、Claude Code（`--header`）。不覆盖 ChatGPT 与头名未经 Anthropic 批准的托管 Claude。BYOK 无关。
- 代价：源站校验改变 ADR 0006 "staging 不自验"的决定，生产加 Access 应用推翻 `infra/src/staging-access.ts:24`；1 年共享秘密，吊销=删除；严格模式与 302 行为随组织创建日期变化；若开 Managed OAuth 会替换我们的 401。

**方向三：独立 OAuth 2.1 授权服务器（`@cloudflare/workers-oauth-provider`），Neon 作上游登录**
- 矩阵：新增 `delegated` 种类（sub=Neon 用户 id、client_id=宿主、scope、aud=`/v1` 或 MCP 资源）；人类类不变。
- 发行方：新 Worker 作 AS，`/authorize` 走 Neon 登录后把 Neon `sub` 存进 props；边缘经 Service Binding 调 `validateToken`，不新增 JWT 验证代码。
- 覆盖：Claude（AS 元数据已含 `none`，可走 CIMD）、ChatGPT（库声明 RFC 9207，是否满足其固定 client_id 条件需验证）、用户自带 agent 的 OAuth 模式。不覆盖 client_credentials（库未实现），CI 与 A2A 机器对端要靠方向一或二补。
- BYOK：留在调用方；若允许 delegated 主体在 `/v1` 用 BYOK，需定 `edge/gateway/agent-turn.ts:26-28` 登录门如何对待该种类。
- 代价：新依赖（ADR 0008 桶 B）、KV 命名空间、同意页与 confused-deputy 控制、CIMD 需 `global_fetch_strictly_public`；Neon 文档说 HttpOnly cookie 不能跨前后端域，`/authorize` 如何取得 Neon 身份需 spike；staging Access 门挡住 ChatGPT 的 401 发现流程，需 MCP 端点与 `/.well-known/*` 的 bypass、Managed OAuth 或非 Access 主机；托管 Claude 的 2026-07-28 尚在推送，可能需保留 initialize 兼容。

**方向四：外部 AS（Auth0 / WorkOS / Stytch）或自托管 Better Auth 1.7.7，Neon 仍作人类 IdP**
- 矩阵：human/delegated/service 三种类齐全，可带 `sub_profile`/`act`。
- 发行方：Auth0（Agent as Principal EA、OBO exchange）、WorkOS（M2M、Agent Auth、Agent Registration 的 RFC 9728 发现）、Stytch（Connected Apps、M2M）或自托管 Better Auth（`oauth-provider` 含 client_credentials、`mcp`、`api-key`）。Cloudflare 把前三者列为 bring-your-own-provider。[CF-mcp-auth]；[Auth0-aap]；[WorkOS-reg]；[BA-oauth]
- 覆盖：全部四类调用者。BYOK 同方向三。
- 代价：第二家身份供应商，或自己运维 Better Auth（与 SD-31 "Neon 托管"相悖）；用户账户联动（`sub` 映射）；多项能力处于 EA/early access；费用；秘密走 Pulumi ESC；边缘仍要按 iss 校验第二发行方的 JWT 或调 introspection。

## 6. 需要 owner 拍板

1. 确认 "BYOA" 的理解（方案 A）；DD-10 是否仍冻结：现有采用证据是企业/OS 级，无 Claude/ChatGPT 作 A2A 客户端的一手证据。
2. 是否解冻"机器身份"：#936:96 把矩阵格修改保留给 owner；AUTH-1 删的是用户自签 `sk_*`，文本未说永久禁止。
3. 第二发行方（ADR 0008 桶 B）：方向二、三、四择一，或二加三。
4. Access 在源站：信任（ADR 0006 现状）还是校验（Cloudflare 指引）；生产是否建 Access 应用。
5. 身份词汇：加第四类，还是把策略类（限额）、主体种类、发行方拆成三轴（`IDENTITY_CLASSES`、wrangler 变量、`X-User-Type`、rate cell、三处 pin 测试需同步）；`svc:` 格接线还是清理（D14 把 serviceCredential* 列为仅测试消费）。
6. 匿名类是否对 MCP 开放：Claude/ChatGPT 接受匿名或混合服务；A2A SDK 默认把所有匿名调用并入一个 owner scope。
7. S7.2 Skill 的凭据路径：`ServerName:tool_name` 引用 MCP 工具、Claude Code plugin `userConfig`，或其他；是否在 #238（S7.4，2026-10-02 关为 NOT_PLANNED）之后开一张 TS 宿主的 MCP 新票（现受 2026-09-23 "不建 S2–S7"约束）。
8. 三处文档漂移是否随本次工作一并修。

## 7. 未能核实的结论

四路核验无 refuted 或 unverifiable 判定。仍无法核实：
- "BYOA" 在仓库无定义，owner 的解读未被记录。
- ChatGPT 核心协议实现的 MCP 修订版未在文档声明（仅 MCP Events 要求 2026-07-28）。
- 仪表盘手工创建的 Access 服务令牌无法从仓库排除。
- Neon "无 API-key/OAuth-provider 插件"是支持列表的缺席，非显式声明。
- `sk_*` 删除的事故、消费者或缺陷理由：所有文本中不存在。
- Auth0 "Auth for GenAI" 与 "Auth0 for AI Agents" 的更名关系，来源未说明。
- A2ABreak 的 11 项漏洞为第三方论文，精确率 73.3%，维护者回应待定。
- Workers 上的 SPIFFE/SPIRE 集成未找到。

## 8. 主会话复核（2026-10-03）

- Neon 托管 Better Auth 的插件列表属实：Admin、Email OTP、JWT、Magic Link、Organization（部分）、Open API、Phone Number，
  JWT 固定 EdDSA、15 分钟、无自定义 claim（neon.com/docs/auth/guides/plugins；neon.com/docs/auth/guides/plugins/jwt）。
- Cloudflare Access 的应用令牌属实：服务令牌通过后请求带 `Cf-Access-Jwt-Assertion`，`aud` 为应用 AUD tag、`common_name` 为
  Client ID、`sub` 为空，源站须自行校验（developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token）。
- MCP 扩展支持矩阵属实：OAuth Client Credentials 只有 mcpc 勾选，Claude（web、Desktop）与 ChatGPT 均未勾选；页面注明该矩阵
  由社区维护（modelcontextprotocol.io/extensions/client-matrix）。
- "BYOA" 的解读与 `docs/iterations/production-readiness-2026-08/BYO-AGENT-HOSTING-RESEARCH.md` 方案 A 一致：Animichi 只做能力
  提供者，调用方的 agent、模型、会话与 BYOK 都留在调用方；方案 B（A2A gateway）该文档已判 no-go。
- `@cloudflare/workers-oauth-provider` 1.2.1 不实现 client_credentials 属实，其 conformance 文档原话："The OAuth Client
  Credentials extension is still draft and is not implemented by this package."（github.com/cloudflare/workers-oauth-provider/blob/main/conformance/README.md）。
- 评审线程（2026-10-04）三处收窄：CI 的凭据状态按 Access 服务令牌与 Neon bearer 分开说；匿名类的开关按提交配置而非部署状态描述；absent 凭据在匿名开放路由上的去向按代码补写。

## 源表

- [A2A-spec] github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md；[A2A-spec-main] 同路径 main；[A2A-proto] github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto；[A2A-ent] github.com/a2aproject/A2A/blob/main/docs/topics/enterprise-ready.md；[A2A-1990] github.com/a2aproject/A2A/issues/1990；[A2A-py-auth] github.com/a2aproject/a2a-python/blob/main/src/a2a/client/auth/interceptor.py；[A2A-py-owner] github.com/a2aproject/a2a-python/blob/main/src/a2a/server/owner_resolver.py；[A2A-js-handler] github.com/a2aproject/a2a-js/blob/main/src/server/request_handler/default_request_handler.ts；[A2A-js-owner] github.com/a2aproject/a2a-js/blob/main/src/server/owner_resolver.ts；[CF-a2a-example] github.com/cloudflare/agents/tree/main/examples/a2a；[Foundry-a2a] learn.microsoft.com/en-us/azure/foundry/agents/how-to/enable-agent-to-agent-endpoint；[AgentCore-a2a] docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a.html；[Gemini-a2a] docs.cloud.google.com/gemini/enterprise/docs/register-and-manage-an-a2a-agent
- [MCP-auth] modelcontextprotocol.io/specification/2026-07-28/basic/authorization；[MCP-disc] …/authorization/authorization-server-discovery；[MCP-sec] …/authorization/security-considerations；[MCP-changelog] modelcontextprotocol.io/specification/2026-07-28/changelog；[MCP-matrix] modelcontextprotocol.io/extensions/client-matrix；[MCP-cc] github.com/modelcontextprotocol/ext-auth/blob/main/specification/draft/oauth-client-credentials.mdx；[MCP-tutorial] modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization
- [Claude-auth] claude.com/docs/connectors/building/authentication；[Claude-index] claude.com/docs/connectors/building/index.md；[ClaudeCode-mcp] code.claude.com/docs/en/mcp；[ClaudeCode-plugins] code.claude.com/docs/en/plugins/components.md；[OpenAI-auth] developers.openai.com/plugins/build/auth
- [CF-WOP] github.com/cloudflare/workers-oauth-provider（README、docs/*.md、conformance/README.md）；[CF-mcp-auth] developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/；[CF-managed-oauth] developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/；[CF-app-token] developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/；[CF-svc-token] developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/；[CF-linked] developers.cloudflare.com/cloudflare-one/access-controls/applications/linked-app-token/；[CF-apishield] developers.cloudflare.com/api-shield/security/jwt-validation/
- [Skill-spec] agentskills.io/specification；[Skill-overview] platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md；[Skill-ent] …/agent-skills/enterprise.md；[Skill-bp] …/agent-skills/best-practices.md
- [Neon-plugins] neon.com/docs/auth/guides/plugins；[Neon-jwt] neon.com/docs/auth/guides/plugins/jwt；[Neon-skill] github.com/neondatabase/agent-skills/blob/main/skills/neon-auth/SKILL.md；[BA-oauth] better-auth.com/docs/plugins/oauth-provider
- [OAuth21] ietf.org/archive/id/draft-ietf-oauth-v2-1-16.txt；[RFC6749] rfc-editor.org/rfc/rfc6749；[RFC9068] rfc-editor.org/rfc/rfc9068；[RFC8693] rfc-editor.org/rfc/rfc8693；[IDJAG] datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/；[klrc] ietf.org/archive/id/draft-klrc-aiagent-auth-03.txt；[SPIFFE-jwt] github.com/spiffe/spiffe/blob/main/standards/JWT-SVID.md
- [Auth0-tokens] auth0.com/docs/ai-agents-mcp/agent-as-principal/agent-identity-in-tokens；[Auth0-aap] auth0.com/docs/ai-agents-mcp/agent-as-principal；[WorkOS-bp] workos.com/docs/authkit/agent-blueprints；[WorkOS-reg] workos.com/docs/authkit/agent-registration；[WorkOS-keys] workos.com/blog/machine-identity-ai-agents-credentials；[WorkOS-changelog] workos.com/changelog/agent-auth；[Okta-xaa] developer.okta.com/docs/concepts/xaa/；[Okta-ga] okta.com/newsroom/press-releases/showcase-2026/；[Clerk-overview] clerk.com/docs/guides/development/machine-auth/overview；[Clerk-formats] clerk.com/docs/guides/development/machine-auth/token-formats；[Stripe-mcp] docs.stripe.com/mcp；[Atlassian-mcp] developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization/；[GH-apps] docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app；[GH-ratelimit] docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- [K8s-auth] kubernetes.io/docs/reference/access-authn-authz/authentication/；[Envoy-jwt] github.com/envoyproxy/envoy/blob/main/api/envoy/extensions/filters/http/jwt_authn/v3/config.proto；[Spring-mt] github.com/spring-projects/spring-security/blob/main/docs/modules/ROOT/pages/servlet/oauth2/resource-server/multitenancy.adoc
