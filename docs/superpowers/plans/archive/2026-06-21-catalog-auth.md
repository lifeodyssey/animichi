# Catalog 认证(私有 Worker + 边缘单点认证)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主 Worker 入口**全重写为 TS + Hono + @cloudflare/containers SDK**,关闭无认证的公网 `/catalog/*` 转发,改用容器 `outboundByHost` → CATALOG service binding 让 agent 私网到达 catalog。

**Architecture:** catalog Worker 本就无公开路由(只 `[[services]] CATALOG` binding 可达)。当前 `worker/entry.js`(手搓 `routeKindFor` + if/else)把公网 `/catalog/*` 转发到 binding(无认证洞),且容器经公网 origin(`CATALOG_API_URL=https://seichijunrei.zhenjia.org`)走这条路。重写为:① `worker/entry.ts` = Hono app(路由 SDK 取代手搓);② 路由仅 `/healthz`、`/img/*`、catch-all→OpenNext,**无 `/catalog/*` 公网路由**;③ `RuntimeContainer.outboundByHost["catalog.internal"]` → `env.CATALOG.fetch`(私网 binding);④ `CATALOG_API_URL=http://catalog.internal`。认证仍只在边缘 proxy.ts(/v1 path);catalog 零认证、信任私网边界。

**Tech Stack:** Node 24(原生 strip TS)+ Hono `^4.9.10`(root 现成,路由 SDK,与 catalog 同栈)+ `@cloudflare/containers ^0.3`(Container DO + outboundByHost)+ OpenNext(`./.open-next/worker.js`,catch-all 委派)。测试:`node --test worker/*.test.ts`(node 24 原生 .ts)。Python `CatalogClient` 不改。

## Global Constraints

- **全 TS + 用 SDK**:worker 入口路由用 **Hono**(不手搓);容器用 **@cloudflare/containers**(`Container`/`outboundByHost`/`getContainer`)。删除手搓的 `worker/router.js`/`router.test.js`。
- **Node 24**:`.nvmrc=24`、`engines.node>=24`、CI 已 `node-version:"24"`(deploy.yml)——核对其余 workflow 的 `NODE_VERSION`。
- catalog Worker **无公开路由**,只经 binding/容器 outbound 可达(已是现状,勿加 route)。
- agent `CatalogClient` 调 `{CATALOG_API_URL}/catalog/<method>`(POST JSON)——**不改 Python**;outbound host 必须 == `CATALOG_API_URL` 的 host。
- 范围外:公开读认证(frontend 现 homepage-only,无读 API 调用方,YAGNI);catalog ~50% pg 挂(pg-driver/Hyperdrive);Supabase 认证体系不动。
- 不加 `eslint-disable`/`type: ignore`/`skip` 等抑制(无用户批准)。
- 保留行为不变:`/healthz`→容器、`/img/*`→图片代理缓存、其余→OpenNext、`RuntimeContainer` 的 env 注入、`DOQueueHandler`/`DOShardedTagCache` 重导出。

---

### Task 1: Node 24 对齐(本地 pin + engines)

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`(加 `engines.node`)

**Interfaces:**
- Consumes: 无
- Produces: 本地/CI 统一 Node 24(node --test 原生跑 .ts 的前提)

- [ ] **Step 1: 切到 Node 24 并固化**

Run: `nvm use 24 && node --version`
Expected: `v24.15.0`(已装)。

- [ ] **Step 2: 写 .nvmrc**

新建 `.nvmrc`,内容一行:
```
24
```

- [ ] **Step 3: package.json 加 engines**

在 `package.json` 顶层加(若已有 engines 则合并):
```json
  "engines": { "node": ">=24" },
```

- [ ] **Step 4: 核对 CI NODE_VERSION 一致**

Run: `grep -rnE 'NODE_VERSION' .github/workflows/`
Expected: 各 workflow 的 `env.NODE_VERSION` 为 `"24"`(deploy.yml 已硬编码 "24")。若有 `"22"` 则改为 `"24"`。

- [ ] **Step 5: Commit**

```bash
git add .nvmrc package.json .github/workflows/
git commit -m "chore: pin Node 24 (native TS strip for node --test) across local + CI"
```

---

### Task 2: 升级 @cloudflare/containers 到 ^0.3

**Files:**
- Modify: `package.json`(`@cloudflare/containers`:`^0.0.25` → `^0.3`)

**Interfaces:**
- Consumes: 无
- Produces: `Container` 支持 `static outboundByHost`、`getContainer`、`ContainerProxy`(Task 4 用)

- [ ] **Step 1: 升级依赖**

Run: `npm install @cloudflare/containers@^0.3`
Expected: 装上 0.3.7,`package-lock.json` 更新。

- [ ] **Step 2: 核对 Container 核心 API（0.0.25→0.3 跨度大）**

人工核对 `node_modules/@cloudflare/containers` 类型:`Container` 仍有 `defaultPort`/`requiredPorts`/`enableInternet`/构造 `super(ctx,env)` + 实例 `envVars`;新增 `static outboundByHost`。Task 4 的 entry.ts 用这些。
Expected: 核心字段名不变;若某字段在 0.3 改名,Task 4 据此调整。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump @cloudflare/containers to ^0.3 for outboundByHost"
```

---

### Task 3: entry.test.ts — Hono 路由 + 容器 outbound 的失败测试

**Files:**
- Create: `worker/entry.test.ts`
- Create(占位,Task 4 实现): `worker/app.ts`

**Interfaces:**
- Consumes: `@cloudflare/containers`(Task 2)
- Produces(供 Task 4 实现的签名):
  - `createWorkerApp(deps: { nextHandler: { fetch: (req: Request, env: unknown, ctx: ExecutionContext) => Promise<Response> } }): Hono<{ Bindings: Env }>` — 可注入 nextHandler 的 Hono app 工厂(测试注入 stub,免 OpenNext 构建产物)
  - `catalogOutbound(request: Request, env: Env): Promise<Response>` = `env.CATALOG.fetch(request)` — 容器 outbound 处理器

> 把可测路由逻辑放 `worker/app.ts`(纯 Hono app + 工厂),`worker/entry.ts`(Task 4)只做"真 nextHandler 注入 + DO 类导出 + outboundByHost 接线"——entry.ts 含 `./.open-next/worker.js` import 不进 node --test,app.ts 进。

- [ ] **Step 1: 写失败测试**

新建 `worker/entry.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, catalogOutbound } from "./app.ts";

const stubNext = {
  fetch: async () => new Response("next", { status: 200 }),
};

test("GET /healthz reaches the container, not OpenNext", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  let containerHit = false;
  const env = {
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: async () => { containerHit = true; return new Response("ok"); } }),
    },
  };
  const res = await app.request("/healthz", {}, env);
  assert.equal(containerHit, true);
  assert.equal(await res.text(), "ok");
});

test("/catalog/* is NOT publicly routed (falls through to OpenNext)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  const res = await app.request("/catalog/search", { method: "POST" }, {});
  assert.equal(await res.text(), "next"); // hits OpenNext (404-able), never env.CATALOG
});

test("unknown path falls through to OpenNext", async () => {
  const app = createWorkerApp({ nextHandler: stubNext });
  const res = await app.request("/anything", {}, {});
  assert.equal(await res.text(), "next");
});

test("catalogOutbound forwards container requests to the CATALOG binding", async () => {
  let received: Request | null = null;
  const env = { CATALOG: { fetch: async (req: Request) => { received = req; return new Response("cat"); } } };
  const req = new Request("http://catalog.internal/catalog/search", { method: "POST" });
  const res = await catalogOutbound(req, env as never);
  assert.equal(await res.text(), "cat");
  assert.equal(received, req);
});
```

- [ ] **Step 2: 建占位 app.ts 让 import 不炸**

新建 `worker/app.ts`:
```ts
export function createWorkerApp(_deps: unknown): never {
  throw new Error("not implemented");
}
export function catalogOutbound(_request: unknown, _env: unknown): never {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test worker/entry.test.ts`
Expected: FAIL — `not implemented`(四个用例全红)。

- [ ] **Step 4: Commit**

```bash
git add worker/entry.test.ts worker/app.ts
git commit -m "test(worker): failing tests for Hono routing + private catalog outbound"
```

---

### Task 4: worker/app.ts + entry.ts 实现（Hono 重写,无公网 catalog,容器 outbound→binding）

**Files:**
- Modify: `worker/app.ts`(实现 `createWorkerApp` + `catalogOutbound` + `handleImageProxy`)
- Create: `worker/entry.ts`
- Delete: `worker/entry.js`、`worker/router.js`、`worker/router.test.js`
- Modify: `wrangler.toml`(第 36 行 `main = "worker/entry.js"` → `"worker/entry.ts"`)

**Interfaces:**
- Consumes: `createWorkerApp`/`catalogOutbound`(Task 3 签名)、`Container`(Task 2)
- Produces: Worker 默认导出(Hono app)+ `RuntimeContainer`(带 outboundByHost)+ DO 重导出

- [ ] **Step 1: 实现 app.ts**

```ts
/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  [key: string]: unknown;
}

interface NextHandler {
  fetch: (req: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>;
}

/** Forward a container-originated catalog request to the private CATALOG binding
 * (in-datacenter hop, never the public internet). Wired as the container's
 * outboundByHost handler in entry.ts. */
export function catalogOutbound(request: Request, env: Env): Promise<Response> {
  return env.CATALOG.fetch(request);
}

/** Image proxy + cache for image.anitabi.cn (unchanged behaviour, ported from entry.js). */
async function handleImageProxy(request: Request, ctx: ExecutionContext): Promise<Response> {
  const imagePath = new URL(request.url).pathname.slice(5);
  if (!imagePath || imagePath.includes("..")) return new Response("Bad request", { status: 400 });
  const cacheKey = new Request(request.url, request);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const upstream = await fetch(`https://image.anitabi.cn/${imagePath}`, {
    headers: { "User-Agent": "Seichijunrei/1.0" },
  });
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg" },
    });
  }
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=604800, s-maxage=2592000");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Set-Cookie");
  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/** The main Worker app. NOTE: no /catalog/* route — catalog is private (reached
 * only via the container outboundByHost binding, never the public internet). */
export function createWorkerApp(deps: { nextHandler: NextHandler }): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/healthz", (c) =>
    c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default")).fetch(c.req.raw),
  );
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.all("*", (c) => deps.nextHandler.fetch(c.req.raw, c.env, c.executionCtx));
  return app;
}
```

- [ ] **Step 2: 跑测试确认通过**

Run: `node --test worker/entry.test.ts`
Expected: PASS（四用例全绿:healthz→容器、/catalog→next、未知→next、catalogOutbound→binding）。

- [ ] **Step 3: 实现 entry.ts（注入真 nextHandler + DO 导出 + outbound 接线）**

新建 `worker/entry.ts`:
```ts
import { Container } from "@cloudflare/containers";
import nextHandler from "./.open-next/worker.js";
import { createWorkerApp, catalogOutbound, type Env } from "./app.ts";

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const CONTAINER_ENV_KEYS = [
  "DEEPSEEK_API_KEY", "SUPABASE_DB_URL", "ANITABI_API_URL", "CATALOG_API_URL",
  "APP_ENV", "CACHE_TTL_SECONDS", "CORS_ALLOWED_ORIGIN", "DEBUG",
  "DEFAULT_AGENT_MODEL", "FALLBACK_AGENT_MODEL", "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT", "LOG_LEVEL", "MAX_RETRIES", "OBSERVABILITY_ENABLED",
  "OBSERVABILITY_EXPORTER_TYPE", "OBSERVABILITY_OTLP_ENDPOINT", "OBSERVABILITY_SERVICE_NAME",
  "OBSERVABILITY_SERVICE_VERSION", "OPENAI_COMPAT_BASE_URL", "RATE_LIMIT_CALLS",
  "RATE_LIMIT_PERIOD_SECONDS", "TIMEOUT_SECONDS", "USE_CACHE", "ZETA_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN", "OPENAI_COMPAT_API_KEY",
];
const CONTAINER_REQUIRED_KEYS = ["DEEPSEEK_API_KEY", "SUPABASE_DB_URL"];

function buildContainerEnvVars(env: Record<string, unknown>): Record<string, string> {
  const envVars: Record<string, string> = { APP_ENV: "production", SERVICE_HOST: "0.0.0.0", SERVICE_PORT: "8080" };
  for (const key of CONTAINER_REQUIRED_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required container env: ${key}`);
    envVars[key] = value;
  }
  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) envVars[key] = value;
  }
  return envVars;
}

export class RuntimeContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  enableInternet = true;
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.envVars = buildContainerEnvVars(env);
  }
}

// Container -> catalog over a private hostname, intercepted here and routed to
// the CATALOG service binding (no public internet). Host matches CATALOG_API_URL.
RuntimeContainer.outboundByHost = {
  "catalog.internal": (request: Request, env: Env) => catalogOutbound(request, env),
};

export default createWorkerApp({ nextHandler });
```

- [ ] **Step 4: 删旧文件 + 改 wrangler main**

```bash
git rm worker/entry.js worker/router.js worker/router.test.js
```
`wrangler.toml` 第 36 行 → `main = "worker/entry.ts"`。

- [ ] **Step 5: wrangler 编译校验（TS + Hono + 容器接线的类型门)**

Run: `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dryrun`
Expected: 编译打包成功。若 `outboundByHost` 报错 → 确认 `@cloudflare/containers@^0.3`(Task 2);若 `hono` 解析失败 → 确认 root `hono ^4.9.10` 已装。

- [ ] **Step 6: 全 worker 测试 + 确认无残留 router import**

Run: `node --test worker/entry.test.ts && grep -rn "router.js" worker/ || echo "no router.js refs"`
Expected: 测试 PASS;无 `router.js` 残留引用。

- [ ] **Step 7: Commit**

```bash
git add worker/app.ts worker/entry.ts wrangler.toml
git commit -m "feat(worker): rewrite entry as Hono app (TS) — private catalog via container outboundByHost"
```

---

### Task 5: CATALOG_API_URL 切私网 hostname

**Files:**
- Modify: `wrangler.toml`(第 49 行 `CATALOG_API_URL`)

**Interfaces:**
- Consumes: Task 4 的 `outboundByHost["catalog.internal"]`
- Produces: prod 容器经 `http://catalog.internal/catalog/<method>` → outbound 截获 → binding

- [ ] **Step 1: 改 prod CATALOG_API_URL**

`wrangler.toml` 第 49 行 `CATALOG_API_URL = "https://seichijunrei.zhenjia.org"` →
```toml
# Container reaches catalog over a private hostname intercepted by
# RuntimeContainer.outboundByHost -> env.CATALOG binding (in-datacenter, no
# public internet). Host MUST match the outboundByHost key in worker/entry.ts.
CATALOG_API_URL = "http://catalog.internal"
```
更新 44-46 行注释:容器不再经公网 origin,改 outbound→binding 私网。

- [ ] **Step 2: 核对 dev 不受影响 + 路径一致**

人工核对:① 本地 `make serve` 用 `.env`/shell 的 `CATALOG_API_URL=http://localhost:8787`(直连,不读 wrangler.toml [vars]);② `catalog_client.py` 拼 `http://catalog.internal/catalog/search`,host `catalog.internal` == entry.ts outboundByHost key。
Expected: dev 直连 localhost:8787;prod host 字符串一致。

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml
git commit -m "feat(worker): route container->catalog over private catalog.internal binding"
```

---

### Task 6: 部署核对清单 + 设计 spec 收口

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-catalog-auth-design.md`

**Interfaces:**
- Consumes: Task 4-5
- Produces: 部署时人工核对的私有性断言

- [ ] **Step 1: 设计 spec 末尾追加"落地核对(部署时)"**

```markdown
## 落地核对(部署时验证私有性)

- [ ] `node --test worker/entry.test.ts` 绿:`/catalog/*` 落到 OpenNext(非 binding)。
- [ ] 部署后 `curl -i https://<prod-domain>/catalog/search -d '{}'` → 404/不可达(经 OpenNext,非 binding)→ 公网 catalog 洞已堵。
- [ ] chat 全链:`POST /v1/chat` → agent → 容器经 `catalog.internal` outbound→binding → catalog 真数据(私网路径通)。
- [ ] catalog Worker 仍无 route(`catalog/wrangler.toml` 无 `route`/`workers_dev`),只 `[[services]] CATALOG` binding 可达。
- [ ] X-User 透传不变:`/v1/*` 经 proxy.ts 验 Supabase → 容器信任 `X-User-Id`(本次未碰)。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-catalog-auth-design.md
git commit -m "docs: catalog auth deployment verification checklist"
```

---

## 自查(spec coverage)

- **全 TS + Hono/容器 SDK** → Task 4(Hono app + @cloudflare/containers),删手搓 router ✓
- **Node 升级** → Task 1(.nvmrc 24 + engines + CI)✓
- **移除公网 /catalog 转发** → Task 4(Hono 无 /catalog 路由)✓
- **容器 outboundByHost → binding** → Task 4 + Task 2(dep ^0.3)✓
- **CATALOG_API_URL dev/prod 切换** → Task 5 ✓
- **catalog 无公开路由** → 现状,Task 6 核对 ✓
- **ingest 无公网写端点** → 随公网 /catalog/* 移除自动达成 ✓
- **测试:路由 + outbound→binding + 负向 + X-User** → Task 3(Hono 路由 + 负向 + outbound)、Task 6(curl 负向 + X-User)✓
- **范围外(公开读认证/pg 挂/Supabase)** → Global Constraints 明列,无 Task(刻意)✓
