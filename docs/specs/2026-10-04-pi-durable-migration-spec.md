# pi 迁移：从 pi-agent-core 的 harness 到 pi-durable（2026-10-04）

状态：owner 2026-10-03 定先做限时 spike（"能用pi的就用pi的"），2026-10-04 定顺序（"0.99开个issue，剩下的做一个
spec吧，spec第一张卡写spike"）。决定记在 `docs/agents/owner-decisions.md` 的 pi version line 一节。依据是调研记录
`docs/iterations/agent-platform-research-2026-10/PI-1.0-PACKAGES-RESEARCH.md`。升到 0.99.2 是 #1995，不在本 spec 内。

术语：harness 指 pi-agent-core 0.87.1 到 0.99.2 里的 `AgentHarness`、session 和 session 存储；业务层指我们自己的
admission、`x-turn-id` 幂等、配额与结算、turn 预算、AI SDK 流的投影、egress 限制。

## 问题

1. pi-agent-core 1.0.0 删掉了 harness。按 0.87.1 算，我们四个包里 import pi-agent-core 的 `.ts` 文件有 186 个，
   其中 185 个用到了已经删掉的名字。0.99.2 是最后一个带 harness 的版本；#1995 先升到这里，但之后不会再有带
   harness 的版本，停在 0.99 只能是过渡。
2. 接替者 pi-durable 自称 Experimental（"The API changes without notice between releases"）。它 09-19 才以 0.0.1
   出现在 npm 上，到今天共十一个版本，10-01 到 10-04 就发了 1.0.0、1.0.1、1.0.2 三版（`npm view @earendil-works/pi-durable time`）；它的 changelog 把 1.0.0 记为
   "Initial release"。
3. 不知道它能不能接住我们：没有现成的 Postgres 后端；我们没在 Workers 上跑过它，只做了 import 的静态分析（它的
   README 把 Durable Objects 列为可运行的环境）；它的 `requestId` 只比类型、不比内容；
   它没有 turn 期限；它的重连从当前视图开始，不重放；它的 `usage()` 连失败和中断的尝试也算。
4. 它依赖 pi-ai ^1.0.2，harness 依赖 pi-ai 0.99。同一个包里两份 pi-ai，`Model`、`AssistantMessage` 这些类型就对不上，
   所以迁移很可能没法一个包一个包地合进 main。
5. 我们的 session 存储今天被几条路径不经 harness 直接读：历史、重连流、结算；eval 的进程内任务直接用 harness 的
   内存 repo。换存储会牵动这些读。

## 方案

- 先做一张限时 spike 卡，回答问题 3 到 5，按下面写定的判据给出 go/no-go，并按证据重排迁移票。spike 的代码不合进
  main。
- 存储默认只量一条路线：给 Neon 按 pi-durable 的 `Storage` 接口写一个后端。这和 2026-10-04 的决定 2（每轮的完整
  记录是唯一事实，platform spec 写明记录在 Neon、不加第二份存储）一致。pi-durable 的 README 还把 Durable Object
  自带的 SQLite 列为可选的运行环境；走那条路要先改决定 2，所以 owner 只有在 spike 开始前明确重开决定 2，spike
  才加量这条路线。
- spike 是 go 时，按它的结论迁移。业务层的语义和对外行为不变，换的是它下面接 pi 的那一层，以及业务层里直接读
  pi 记录的几处。迁移按宽重构处理：除非
  spike 证明两份 pi-ai 能在一个包里共存，否则几张迁移票共用一个集成分支，最后一次合进 main。

## 用户故事

1. 作为 owner，我希望在一个固定的时间盒内，按写定的判据知道 pi-durable 能不能在 Workers 上、用 Neon 跑我们的
   agent，这样我能凭证据决定迁不迁。
2. 作为 owner，我希望 spike 对 Neon 后端给出可比的数据：一致性套件过没过、每轮多少条数据库语句（和今天的存储用
   同样的方法量）、崩溃恢复的保证和今天比怎样，这样 go/no-go 不靠感觉。
3. 作为 owner，我希望 spike 不动主 pnpm catalog 和 lockfile，这样它不挡 #1995 和别的卡。
4. 作为 owner，我希望 pi-durable 的 Experimental 风险被量化：它的发版节奏、我们会用到的 API 面有多大、其中哪些
   标着 experimental（例如 `watchEvents`），以及跟版的预估成本。
5. 作为 owner，我希望迁移后网页、`/v1` 契约、AI SDK 流和 `data-*` part、`x-turn-id`、历史的形状、预算、配额与
   结算的数值都和迁移前一样。
6. 作为 agent tier 的维护者，我希望业务层只经一层适配接 pi-durable，这样 pi 下次改 API 只改这一层。
7. 作为 eval 的维护者，我希望进程内任务换成 pi-durable 的内存存储以后，同一份冻结数据集上的 pass^k 配对比较
   不显示退步（pass^k 加配对分析是 owner 2026-10-03 定的评测方法）。
8. 作为 reviewer，我希望 spike 的每条证据都能照着命令重跑出同样的结果，每张迁移票都有最高层的接缝和变异测试证明。
9. 作为 owner，我希望迁移完成后仓库里不再 import harness，pi 的依赖回到 latest，不再需要的依赖移除。

## 实现决定

### spike（第一张卡）

- 时间盒 2 个工作日，按 lane 的时间算，owner 可改。到点就停，交报告；没回答的问题写"未回答"和原因。
- 最低交付是第 1 问（Workers）有证据的答案。第 1 问判 no-go 时，其余各问不用再做，报告直接写 no-go 和原因；
  只答了第 1 问的报告也算交付，但要写清其余各问停在哪里。
- 卡里先写"会怎么坏"再写证据，至少包括：pi-durable 在 workerd 里起不来；Durable Object 逐出后 `resume()` 接不上；
  Neon 后端过不了一致性套件；每轮语句数比今天多；某处语义差异没有一层兜得住。
- 在一个不进 pnpm workspace 的临时目录里做，有自己的 `package.json` 和 lockfile：pi-durable 1.0.2 依赖
  pi-ai ^1.0.2，放进主 catalog 会和 0.99 线冲突。报告记下这个目录所在 spike 分支的 commit 和 lockfile 的哈希，
  评审席照着就能重跑。
- 基线：spike 开始时 main 上是哪条 pi 线（0.87.1，或 #1995 合并后的 0.99.2），迁移面就按哪条量，报告里写明。
- 不改生产代码，不碰 staging，不请求任何第三方上游，不连任何远端数据库（Postgres 用仓库的测试 Postgres）。
- 模型：先核对 pi-ai 1.0 的 `fauxProvider` 能不能产出中断帧、流式 usage 和 4xx。不能的部分，用仓库现有的手写
  provider 替身的做法补上（我们 0.87.1 时就是因为 faux 缺这三样才写的替身），同样不碰上游。
- 要回答的问题：
  1. Workers：在 workerd 里，用 edge 的 compatibility date（spike 开始时 `workers/edge/wrangler.toml` 里的值，今天是
     2026-07-22）和 flags（今天是 `nodejs_compat`），pi-durable 的 `Harness.open` 加 `MemoryStorage` 跑通一轮：一条
     用户消息、一次工具调用（`resolve_anime` 对一个假的 catalog）、一个答案。记下 `AbortSignal.any`、TypeBox 的
     `new Function` 回退、进程内定时器的表现。再在 Durable Object 里模拟逐出后重开，看 `resume()` 能不能接着跑完。
  2. Neon 后端：按 pi-durable 的 `Storage` 接口写一个最小的 Postgres 后端（调研记录确认没有现成的），跑它自带的
     一致性套件 `registerStorageConformance`。按语句数量每轮的往返，并用同样的方法量今天的 Neon 存储；报告写明
     测试 Postgres 走 TCP，生产的 Neon 驱动只走 WebSocket，所以只比语句数，不比耗时。写清 admission 的事务和
     它的提交怎样排，进程在任意两步之间死掉时，恢复扫描能不能把两边的状态对齐。
  3. 业务层怎么接：用一个最小原型加文字说明，逐条试：admission 和 409 能不能放在 `submit` 前面；预算能不能由宿主
     abort，turn 的开始时间从哪里读（老 harness 叫 operation，pi-durable 里对应 submission 或 run，要核对）；结算能不能接 `usage()`，它连失败和中断的尝试也算，和我们"只给完成的 turn 记账、其余退款"的口径怎样对
     上；AI SDK 流能不能从 `watchEvents` 来，晚加入的 watch 从当前视图开始，和我们的重连差在哪；选择 turn（不经
     模型）能不能走同一套幂等。每处语义差异写明由哪一层兜住。
  4. 风险量化：pi-durable 的发版节奏，我们会用到的 API 面，其中标 experimental 的部分，跟版的预估成本。
  5. 迁移面：按包列出要改的地方，给后续每张票一个规模估计；回答两份 pi-ai 能不能在一个包里共存，决定迁移能不能
     分包合进 main。
- 判据：
  - 第 1 问 go：一轮对话和逐出后的 `resume()` 都在 workerd 里跑完，bundle 里没有只能跑在 Node 的 import。要升
    compatibility date 不算 no-go，报告写明要升到哪天、为什么。
  - 第 2 问 go：一致性套件全过；每轮语句数不多于今天；崩溃恢复的保证不低于今天，即进程在 admission 和 pi-durable
    提交之间任意一步死掉，恢复扫描都能把两边的状态对齐，每一种死法都有一个用例。
  - 第 3 问 go：每一处语义差异都有我们这层兜住，并有最小原型演示。
  - 总判：三问都 go 才是 go；否则是 no-go，写明卡在哪条判据。
- 产出：一份调研记录，放在 `docs/iterations/pi-durable-spike-2026-10/` 下，写上面五问的证据、判据逐条的结果、
  go/no-go 建议和重排后的迁移票清单。原型代码留在 spike 分支，不合并。

### 迁移（spike 判 go 之后）

下面是暂定的切法，spike 报告会重排；每张票再走一次 to-tickets。

1. 存储：Neon 后端和它的一致性套件；历史、重连流、结算的读路径换到新的记录形状。
2. agent 的构造：工具换成 pi-durable 的工具形状，hooks 和 prompt 跟着换；eval 的进程内任务换成 pi-durable 的内存
   存储。
3. edge 的宿主：`SessionAgent` 改用 pi-durable 的 `Harness`；业务层经一层适配接 `submit`、`watchEvents`、`usage()`
   和 abort；platform spec 里碰 pi 的两处跟着换（见下）。
4. 集成与收尾：把集成分支一次合进 main，删掉 harness 的 import 和 0.99 的过渡；pi-ai 升到 latest，pi-agent-core
   还有使用方就升到 latest，没有就移除依赖；文档同步。

除非 spike 证明两份 pi-ai 能在一个包里共存，票 1 到 3 都在一个共用的集成分支上做，各自过自己的接缝；只有票 4
合进 main。

迁移的不变量：

- 对外契约不变：`/v1`、AI SDK 流和 `data-*` part、`x-turn-id` 的语义、历史读取的形状。
- 预算、配额、结算的数值不变；egress 限制不变。
- platform spec 里碰 pi 的两处，迁移时由票 3 换掉：发 span 的事件层改成从 pi-durable 的事件取（`TelemetryContext`
  适配器由 platform spec 的 span 票实现，迁移不改它；pi-durable 没有 telemetry 代码）；turn 预算改成从 pi-durable 读这一轮的
  开始时间和工具调用（对应的 API 由 spike 第 3 问核对）。platform spec 的票先做，迁移票在它们之后接手这两处。

版本：pi-durable 和 pi 的其他包一样跟 latest，不钉住。迁移票开工时取当时的 latest，lockfile 精确记录。之后每次
pi-durable 发版，依赖更新的 PR 要过下面全部接缝；破坏性的发版按迁移处理。

## 测试决定

好的测试只看外部行为：从一个接缝进去，观察另一个接缝出来的东西。

- spike 没有要合并的代码。它的证明是写在调研记录里的可重复命令和输出，带 spike 分支的 commit 和 lockfile 哈希；
  评审席照着重跑，能得到同样的结果。
- 迁移票用现有接缝当安全网：

| 接缝 | 测什么 | 先例 |
|---|---|---|
| 存储一致性套件 | 新后端过 pi-durable 的 `registerStorageConformance`；迁移前 pi-session-neon 跑的是老 harness（0.87.1 起、#1995 后在 0.99.2）的那套 | `packages/pi-session-neon` 的 `storage-conformance.db.test.ts`、`repo-conformance.db.test.ts` |
| edge 的 host 集成测试 | 一轮模型 turn、一轮选择 turn、重连、预算到点、结算，迁移前后同样通过 | `native-stream`、`default-host`、`turn-deadline`、`independent-settlement` |
| staging 的 api-test lane | 迁移后的部署上，一轮对话照常完成 | `workers/edge/api-test` 的 agent-turn |
| e2e 聊天旅程 | 网页上的聊天、断线重连和历史和迁移前一样 | `e2e/` 的 `web-chat-*` 用例 |
| eval 的配对比较 | 同一份冻结数据集，迁移前后的 pass^k 配对比较不显示退步 | `packages/eval` 的 pass^k |

- 每张迁移票先写"会怎么坏"，再写红测试，再实现，再做变异测试。

## 范围外

- 0.99.2 的升级（#1995）。
- pi-server、pi-client、pi-protocol、pi-mcp、pi-codemode、pi-web-ui、pi-session-backend-sqlite-node：调研记录
  §4.3 已判用不上。
- 改业务层的语义（409、预算、配额）。
- platform spec 里的事，它碰 pi 的两处除外（见迁移的不变量）。

## 其他

票的顺序和依赖：

1. spike（时间盒 2 个工作日）：第一张卡，可以立即开始。它不等 #1995；它按开始时 main 上的那条 pi 线量迁移面。
2. 存储、agent 的构造、edge 的宿主三张迁移票：等 spike 报告判 go、owner 决定迁移，并等 #1995 已合并（迁移从
   0.99.2 出发，不在升级前后来回 rebase）。edge 的宿主那张还要等 platform spec 的长任务档和 span 两张票合并，
   因为它要接手这两处。
3. 集成与收尾：等前面三张迁移票。

需要 owner 拍板：spike 开始前，要不要重开决定 2、让 spike 加量 Durable Object 的 SQLite（默认不重开）；spike 交付
后，迁不迁。
