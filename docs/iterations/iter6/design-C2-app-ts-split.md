# C2 — worker/app.ts 拆分 + worker/ → workers/edge/ 迁移(#652)【v2 定稿】

**结论:按"信任域"拆模块 + 单一组装点,叠加两道顺序保险(owner 2026-08-03 批准):**
1. **显式信任链管道**:`/v1` 匿名路径的闸门序列做成一个 `as const` 数组值
   `V1_TRUST_CHAIN = [resolveIdentity, challengeAnonymous, enforceRateLimit, enforceBudget]`,
   每个 stage 为纯函数 `(ctx) => Continue | ShortCircuit(Response)`;组装层只做 reduce。
2. **顺序守卫测试**:断言 `V1_TRUST_CHAIN.map(s => s.name)` 等于期望序列,**变异验证**(换序/删项必红)。
3. **`Admitted` 类型锁(半剂量 type-state)**:`forwardV1`/`anonymousForward` 的签名改为只接受
   branded 类型 `Admitted`(唯一产源 = 信任链走完的出口);跳过闸门直接转发 = 编译不过。
   仅锁"最后一道门",不给每个 stage 做全量 type-state(单人仓仪式成本不摊)。

迁移与拆分同一 PR 分两个 commit(先 `git mv` 保 blame,再拆);管道化+类型锁为第三个 commit,可独立 revert。

## 现状问题(实测)
- `worker/app.ts` 433 行(限 300),单文件混五种职责:Env 定义(28-42)、路径分类谓词(46-142)、转发原语 `forwardV1`(77-96)、匿名流(162-242,turnstile+限流+预算三闸)、session-migrate(301-310)、镜像代理(332-354)、Hono 组装(372-433)。
- 隐性耦合:`registerWorkerRoutes` 里注册**顺序即安全语义**(users bypass → public → auth → anon 降级),注释承载了大量 owner 裁决(#507/#441/#447),拆分必须保注释随代码走。
- worker/ 不在根 `lint:oxlint` filter 内(`--filter catalog --filter users --filter web`),自身无 oxlint 依赖 → 事实上零 lint(L1 卡一并修)。
- 迁移触点(全部实测):`wrangler.toml:59 main="worker/entry.ts"`(+注释 6/26/272)、根 package.json `test:worker`(26 个文件逐一列名)、`ci.yml:90/92/99/263` path-filter、`worker/tsconfig.json include:["*.ts"]`、`pnpm-workspace.yaml`("worker" 条目已注明 future workers/edge)。

## 方案对比
| | A. Hono 惯用分层(routes/ + middleware/) | B. 信任域模块 + 单一组装点(推荐) | C. 只搬目录不拆 |
|---|---|---|---|
| 形态 | `routes/v1.ts` `routes/proxy.ts` 各自 `new Hono()` 子 app,`app.route()` 挂载;auth 做成 middleware | app.ts 只剩组装(<100 行);策略/流程各自成模块,仍是纯函数 | `git mv` 完事 |
| 顺序语义 | 分散到多文件,users-bypass→auth→anon 的注册顺序不再一眼可见,易被后续 PR 破坏 | 组装仍集中一处,顺序即代码即文档 | 不变 |
| auth 变 middleware | Hono 正统,但本 app 的 auth 不是横切——它是**分叉点**(authed/anon/401 三路),塞进 middleware 要靠 `c.set()` 传状态,反而绕 | 保持显式分支 | — |
| 测试改动 | 大(测试现在直接 import `createWorkerApp`/`isAuthRateLimited` 等具名导出) | 近零(export 面不变,新模块 re-export 或测试改 import 路径一次) | 零 |

**推荐 B。** 这个 app 只有一个真正的 route surface(`/v1/*` 一个 handler 内三路分叉),Hono 的 routes/middleware 分层是为多资源 CRUD 设计的,套在"网关+信任分叉"上是形式主义。

## 拆出清单(workers/edge/ 下)
- `env.ts` — `Env`、`WorkerExecutionContext`(~20 行)
- `routing-policy.ts` — `PUBLIC_V1`/`ANON_V1`/`AUTH_RATE_LIMITED_*` 表 + `isPublicV1/isAnonymousV1/isAuthRateLimited/decodedForRouting/normalizeV1Path`(纯函数,#464 percent-decode 注释随行,~100 行)
- `forward.ts` — `forwardV1`/`forwardPublicCatalog`/`publicCatalogHeaders`/`catalogOutbound`/`authenticatedForward`(~110 行)
- `anonymous-flow.ts` — `handleAnonymousV1` + `anonymousForward/guardBudget/withAnonymousCookie/rateLimitedResponse`(~90 行)
- `trust-chain.ts`(v2 新增)— `V1_TRUST_CHAIN` 数组 + stage 类型 + `Admitted` branded 类型与其唯一构造出口(~40 行)
- `session-migrate.ts` — `SESSION_MIGRATE_PATH` + `handleSessionMigrate` + #507 裁决注释(~45 行)
- `image-proxy.ts` — `handleImageProxy`(~30 行)
- `responses.ts` — `UNAUTHORIZED_BODY/NOT_FOUND_BODY/unauthorized/logInvalidCredential`(~35 行)
- `app.ts` — 仅 `registerWorkerRoutes`+`createWorkerApp`,顺序注释保留(~90 行)
- 既有独立模块(auth/tiles/turnstile/rateLimiter/costBreaker/edgeGuard/containerEnv/entry)原样 `git mv`。

## 破线测试文件(>200 行,实测)拆分原则
turnstile.test 331 / entry.test 263 / containerEnv.test 257 / turnstileArm.test 229 / anonymous.test 207 / byok.test 205(tiles.test 198 贴线)。原则:**按被测行为域切,不对半切** —— turnstile.test → 验证协议(verify/siteverify 契约)与 gate 状态机(pass-window/re-challenge)两文件;entry.test → container 组装(RuntimeContainer/outboundByHost)与路由行为两文件;containerEnv.test → env 构建与 denylist 两文件;anonymous/byok 各按"闸门"(限流/预算/降级)切。共享 fixture 提到 `test-helpers.ts`(mock env/guard 构造器),消灭复制粘贴的 stub。

## 测试策略
- 拆分前后 `pnpm run test:worker` 全绿是唯一门禁;先 mv、跑绿、再拆、再跑绿(两个可独立 revert 的 commit)。
- 新增一条组装回归测试:断言 `/v1/users/*` 不经过 authenticate(现有 authFallthrough.test 已覆盖部分,补 registration-order 断言)。
- v2 新增:`trust-chain.test.ts` 顺序守卫(数组序列断言 + 变异验证换序必红);`Admitted` 类型锁的负向验证用 `@ts-expect-error` type-test(裸 identity 传 forwardV1 必须编译失败)。
- 迁移后 `verify:dependabot` + `wrangler deploy --dry-run` 验 `main` 路径(记忆:root Worker 曾因两份 wrangler 配置从未部署成功——迁移时顺手核对唯一 config)。

## 风险与回滚
- 最大风险:漏改 5 处路径触点之一(尤其 ci.yml path-filter → CI 静默不跑 = 假绿)。对策:PR 内 `grep -rn "worker/" .github wrangler.toml package.json` 清零核对。
- 部署风险:staging merge 后看 healthz/edge 日志;回滚 = revert 两个 commit(mv 与拆分互不纠缠,可单独退)。
- 不做:不改任何运行时行为、不动 auth.ts 内部、不趁机重命名导出。
