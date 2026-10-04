# Agent API 平台化：一个运行时、多个入口、一份契约（2026-10-04）

状态：owner 于 2026-10-04 认可方向（"我感觉你的方案没啥问题"），附加约束"记得 staging 和 production 不太一样"。
决定记录在 `docs/agents/owner-decisions.md`。依据是三份调研记录：
`docs/iterations/agent-platform-research-2026-10/OBSERVABILITY-AND-EVAL-RESEARCH.md`、
`AGENT-AUTH-RESEARCH.md`、`AGENT-API-SHAPE-RESEARCH.md`。本文按 to-spec 模板写：问题、方案、用户故事、
实现决定、测试决定、范围外。

术语：conversation id 就是 pi 的 session id（`/v1/conversations/{session_id}`），下文统称 session id。
环境有三个：本地开发（wrangler 顶层配置，`make dev-local`）、staging、production。

## 问题

Animichi 的对外 API 只为浏览器里的聊天界面设计。程序调用者没有位置。具体表现：

1. 身份只有两种：登录的人（Neon Auth 的 JWT）和匿名的人（Turnstile）。评测、CI、以后的 MCP 客户端和 A2A 对端
   都是程序，没有任何一种凭据能进来。AUTH-1 删掉 API key 之后没有补替代。
2. 历史读取是有损投影：它不返回 `respond` 以外的工具结果，`respond` 的结构化答案只回 `intent` 和 `success`；模型名、供应商、逐次调用的 usage 在任何响应里都读不到，
   虽然 pi 的记录里都有。重连走的流会重放工具结果和答案，审计和评测走的历史读取拿不到。
3. 单轮预算 100 秒，是产品决定（#1416），从 lane 接受这个 turn 的时刻（pi 持久记下的 `startedAt`）起算，不续期。turn 属于 session，不属于连接：断线后
   它照样跑，客户端可以重连流接回去。但超过 100 秒就以 `deadline_exceeded` 结束，规划类任务可能需要更久；
   程序调用者也没有按 run 读 JSON 状态的方式，只能重连流。
4. `x-turn-id` 的幂等语义已经实现并有测试（同键同摘要重放原 turn，同键不同摘要答 409），但没有写进契约和公开
   文档，调用者不知道可以依赖它。
5. 平台 trace 已开，但没有应用级 span：一轮对话在 trace 里看不出模型调用和工具调用，span 上没有 session id。
   网关请求日志按规则不记 id，这是对的；但两条鉴权失败日志记了原始路径，路径里带 session id，违反了同一条规则。
   （limiter 告警记 ip 或用户 key，是限流排查用的，本 spec 不动。）
6. agent 的能力工具已经经 `catalogContract` 调 catalog，但哪个工具对应哪个契约操作、哪些工具不是能力，
   没有任何地方声明，也没有测试保证。"自家 web app 不许走私有后门"（X11）今天只靠人记住。
7. 三个环境不一样。staging 有 Cloudflare Access 应用（整个主机都在门后）和服务令牌，匿名开着，Neon Auth 的
   JWKS 配了；production 没有 Access 应用，匿名关着，JWKS 只有一行注释，还处在 showcase 模式（#1975 在退役）；
   本地开发匿名开着，没有 Access。任何"加一种身份"的设计都必须按环境分开说。
8. staging 现有的那把服务令牌是开门用的：e2e 的浏览器每个请求都带着它（Playwright 的 `extraHTTPHeaders`），
   smoke 和 CD 证据记录也带它。它不能直接变成一种身份，否则 e2e 的匿名和登录流程会被认成机器。

## 方案

一个 agent 运行时，多个入口，一份契约。

- agent 运行时（SessionAgent）不动位置，仍在 edge Worker 里。网页、以后的 MCP 和 A2A 都进同一个运行时。
  agent 不调自己的公开 API。
- 能力（查作品、查地点、查附近、规划路线）由 `packages/contract` 里的一份契约定义。agent 的能力工具声明它
  调用哪些契约操作，经 service binding 调用（Worker 间 RPC，不经过公网，也不经过自己的 `/v1`）；对外的 `/v1`
  能力操作和 MCP 工具列表将来从同一份契约生成。一条契约对齐测试保证两边不分叉。
- edge 的网关那一半增加职责：身份注册表（按发行方验证，映射成一个内部身份，带主体种类）、按主体种类限流和
  记账、每轮 span。
- 每轮对话的完整记录是唯一事实。流、历史读取、trace 都是它的投影。
- 规划类任务的预算可以超过 100 秒（turn 断线后本来就在后台跑）；调用者按 run 读 JSON 状态和结果。
- 四条 owner 决定（2026-10-04）：
  1. 加"服务身份"（`service`）这一种，发行方先用 Cloudflare Access 的服务令牌。
  2. 完整记录是唯一事实：模型名、供应商、每次调用的 usage、工具调用与结果、结构化答案、状态；历史读取返回它们。
  3. 给超过 100 秒的任务加后台续跑，按 run 读 JSON 状态和结果。
  4. "不许后门"只约束网页；agent 的工具和 `/v1` 共用一份契约，由契约对齐测试保证。

## 用户故事

1. 作为网页用户，我希望聊天的流和今天一样，这样我感觉不到后端的改动。
2. 作为网页用户，我希望断线重连后看到完整的回答和工具结果，这一点今天已经成立，改动后仍然成立。
3. 作为网页用户，我希望同一条消息因为网络抖动被发了两次时，服务端只处理一次并把原来的回答给我。
4. 作为网页用户，我希望一个要跑很久的规划请求不会在 100 秒时失败，而是继续跑，我能看到它的状态和结果。
5. 作为 owner，我希望每一轮对话在 Neon 里有一条完整记录：用了哪个模型、哪个供应商、每次调用花了多少
   token、调了哪些工具、参数和结果是什么、最后的结构化答案和状态。
6. 作为 owner，我希望历史读取能把这条记录读出来，这样审计不需要翻日志。
7. 作为 owner，我希望在 Workers Traces 里按 session id 和 operation id 能找全一轮对话：带主体种类，模型调用和
   工具调用各是一个 span，这样我能在平台里看到一轮对话发生了什么。
8. 作为 owner，我希望日志里不出现 session id 和路径，这是现有规则；两条鉴权失败日志要改成遵守它。
9. 作为 owner，我希望 trace 和日志里不出现 prompt 原文、工具参数和结果的正文、任何凭据。
10. 作为 API 测试 lane 的维护者，我希望在 staging 用一把专用的服务令牌发一轮对话（`POST /v1/chat`）、读回历史
    和 run，不需要用人的账号登录，也不需要每 15 分钟续一次 JWT。（评测不走这条路：评测在进程内测 agent。）
11. 作为 CI，我希望持这把专用令牌调 staging 的 `/v1/chat` 时被识别为 `service`，而不是被当成匿名或被拒绝。
12. 作为 owner，我希望服务身份有自己的限流格和记账，不和人的身份共用额度。
13. 作为 owner，我希望 users Worker 继续只接受人的身份；服务身份不能读写任何用户的数据，也不能认领会话
    （`/v1/sessions/adopt`）或用 BYOK。
14. 作为 owner，我希望 production 的行为由我单独决定：这份 spec 不给 production 加 Access 应用，也不在
    production 开放服务身份；production 和本地开发的身份矩阵和今天一样。
15. 作为 owner，我希望 `x-turn-id` 的语义写进契约和公开文档，成为承诺：同键同摘要重放原 turn，同键不同摘要
    答 409 `turn_in_flight`。
16. 作为 owner，我希望每个 agent 工具声明它调用的契约操作，并由一条测试对齐：加了工具不声明，或者工具调了
    没声明的操作，测试变红。
17. 作为以后的 MCP 客户端或 A2A 对端，我希望能力操作从同一份契约生成，这样接入时不需要另一套定义。
    （接入本身不在本 spec 内。）
18. 作为 reviewer，我希望每条验收标准都有一个最高层的接缝可以观察，并且变异测试能证明测试在检查它。
19. 作为 owner，我希望这些改动一张票一个 PR，每张票可以单独演示，staging 的 CD 每次都绿。
20. 作为 e2e 维护者，我希望 e2e 带着开门令牌跑的匿名流程和登录流程和今天一样，不会被认成 `service`。

## 实现决定

### 身份

- edge 的验证接缝改成按发行方键控的注册表。每个发行方条目有 JWKS 来源、`iss`、audience、算法，以及一条映射
  规则：把验过的 claims 映射成一个内部身份 `{kind, issuer, subject, scopes}`，或者映射成"不产出身份"。主体种类
  由条目的规则决定，不跨发行方从 `sub` 推断。
- 主体种类只有三种：`human`（Neon Auth 的 JWT）、`anonymous`（Turnstile，和今天一样）、`service`（新增）。
  `delegated`（代人行事、按用户授权的 OAuth）不在本 spec 内。
- Access 条目：edge 用 Access 团队域的证书端点验 `Cf-Access-Jwt-Assertion` 的签名，检查 `iss` 是团队域、`aud`
  是应用的 AUD tag。验过之后只有一种情况产出身份：`sub` 为空，并且 `common_name` 在配置的"身份令牌"Client ID
  列表里，这时产出 `service`，subject 是这个 Client ID。其余断言都不产出身份，请求照今天的 human 和 anonymous
  管道走：owner 经 Access 的 OTP 登录后带的断言（`sub` 不为空）是这样，开门令牌带的断言也是这样。
- 两把令牌。现有的 `staging-ci` 令牌只开门，不进身份列表；e2e、smoke、CD 证据记录照旧用它。新增一把 API 测试
  用的服务令牌，由 IaC 铸造，放进同一条 `non_identity` 策略；它的 Client ID 写进 edge 的 staging 配置（Client ID
  不是秘密）。新令牌的 id 和 secret 照现有令牌的路子作为 stack output 导出；在 ESC 环境里加这两个映射是 owner 的
  一步。
- 一个请求同时带有效的 Neon Bearer JWT 和身份列表里的服务断言：答 401（`invalid`），两个主体按失败处理。
- `service` 不走匿名管道的 mint 和 Turnstile 两步；它的限流和记账走 `service` 自己的格（见下）。
- 按环境：

  | | 本地开发 | staging | production |
  |---|---|---|---|
  | `human` | 和今天一样 | Neon Auth JWT，JWKS 已配 | 本 spec 不动；JWKS 未配是 production 上线的前提之一，归别的卡 |
  | `anonymous` | 开，和今天一样 | 开 | 关，和今天一样 |
  | `service` | 不提供：没有 Access | 开：只认身份列表里的那把令牌 | 不提供：没有 Access 应用；要不要建，是 owner 的单独决定 |

- `service` 能用的路由（只在 staging）：`POST /v1/chat`；`GET /v1/conversations`、它自己的
  `GET /v1/conversations/{id}/messages` 和 `GET …/stream?operation_id=`；`GET /v1/runs/{run_id}`；以及今天匿名就能
  读的 catalog 公开 GET。`/v1/users/*`、`/v1/sessions/adopt`、`/v1/byok/*` 对 `service` 答 403。session 的归属
  规则和今天一样：谁创建的 session，谁能读。
- 身份契约：身份类今天是 `public`（不带身份的公开读）、`anonymous`、`authenticated`（就是 `human`）。本 spec 在
  `IDENTITY_CLASSES` 里加 `service`，并在 `DEFAULT_IDENTITY_POLICY` 里给它一格：限流有值，按身份的日消息配额为空
  （不适用），日成本上限有值。数值直接写在这份策略里，不加 wrangler 变量：`anonymous` 和 `authenticated` 的格在三个
  环境的 wrangler 里都有镜像，`service` 格是明确的例外，由身份矩阵测试的一条用例钉住（三个环境都没有
  `SERVICE_*` 变量，限流器的默认值取自策略）。这份策略是三个环境共用的一份声明：
  `service` 格在 production 和本地开发里也在，但那里注册表产不出 `service`，这一格不起作用。按环境的差别只在
  Access 条目和身份列表配不配。拒绝 `"agent"` 的三处钉子（契约测试两处、edge 身份矩阵测试一处）保持绿：
  `service` 不是 AUTH-1 删掉的 agent 类。
- `service` 的限流和记账按 `(kind, issuer, subject)` 键控，用网关限流策略里已经定义、今天还没接线的 `svc:` 格，
  本 spec 把它接上。这一格只规定方式和键（durable 限流器、出错时拒绝、计入 billing、键是 `svc:<Client ID>`），
  不带数值；数值只有一个来源，就是上一条身份策略里的 `service` 格。human、anonymous、public 的键和今天一样。`service` 不做按身份的日消息配额预留，所以
  "只有匿名预留配额"的数据库约束不动。
- 数据面：`agent_admissions.payer` 的取值加 `service`。这是 pi-session-neon 那条 Prisma 链上的一次迁移，照
  `docs/agents/database-and-migrations.md` 办（表的所有权；迁移失败会冻住整条 CD）。payer 的判定对 `service`
  显式返回 `service`，不落进今天把未知类型当 `user` 的分支。
- 向下游转发的身份头多带主体种类。users Worker 只接受 `human`，和今天一样。
- ADR 0006 的 staging 一行改写，不是在后面追加："none — staging 不自验"这一格改成两句：门是 Cloudflare Access，
  不自验；edge 只为身份列表里的服务令牌验 Access 的断言，产出 `service`。owner 的原则"门交给平台的访问层"不变：
  门仍是 Access，edge 验的是身份断言，和它验 Neon Auth 的 JWT 产出 `human` 是同一件事。这是 owner 决定 1 的
  后果：Cloudflare 要求源站验过 JWT 才能信它的 claims。
- 失败答法：凭据缺失 401，凭据无效 401，发行方不可达 503，两个主体 401，`service` 调不允许的路由 403。匿名开放
  的路由上凭据缺失走匿名管道，这是现状，保留。

### 记录

- 每轮对话的完整记录已经在 Neon 的 pi 记录里：每次模型调用的 assistant 条目带供应商和模型名；每次调用一行
  usage（输入、输出、缓存读、缓存写、总数、费用）；每次工具调用的名字、参数、完整结果、是否出错；`respond`
  的完整结构化答案（流里的 `data-response`）。run 的状态与原因、主体和 payer 在 `agent_admissions` 里。
  本 spec 要的是一个读模型，把这些拼成一轮的记录；不加第二份存储，也不在 turn 时补记。
- 历史读取（`GET /v1/conversations/{id}/messages`）的投影改动，字段只加不改，网页不受影响：
  - 新增返回：所有工具的结果（今天只返回 `respond` 的）；`respond` 的完整数据（今天只回 `intent` 和
    `success`）；逐次调用的模型名、供应商和 usage；run 的状态与原因。新字段写进契约。
  - 继续滤掉：thinking 内容；压缩摘要和其他自定义条目；其他 lane；凭据和 BYOK 材料。
- 流里的 `data-usage` part 不变，它是会话累计；历史读取里的 usage 是逐次的。
- 失败、取消、超时的 turn 只退款不计费，它们的花费不进日用量表，但留在 pi 的 usage 行里。记录照实返回这些行。

### run 与长任务

- 新增 `GET /v1/runs/{run_id}`（`run_id` 就是 operation id）：返回 run 的状态、原因、开始和结束时间、usage 汇总，
  完成时带结构化答案。读的权限和读这个 session 的历史相同；不是主人或 id 不存在，答 404，和重连流一致。
- 两条恢复路径各有用途：网页断线后重连流，接着看实时输出；程序轮询 `GET /v1/runs/{run_id}` 拿 JSON。
  webhook 不在本 spec 内。
- 预算分两档，都从同一个起点算：lane 接受这个 turn 的时刻（pi 持久记下的 `startedAt`）。普通 turn 的上限是
  起点后 100 秒。这个 operation 里模型一旦调用规划工具（`plan_route`），上限变成起点后 600 秒（长任务档，是
  配置，owner 可改）。检查点和今天一样：turn 开始时和每次模型请求前；每个检查点读一次档位。
- 所以规划工具必须在前 100 秒内被模型调用：模型请求的超时本来就被截到剩余预算，100 秒内没调到 `plan_route` 的
  turn 照旧在 100 秒结束。不为"打算规划但还没调用"的 turn 留过渡路径。
- 升档不另存：是否升档，由这个 operation 的 pi 记录里有没有 `plan_route` 的调用决定。这条记录是持久的，
  Durable Object 被逐出后恢复，读到的仍是同一个上限；不加数据库字段，也不往 pi 里写东西。
- 到了上限照旧以 `deadline_exceeded` 结束、退款。

### 幂等

- 把今天的行为原样写进 `packages/contract` 和 OpenAPI，实现不变：
  - 作用域是 session，键是 `x-turn-id` 的值。不带这个头时服务端生成新键，不能重放。模型 turn 和选择 turn 共用
    同一个键空间。
  - 摘要：模型 turn 覆盖 payer、消息正文、模型身份、locale、origin 五项；选择 turn 覆盖 payer 和选择内容两项。
  - 同键、同种类、同摘要是重放：turn 还在排队，答 202 和同一个 `run_id`；已接受或已完成，答原来那条流；已被拒，
    答和第一次相同的拒绝（同样的状态码和原因）。
  - 409 `turn_in_flight` 有两种情况，契约里分开写：同键但种类或摘要不同（这个键用过了，换一个键）；这个
    session 里还有另一个没结束的 turn（等它结束再发）。BYOK 换了模型再重试属于第一种。

### 可观测性

- span 的出口用 pi 的接口：实现 `@earendil-works/pi-telemetry` 的 `TelemetryContext`，把 span 交给 Workers Traces，
  再用 pi 的 `withTelemetryContext` 挂到每个 session 上。pi-agent-core 0.87.1 本来就依赖这个包，今天挂的是 no-op；
  pi 1.0 的 pi-ai 收的也是同一个类型（pi-durable 没有 telemetry 代码），换版本线时适配器不变。
- span 的内容由我们发：pi 0.87.1 实际只发 `pi.harness.hook` 一种 span，1.0 的包一个都不发，也没有 `gen_ai.*`
  属性名。我们在自己的 turn 事件层上，经同一个 `TelemetryContext` 发：每次 Durable Object 调用里，这个 turn 有一个
  turn 级父 span（带 operation id），这次调用里的每次模型调用、每次工具调用各是它的一个子 span。属性只放 id、名字、计数、时长、状态、usage：session id（`gen_ai.conversation.id`）、
  operation id、主体种类、模型名、供应商、工具名。不放 prompt、工具参数、结果正文、凭据。
- 后台跑的 turn 可能跨几次 Durable Object 调用（逐出后由恢复唤醒接着跑），这时有几条 trace、几个 turn 级父 span。
  不跨调用传 span 上下文；按 `gen_ai.conversation.id` 和 operation id 聚合，就能把一轮找全。
- 平台 span 已自带 `faas.version`（部署标签）、`cloudflare.script_tags`、`cloudflare.script_version.id`，
  release 识别不需要再做。
- 导出：只在 staging 开。wrangler 里配 OTLP destination 的名字、采样率和 `persist`；destination 对象在 Cloudflare
  仪表盘创建，是 owner 的一步。staging 全采样。production 不开导出；将来开导出时的采样率在 2026-12-01 计费前由
  owner 定。
- 自定义 span 的平台 API（`cloudflare:workers` 的 tracing）在 edge 现在的 compatibility date 上是否可用，调研记录
  里标着未实测。票 6 先确认它；不可用就先升 compatibility date。
- 日志规则不变：不记路径和 id。两条鉴权失败日志改为只记路由类和失败原因。

### 契约对齐

- 能力操作的唯一定义是 `packages/contract` 的 `catalogContract`。每个 agent 工具声明它调用哪些操作：

  | 工具 | 契约操作 |
  |---|---|
  | `resolve_anime` | `resolve` |
  | `search_bangumi` | `pointsByBangumiId` |
  | `search_nearby` | `geocode`、`nearby` |
  | `plan_route` | `planItinerary` |
  | `translate_anime_title` | `resolve`（查不到时用模型翻译） |
  | `web_search` | 无（外部网页搜索） |
  | `respond` | 无（结构化答案的出口，只做校验） |

- 工具的参数 schema 是给模型看的，可以和契约的输入不一样，不从契约派生。工具调 catalog 只经契约类型的客户端
  （service binding 上的 oRPC 客户端）。
- 对齐测试：每个工具都要有声明，没声明的新工具让测试变红；用一个记录调用的 catalog 传输驱动每个工具，它实际
  调到的操作必须在它的声明里；声明里的每个操作都必须在契约里。测试里所有出站都是假的：catalog 走记录调用的
  传输，`web_search` 的网页请求用桩，`translate_anime_title` 的模型兜底用 `fauxProvider`。测试不碰任何第三方
  上游（仓库护栏）。

### 不动的

- catalog、users、migrator 不开公网。Neon Auth 管人的身份。评测在进程内测 agent（2026-09-09）。
  A2A 服务端不建（DD-10）。pi 的版本线另有安排（见范围外）。本 spec 只有两处碰 pi 的 API：span 适配器
  （pi-telemetry 的接口，1.0 不变）和 turn 预算（读 pi 记的 operation 开始时间和这个 operation 的工具调用）；其余改动都在我们自己的
  admission、记录读模型和网关里。

## 测试决定

好的测试只看外部行为：从一个接缝进去，观察另一个接缝出来的东西，不看内部实现。每条验收标准对应一个接缝，
变异测试是唯一的绿灯证明。

| 接缝 | 测什么 | 先例 |
|---|---|---|
| staging 的 api-test lane（opt-in），每张票加自己的用例 | 票 3：身份令牌调 staging 的 `POST /v1/chat`，被识别为 `service`、走 `svc:` 限流格；同一把令牌调 users、adopt、byok 路由答 403；只带开门令牌时，匿名请求和今天一样。票 4：历史读取有新字段。票 5：`GET /v1/runs/{id}` 返回这一轮的状态和答案。票 6：跑完一轮后，用 Workers Observability 的查询 API 按 operation id 聚合：至少有一个 turn 级 span，每个模型调用和工具调用 span 都挂在某个 turn 级 span 下 | `workers/edge/api-test` 的 `agent-turn.test.ts`、`catalog-api.test.ts` |
| 身份注册表和身份矩阵的 node 测试 | Neon JWT 产出 `human`；Access 服务断言且 Client ID 在列表里产出 `service`；Client ID 不在列表里（开门令牌）不产出身份、走匿名管道；Access 身份断言（`sub` 不为空）不产出身份；Neon JWT 加列表里的服务断言答 401；错的 aud、过期、未知发行方得到规定的失败；production 和本地开发的配置下，同一个服务断言不产出身份；三个环境的 wrangler 都没有 `SERVICE_*` 变量，`service` 的限流默认值取自策略 | `auth-neon.test.ts`、`auth-config.test.ts`、`identity-policy-matrix.test.ts` |
| 数据面的 db 测试 | 迁移后 `payer = 'service'` 能写；`service` 的行不能预留配额 | pi-session-neon 的 `admission.db.test.ts` |
| host 集成测试 | 一轮结束后，历史读取多出所有工具结果、`respond` 的完整数据、逐次的模型名、供应商和 usage、run 状态，原有字段不变；`GET /v1/runs/{id}` 返回状态和答案，不是主人答 404；注入时钟：没调规划工具的 turn 在起点后 100 秒结束；起点后 30 秒调了 `plan_route` 的 turn 越过 100 秒继续，到起点后 600 秒以 `deadline_exceeded` 结束，逐出再恢复后上限不变 | `native-stream.test.ts`、`default-host.test.ts`、`turn-deadline.test.ts` |
| 契约对齐测试 | 每个工具都有声明；在记录调用的 catalog 传输下，工具只调声明里的操作；声明的操作都在契约里。删一条声明、或让工具多调一个操作，测试变红 | `packages/contract/test/public-catalog.test.ts`、`workers/catalog/test/contract-parity.worker.test.ts` |
| 鉴权失败日志的 node 测试 | 两条鉴权失败日志只有 `class` 和 `reason`，没有 `path` 键；今天断言 `path: "/v1/chat"` 的两处改成断言没有 `path` | `auth-fallthrough.test.ts`、`auth-outage.test.ts` |
| span 的 node 测试 | 用 pi 的 `fauxProvider` 驱动一轮，pi-telemetry 的 `InMemoryTelemetryContext` 收 span：一个 turn、N 次模型调用、M 次工具调用，属性只有允许的键；pi 自己的 `pi.harness.hook` span 也收到 | agent 包里用 `fauxProvider` 驱动真实 pi 回合的现有测试 |
| span 适配器的测试（新接缝） | 经我们的 `TelemetryContext` 开的 span，在一个记录调用的 Workers tracing 替身上变成同名、同属性、父子关系相同的 span | 无先例；平台 API 的形状在票 6 开头确认 |
| IaC 测试 | staging 的 `non_identity` 策略里有两把令牌，身份令牌不是开门令牌；production 没有 Access 应用和令牌 | `infra/topology-staging-access.test.ts`、`infra/topology-prod.test.ts` |
| wrangler 配置测试 | 三个环境钉住：只有 staging 配身份令牌的 Client ID 列表和 OTLP 导出；production 的身份相关变量和今天一样 | `workers/edge/test/wrangler-toml.test.ts` |

每张票先写"会怎么坏"，再写红测试，再实现，再做变异测试。E2E 优先：staging 的 lane 是最终证明，
它产出可重复的 artifact。

## 范围外

- 评测：SUT 是 agent，不是网关；评测的 catalog 来源、评估器、基线是另一条票链。
- pi 的版本线：升到 0.99.2 是单独的 issue；pi-durable 的 spike 与迁移是另一份 spec。
- `delegated` 身份（OAuth 2.1、按用户授权）、MCP 服务端、`/v1/catalog/*` 对外开放、Claude Skill、A2A。
  对外开放真实 catalog 数据前还有许可问题（Bangumi 再分发授权未定，Anitabi 点位 CC BY-NC-SA）。
- production 的 Access 应用、production 的 JWKS 配置、production 的 OTLP 导出与采样率。
- webhook。
- 流协议的改动。

## 其他

票的顺序（先安全的切片）：
1. 契约对齐测试 + `x-turn-id` 写进契约。纯代码，不分环境。
2. 鉴权失败日志不记路径。纯代码，很小。
3. `service` 身份（只在 staging）：第二把令牌（IaC）、身份注册表、身份契约的 `service` 格、payer 迁移、`svc:` 限流格
   接线、ADR 0006 那一行改写、staging lane 的身份用例。
4. 完整记录的读模型 + 历史读取的新字段 + lane 的历史用例。
5. `GET /v1/runs/{id}` + 长任务档 + lane 的 run 用例。依赖 4：run 读取复用记录读模型的 usage 汇总和答案。
6. span：确认平台的自定义 span API、pi-telemetry 的适配器、turn/模型/工具 span、staging 的 OTLP 导出配置、lane 的
   span 用例。

owner 的两步：在 ESC 里给第二把令牌加映射（第 3 张票的 staging lane 用例要用）；在 Cloudflare 仪表盘创建 OTLP
destination（第 6 张票的导出要用）。第 6 张票的 lane 用例查 Workers Observability，要一个有可观测性读权限的
API token；现有令牌没有这个权限的话，加权限也是 owner 的一步。
