# Catalog 认证模块设计 · 私有 Worker + 边缘单点认证

> 设计稿(brainstorming 定案 2026-06-21)。范围:混合架构(Catalog CF Worker + Python Agent 容器 + Next.js/OpenNext 边缘)下 catalog 服务的认证。

## 目标

让新 catalog Worker(`/catalog/*`:4 读 API + ingest)在混合架构下**安全**,且**不新增认证系统**。核心结论:catalog 做成**私有 Worker(无公开路由)**,认证仍只在边缘发生一次,catalog 自身零认证代码。

## 背景 / 现状

- **Provider**:Supabase(GoTrue)——人用 JWT;agent/程序用 `sk_` API key(`api_keys` 表存 SHA-256 hash)。
- **现有认证网关 = `frontend/proxy.ts`**(Next.js middleware,跑在边缘 OpenNext Worker):
  - `/v1/*` API:公开路由(search/preview 等)放行;其余要 `Authorization: Bearer`,`sk_`→`validateApiKey`(查 `api_keys`),JWT→`validateJwt`(打 `/auth/v1/user`);通过后**删 Authorization、塞 `X-User-Id`/`X-User-Type` 头**转发。
  - 页面:Supabase session cookie → `getUser()`。
- **后端容器**:`_get_trusted_auth_context` **只信任转发的 `X-User-Id` 头,不重验**;安全性靠"容器不公网直达"。
- **缺口**:新 catalog Worker 零认证;`/catalog/*`(读 + ingest)若公网可达即开放数据 API。

## 关键决策(为何 catalog 私有而非自带认证)

1. **CF Service Bindings**:Worker↔Worker 调用**不经公网 URL**。⟹ catalog Worker 可部署成**无公开路由**,公网打不到,只同账号 Worker 经 binding 可达。
2. **CF Containers `outbound` handler**(2026-03):容器经 HTTP 调 Worker/bindings——控制 Worker 用 `outboundByHost` 截获容器对某 hostname 的请求 → service binding 转给目标 Worker(内部)。解决"agent 是容器、用不了 binding"。
3. **catalog 数据全局**(巡礼点对所有人一样,非 per-user)→ catalog 读**不需要 per-user 上下文**,只需"请求来自可信边界"门槛。per-user 数据(会话/路线归属)在 operational 表 + agent 侧。

⟹ 最优解不是给 catalog 加 JWT 验证,而是**让 catalog 私有 + 认证留边缘一次**。安全不变量从"容器不公网直达"扩展为"**catalog + 容器都不公网直达,只经 binding/边缘**"。攻击面不扩大;catalog 比容器更严(连 X-User 都不需要)。

## 到达路径

| 路径 | 流程 | 认证点 |
|---|---|---|
| 前端公开读 `/v1/{search,spots,routes,bundle}` | 主 worker → proxy.ts 验 Supabase JWT/sk_ → service binding → catalog(路径改写 `/v1/search`→`/catalog/search`) | proxy.ts(边缘) |
| 前端 chat `/v1/chat` | 主 worker → proxy.ts 验 → 容器(agent) | proxy.ts(边缘) |
| agent→catalog(chat 内) | 容器 `outboundByHost` 截获 CATALOG hostname → service binding → catalog | 无(私网 binding) |
| ingest 写 | catalog 内 cron + agent search-miss(经上面 binding)触发 | 无公网写端点 |

## 组件改动

- **catalog Worker**:部署**无公开路由**(不挂自定义域/workers.dev 路由,只 binding 可达);**零认证代码**;无 per-user 上下文;保留现有 503-no-DB guard。
- **`worker/entry.js`**:认证后路由 `/v1/{search,spots,routes,bundle}` → `env.CATALOG` binding(路径改写);`/v1/chat` → 容器;**移除 `/catalog/*` 的公网转发**(只保留内部 binding)。
- **`frontend/proxy.ts`**:基本不变(已验 Supabase + 设 X-User);确认 matcher 覆盖这些 /v1 读路径。
- **容器控制 Worker**:加 `outboundByHost`,把 agent 的 `CATALOG_API_URL` hostname(如 `http://catalog.internal`)→ `env.CATALOG` binding。agent Python 代码不变(仍 httpx 打该 hostname)。

## 写保护(ingest)

ingest **无公网端点**;只 ① catalog 内 cron(预收录/增量)② agent search-miss 经 binding 触发。`catalog_svc` 单写者 DB 角色(migration 已建)兜底:即便误暴露,DB 层只 pipeline 角色能写 catalog 表。

## 本地 dev

- service bindings 在 `wrangler dev` 支持(多 worker dev,或绑到运行中的 catalog)。
- 容器 `outbound` 在 dev 模拟;**`CATALOG_API_URL` 一个环境变量切换**:dev 直连 `http://localhost:8787`,prod 走 binding hostname。零代码分叉。

## 测试

- catalog 无认证可测(私有)。
- **边缘路由+认证**:proxy.ts 对 /v1 读路径验证 + 路由到 binding(扩 `worker/router.test.js` 的路由分类 + dispatch 断言)。
- **容器 outbound→binding**:agent 私网到达 catalog。
- **负向**:catalog 无公开路由(部署配置断言;"直打 catalog 公网 = 不可达"的契约说明)。
- **guard**:沿用现有"边缘验一次→内部信任 X-User"透传测试。

## 不在范围(明确划清)

- 这套**不解决** eval 暴露的 catalog ~50% pg 间歇挂(那是 pg-driver/Hyperdrive 的事,与认证无关,单独处理)。
- 不改 Supabase 认证本身(JWT/sk_ 体系不动)。
- 不引入新密钥/新令牌系统(私有 + binding 即够;若将来 catalog 必须公网暴露,再评估服务令牌)。

## 迁移要点(改什么)

1. `worker/entry.js`:`/v1/{search,spots,routes,bundle}` → CATALOG binding(改写路径);`/v1/chat`→容器;删 `/catalog/*` 公网转发。
2. 容器控制 Worker:加 `outboundByHost` → CATALOG binding。
3. catalog 部署:无公开路由(wrangler 配置 + 部署核对)。
4. 前端:确认读调 `/v1/{search,spots,routes,bundle}`(若仍调旧 catalog 直连路径则切回 /v1)。
5. 测试:路由+认证单测、outbound→binding、catalog-无公网负向断言。
