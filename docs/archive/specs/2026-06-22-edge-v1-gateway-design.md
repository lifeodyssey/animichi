# Edge /v1 网关:worker 单点认证 + /v1→容器路由(A′)

> 设计稿(2026-06-22)。修复 `/v1/*` 在 prod 不可达的回归,并把 /v1 认证收口到 worker(唯一源)。蓝本 = bc394ea 前的旧 `worker/worker.js`(已验证可用),移植进现在的 Hono app。

## 目标

1. **修 bug**:`/v1/*` 当前落 OpenNext(无 /v1 路由)→ prod 404。改为 worker 把 /v1/* 转发进容器。
2. **认证收口**:worker 验 Supabase JWT/`sk_` → 注入可信 `X-User-*` → 转发容器(容器只信头不重验)。**worker 成唯一 /v1 认证源**。

## 背景

- **回归根因**:`bc394ea`(SSR 迁移)把旧 worker.js 换成 entry.js+OpenNext,"auth 搬去 proxy.ts",但**丢了"转发容器"那一棒**——proxy.ts 验完 `NextResponse.next()` → Next app 无 /v1 路由 → 404。休眠是因同期删了 chat 页(无调用方);本地 `make serve` 直连容器绕过 worker。
- **前端 rebuild 确认本设计**:`docs/frontend-rebuild-plan` 明确 "worker 验 JWT/sk_→注入 X-User-Id;前端不重验"。⟹ worker 当唯一认证源,**无 frontend↔worker 重复**(rebuild 后前端无 auth;当前 Next 的 proxy.ts /v1 分支被 worker 拦截后变死码,rebuild 清理,本次不碰前端)。
- **框架无关**:本工作全在 worker(`/v1` 路由+认证+静态资源无关),当前 Next-OpenNext 和未来 TanStack 都吃得到。

## 设计

Hono app(`worker/app.ts`)新增 `/v1/*` 路由,排在 OpenNext catch-all **之前**:

```
GET 公开 /v1 路由 → 容器(免认证)
其余 /v1/*       → authenticate() → ok? 删 Authorization + 注入 X-User → 容器 : 401
非 /v1           → 现有(healthz/img/OpenNext catch-all)不变
```

- **容器到达**:`env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(req)`(同现有 `/healthz`;`default` 实例保会话后端一致)。
- **公开 /v1 路由**(无认证,来自 DESIGN.md + 旧 worker.js):`/v1/search/preview`、`/v1/bangumi/popular`、`/v1/bangumi/nearby`、`/^\/v1\/bangumi\/[^/]+\/guide$/`。
- **认证**(`worker/auth.ts`,NEW,无 Next 依赖):
  - `Authorization: Bearer <token>` 必需,否则 401。
  - `sk_` → `verifyApiKey`:SHA-256 → 查 Supabase `api_keys`(service-role,`revoked=false`)→ `{userId, userType:"agent"}`;旁路更新 `last_used_at`。
  - 否则 JWT → `verifyJwt`:打 `${SUPABASE_URL}/auth/v1/user`(anon key)→ `{userId, userType:"human"}`。
  - `authenticate(request, env) → {ok, userId?, userType?}`。
- **头处理(安全)**:转发前 `new Headers(req.headers)` → **删 `Authorization`** + **删客户端可能伪造的 `X-User-Id`/`X-User-Type`** → 认证通过后**由 worker 设** `X-User-Id`/`X-User-Type`。**公开路由也要删客户端 X-User**(防伪造身份打到容器;旧 worker.js 公开路由是原样转发,本设计收紧)。

## 需要的 worker 环境变量(wrangler [vars]/secret)

`SUPABASE_URL`(JWT 验证 endpoint)、`SUPABASE_ANON_KEY`(JWT 验证 apikey)、`SUPABASE_SERVICE_ROLE_KEY`(api_keys 查询)。确认这些在 worker env(不止容器 env)。

## 测试(node --test,Node 24,stub env/CONTAINER/fetch)

- 公开 /v1 路由 → 命中容器、**不**调 authenticate。
- 认证 /v1:无 Bearer → 401;无效 token(stub fetch 返 !ok)→ 401。
- 有效 JWT → 容器收到的请求**有 X-User-Id/Type、无 Authorization**;`userType=human`。
- 有效 `sk_` → `userType=agent`;命中 api_keys stub。
- **客户端伪造 X-User-Id** → 转发前被删(authed 路由被 worker 值覆盖;公开路由被删)。
- 非 /v1(healthz/img/未知)行为不变(回归)。
- `worker/auth.ts` 的 verifyJwt/verifyApiKey 单测(stub fetch)。

## 安全不变量

容器信任 `X-User-*` 头 + 只经 worker 可达(wrangler 路由 `域/*`→worker;容器是 DO binding 非公网)。本设计保证:`X-User-*` **只可能由 worker 在认证通过后设**,客户端值一律剥除。

## 不在范围

- catalog 私有化(已完成,SDD)。
- monorepo 迁移、TanStack 前端 rebuild、proxy.ts 清理(rebuild 时做)。
- OpenNext 构建管线修复(随 TanStack rebuild 消失;本设计的 catch-all 仍走现有 nextHandler,不动)。
- 容器自验(zero-trust B′):本设计维持"边缘认证 + 容器信任头"。

## 迁移要点

1. `worker/auth.ts`:移植旧 worker.js 的 `validateJwt`/`validateApiKey`/`authenticate`(无 Next 依赖,返回 `{ok,userId,userType}`)。
2. `worker/app.ts`:加公开 /v1 列表 + `/v1/*` 路由(公开→容器;其余→authenticate→剥头+注入→容器/401);排在 catch-all 前。
3. `wrangler.toml`:确认 `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` 在 worker env。
4. 测试:路由+认证+头剥除+回归(node --test)。
5. 不碰 frontend/proxy.ts(其 /v1 分支变死码,rebuild 清理)。
