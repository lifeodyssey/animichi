# Edge Gateway 结构重构（一次做到位 · 无巡礼 domain）

- Status: **ACCEPTED**（owner 2026-08-06 — Gateway 一次到位；**无**巡礼 domain；**不含实现**）
- Date: 2026-08-06
- Package: `workers/edge`（今日大量文件平铺；运行时 deps 仍在**根** `package.json` / `wrangler.toml`）
- Tier: **Gateway**（monorepo §4.3 LOCKED）
- Parents: monorepo-target-layout · greenfield-language-and-data-plane · CONTEXT.md
- Scope: **已有代码** 真结构 + package-ize + greenfield path；**无** 巡礼产品 enabler

---

## 0. 关于「domain model」—— Edge **不用**

| 概念 | Edge 是否用 |
|---|---|
| 巡礼 **DDD domain model**（Point / Bangumi / Itinerary / SavedRoute 实体与不变量） | **否** — 那些归 Catalog / Users / Agent |
| 目录名 `domain/` | **否** — 禁止 mkdir 假 domain |
| Gateway **关切词汇**（Identity / Forward / Policy / RateLimit） | **是** — 这是网关语言，不是巡礼领域模型 |
| Clean Architecture 四圈教科书 | **否** — Gateway 用 **关切分包 + 纯 policy 函数 + 薄 adapter** |

一句话：**Edge 没有业务 domain model；有的是网关策略与转发。**
若文档出现 “policy / identity”，指 **接入控制**，不是 DDD Aggregate。

---

## 1. 目标（一次最好）

1. **Package-ize 一次到位**：edge 运行时依赖、wrangler、测试入口全部在 `workers/edge`；根只编排。
2. **目录一次到位**：按关切进 `src/`，测试进 `test/`（或 `__tests__`），禁止再扁平堆根。
3. **策略可单测**：path allowlist / public catalog / rate-limit 范围 = **纯函数**，零 CF 绑定。
4. **Greenfield path 一次对齐**：`/catalog/itinerary`、`/v1/users/saved-routes` 等随 contract 改（与 G1 同波或紧后）。
5. **不半吊子**：不做「先只 rename 文件名、目录下个迭代再说」。

---

## 2. 现状 inventory（实盘）

### 2.1 生产模块（`workers/edge/*.ts`，排除 `*.test.ts`）

| 模块 | 角色 |
|---|---|
| `entry.ts` | Worker default export；Container 类；`outboundByHost` |
| `app.ts` | Hono 组装、路由挂载、容器冷启动重试 |
| `env.ts` / `entry-env.ts` | Env 类型与校验 |
| `auth.ts` | JWT / API key 身份 |
| `anonymous-flow.ts` / `anonymous-id.ts` | 匿名 /v1 流 |
| `turnstile.ts` | Turnstile 门 |
| `forward.ts` | 转发 Catalog / Users / 容器 + identity 头 |
| `routing-policy.ts` | 公网 v1 / 鉴权限流路径谓词 |
| `catalog-policy.ts` | 匿名 catalog GET allowlist |
| `rate-limiter.ts` / `cost-breaker.ts` | 限流与成本闸 |
| `edge-guard.ts` / `guard-store.ts` | DO 护栏存储 |
| `image-proxy.ts` / `tiles.ts` / `showcase.ts` | 资产 proxy |
| `container-env.ts` | 容器 env / egress denylist 数据 |
| `session-migrate.ts` | 会话迁移边车路径 |
| `responses.ts` | 标准 JSON 体 |
| `*-doubles.ts` | 测试 double（应离开生产树） |

**痛点：** 包根 = 生产 + 测试 + doubles 混放；根 monorepo 持 hono/jose/containers 依赖；`package.json` name 仍像「整仓 worker」。

### 2.2 正确碎片（保留语义）

- Identity 注入后转发（不预鉴权 Users 的二次模型 — Users 自验签）
- Public catalog / public v1 与 authenticated 分轨
- Percent-decode 后做限流匹配（防编码绕过）
- Container → `catalog.internal` 私有 binding
- 非 HTML：未匹配 → JSON 404（页面归 web）

---

## 3. 目标树（一次最好 · 无 `domain/`）

```text
workers/edge/
  package.json              # 运行时 deps 全部在此（自根迁入）
  wrangler.toml             # 自根迁入；entry = src/entry.ts
  tsconfig.json
  AGENTS.md
  CONTEXT.md
  src/
    entry.ts                # default export + RuntimeContainer
    app.ts                  # createWorkerApp — 只组装
    env.ts
    identity/
      auth.ts
      anonymous-flow.ts
      anonymous-id.ts
      turnstile.ts
    gateway/
      forward.ts
      routing-policy.ts     # 纯函数
      catalog-policy.ts     # 纯函数
      responses.ts
      session-migrate.ts
    protect/
      rate-limiter.ts
      cost-breaker.ts
      edge-guard.ts
      guard-store.ts
    proxy/
      image-proxy.ts
      tiles.ts
      showcase.ts
    container/
      container-env.ts
      # outbound host table 可留 entry 旁或 container/outbound.ts
  test/
    *.test.ts
    doubles/                # guard-doubles, turnstile-doubles
```

**禁止：**

```text
src/domain/                 # 不要
src/application/plan-itinerary.ts
entities/Point.ts
```

---

## 4. 文件搬家表（from → to）

| 今日 | 目标 |
|---|---|
| `workers/edge/entry.ts` | `src/entry.ts` |
| `workers/edge/app.ts` | `src/app.ts` |
| `workers/edge/env.ts` · `entry-env.ts` | `src/env.ts`（合并若重复） |
| `auth.ts` | `src/identity/auth.ts` |
| `anonymous-flow.ts` · `anonymous-id.ts` | `src/identity/` |
| `turnstile.ts` | `src/identity/turnstile.ts` |
| `forward.ts` | `src/gateway/forward.ts` |
| `routing-policy.ts` · `catalog-policy.ts` | `src/gateway/` |
| `responses.ts` · `session-migrate.ts` | `src/gateway/` |
| `rate-limiter.ts` · `cost-breaker.ts` | `src/protect/` |
| `edge-guard.ts` · `guard-store.ts` | `src/protect/` |
| `image-proxy.ts` · `tiles.ts` · `showcase.ts` | `src/proxy/` |
| `container-env.ts` | `src/container/container-env.ts` |
| `*-doubles.ts` | `test/doubles/` |
| `*.test.ts`（包根） | `test/*.test.ts` |
| 根 `package.json` edge runtime deps | `workers/edge/package.json` |
| 根 `wrangler.toml` | `workers/edge/wrangler.toml` |
| 根 `pnpm test:worker` 路径 | `pnpm --filter edge-worker test`（或等价） |

**化简（同列车，非半吊子）：**

| 化简 | 做法 |
|---|---|
| Path 规范化 + decode | 单一 `gateway/path.ts`：normalize trailing slash + decodeURIComponent；routing 与 rate-limit **共用** |
| Public path 表 | `routing-policy` / `catalog-policy` 常量一处导出；app 不散落魔法字符串 |
| Env 双文件 | `env.ts` 合并类型与解析，删冗余 `entry-env` 若可 |
| Doubles 污染生产 import | 测试只从 `test/doubles` 引 |

---

## 5. Pattern（Gateway · 非 DDD domain）

| 用 | 含义 | 不用 |
|---|---|---|
| **Identity resolution** | Request → AuthResult | User Aggregate |
| **Routing policy** | 纯 pathname → 分支 | 业务规则引擎 |
| **Forward** | binding.fetch + 头清理/注入 | 在 edge 重写 body 业务字段 |
| **Protect** | rate limit / cost / DO guard | 计费 domain 服务 |
| **Proxy** | 图/瓦片/R2 | 在 edge 实现 catalog SQL |
| **Container adapter** | 启动/env/egress | 把 agent 逻辑搬进 worker |

**SOLID 在 Gateway 的落点：**

- **S：** `app.ts` 只组装；policy 与 forward 分离
- **O：** 新公网 path = 改 policy 表，不改 Container 类
- **I：** 不要求 forward 依赖整包 Env 的每个字段（可收窄参数类型）
- **D：** 测试注入 `authenticate` / `fetch` / clock（已有 seam 则保留并统一）

**1-10-50：** 继续拆 >10 行函数；`app.ts` / `auth.ts` / `tiles.ts` 超标则按关切再拆文件，**不** 引入无意义 base class。

---

## 6. Greenfield（path · 一次对齐）

| 区域 | 动作 |
|---|---|
| `catalog-policy` allowlist | 路径随 catalog contract（如 itinerary 取代 route） |
| `routing-policy` public/auth 表 | 与 agent/users 公网 path 同步；**不**发明业务语义 |
| Users 转发 | `/v1/users/*` 保持；子 path `saved-routes` 由 Users 契约定，edge 只前缀转发 |
| 响应体 | edge **不** 定义 Point/Itinerary 类型；透传或固定 gateway 错误 envelope |

---

## 7. PR 切片（已有代码 · 建议仍可审查，但目标态完整）

| 切片 | 内容 | 完成判据 |
|---|---|---|
| **E0** | 本文 ACCEPTED | 文档 |
| **E1** | Package-ize：deps + wrangler + CI scripts 迁入 `workers/edge`；根变编排 | deploy/test 绿；根无 hono 业务 deps |
| **E2** | `src/` + `test/` 搬家（上表）；更新 imports | typecheck + `test:worker` 绿 |
| **E3** | path 工具合并 + policy 常量收敛 | 限流/公网测不回归 |
| **E4** | Greenfield path 字符串（与 contract G1 同波） | allowlist 测更新 |
| **E5** | AGENTS.md / CONTEXT 路径；删空 husk | 文档与树一致 |

**允许 E1+E2 合并为一大 PR**（「一次最好」）若 CI 扛得住；**禁止** 只改名不搬家、或只搬家不 package-ize 却宣称完成。

---

## 8. Non-goals

| 不做 | 去向 |
|---|---|
| 巡礼 domain / itinerary 规划 | Catalog |
| SavedRoute / Share / Check-in 业务 | Users + tickets |
| CF Images 替换整条图链 | #682 等 |
| DO 限流换 native binding 大改 | #680 |
| HTML 页面 | apps/web |
| monorepo 其他包目录 | 各包自己的结构文 |

---

## 9. 验收（实现后）

- [ ] 无 `workers/edge/src/domain`
- [ ] 根 `package.json` 无 edge 运行时业务依赖
- [ ] 生产 ts 均在 `src/**`；测试在 `test/**`
- [ ] policy 纯函数可在 node:test 无 binding 跑
- [ ] 公网/鉴权/容器/proxy 既有测绿

---

## 10. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：Gateway 一次到位；明确 **无** 巡礼 domain model |
| 2026-08-06 | Owner **ACCEPTED**（routes/features 方案一并确认会话） |
