# Edge /v1 网关(A′)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** worker 成为唯一 /v1 认证源并把 `/v1/*` 转发进容器——修复 `/v1/*` 落 OpenNext→prod 404 的回归。

**Architecture:** 现有 Hono app(`worker/app.ts`)新增 `/v1/*` 路由(排 OpenNext catch-all 前):公开路由直转容器;其余 `authenticate()`(Supabase JWT/sk_)→ 剥 Authorization+客户端 X-User、注入可信 X-User → 容器,失败 401。认证逻辑移植自 bc394ea^ 的 `worker/worker.js`,落 `worker/auth.ts`(无 Next 依赖)。容器经 `env.CONTAINER` DO(同 `/healthz`)。

**Tech Stack:** Hono `^4.9.10`、`@cloudflare/workers-types`、Node 24 内建 `node --test`(原生 .ts)、webcrypto(`crypto.subtle`)。Python 容器不改。

## Global Constraints

- **不碰前端**(`frontend/proxy.ts` 的 /v1 分支被 worker 拦截后变死码,rebuild 时清理)。
- `worker/auth.ts` **无 Next 依赖**,用 `env.SUPABASE_*` + 全局 `fetch`(可注入 `fetchImpl` 便于测试)。
- 公开 /v1 路由 = 对齐 `frontend/proxy.ts:9,13` 现有契约,**精确**为:`/v1/search/preview`、`/v1/bangumi/popular`、正则 `/^\/v1\/bangumi\/[^/]+\/guide$/`(**nearby 不公开,是认证路由**)。
- **头剥除**:转发前对**所有 /v1**(公开+认证)删客户端 `X-User-Id`/`X-User-Type`(防伪造);认证路由另删 `Authorization` 并由 worker 设 `X-User-*`。
- 容器到达:`env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(req)`(`default` 实例保会话一致)。
- 测试:`~/.nvm/versions/node/v24.15.0/bin/node --test worker/*.test.ts`;DI 注入 stub(`fetchImpl`/`authenticate`/`CONTAINER`),**不打网络、不改全局**。
- 不加 `eslint-disable`/`type: ignore`/`skip` 等抑制;无 `any`(用 typed `Env` + `AuthResult`)。
- 范围外:catalog(已完成)、monorepo 迁移、TanStack rebuild、proxy.ts 清理、OpenNext catch-all(维持现有 nextHandler)。

---

### Task 1: worker/auth.ts — Supabase JWT/sk_ 验证(无 Next 依赖)

**Files:**
- Create: `worker/auth.ts`
- Test: `worker/auth.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type AuthResult = { ok: true; userId: string; userType: "human" | "agent" } | { ok: false }`
  - `type AuthEnv = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }`
  - `authenticate(request: Request, env: AuthEnv, fetchImpl?: typeof fetch): Promise<AuthResult>`(Task 2 用;默认 `fetchImpl = fetch`)

- [ ] **Step 1: 写失败测试**

新建 `worker/auth.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "./auth.ts";

const ENV = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;
}

function bearer(token: string): Request {
  return new Request("https://app/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

test("no Authorization header -> {ok:false}", async () => {
  const r = await authenticate(new Request("https://app/v1/chat"), ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false });
});

test("valid JWT -> human + userId from /auth/v1/user", async () => {
  const r = await authenticate(bearer("jwt-token"), ENV, stubFetch((url) => {
    assert.ok(url.endsWith("/auth/v1/user"));
    return new Response(JSON.stringify({ id: "user-123" }), { status: 200 });
  }));
  assert.deepEqual(r, { ok: true, userId: "user-123", userType: "human" });
});

test("invalid JWT (upstream !ok) -> {ok:false}", async () => {
  const r = await authenticate(bearer("bad"), ENV, stubFetch(() => new Response("", { status: 401 })));
  assert.deepEqual(r, { ok: false });
});

test("valid sk_ key -> agent + userId from api_keys", async () => {
  const r = await authenticate(bearer("sk_live_abc"), ENV, stubFetch((url) => {
    if (url.includes("/rest/v1/api_keys") && url.includes("select=user_id"))
      return new Response(JSON.stringify([{ user_id: "agent-9" }]), { status: 200 });
    return new Response("", { status: 200 }); // PATCH last_used_at best-effort
  }));
  assert.deepEqual(r, { ok: true, userId: "agent-9", userType: "agent" });
});

test("unknown sk_ key (no rows) -> {ok:false}", async () => {
  const r = await authenticate(bearer("sk_nope"), ENV, stubFetch((url) =>
    url.includes("/rest/v1/api_keys") ? new Response("[]", { status: 200 }) : new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `~/.nvm/versions/node/v24.15.0/bin/node --test worker/auth.test.ts`
Expected: FAIL(`authenticate` 未实现/模块不存在)。

- [ ] **Step 3: 实现 worker/auth.ts(移植 bc394ea^ worker.js,TS 化 + fetchImpl 注入)**

```ts
/// <reference types="@cloudflare/workers-types" />

export type AuthResult =
  | { ok: true; userId: string; userType: "human" | "agent" }
  | { ok: false };

export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

async function verifyJwt(token: string, env: AuthEnv, f: typeof fetch): Promise<{ ok: true; userId: string } | { ok: false }> {
  try {
    const resp = await f(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!resp.ok) return { ok: false };
    const user = (await resp.json()) as { id?: string };
    return user.id ? { ok: true, userId: user.id } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyApiKey(rawKey: string, env: AuthEnv, f: typeof fetch): Promise<{ ok: true; userId: string } | { ok: false }> {
  try {
    const keyHash = await sha256Hex(rawKey);
    const sr = env.SUPABASE_SERVICE_ROLE_KEY;
    const resp = await f(
      `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}&revoked=eq.false&select=user_id`,
      { headers: { apikey: sr, Authorization: `Bearer ${sr}` } },
    );
    if (!resp.ok) return { ok: false };
    const rows = (await resp.json()) as { user_id: string }[];
    if (!rows.length) return { ok: false };
    void f(`${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}`, {
      method: "PATCH",
      headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });
    return { ok: true, userId: rows[0].user_id };
  } catch {
    return { ok: false };
  }
}

/** Authenticate a /v1 request: `sk_*` -> api_keys (agent), else JWT -> /auth/v1/user (human). */
export async function authenticate(request: Request, env: AuthEnv, fetchImpl: typeof fetch = fetch): Promise<AuthResult> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { ok: false };
  const token = header.slice(7).trim();
  if (!token) return { ok: false };
  if (token.startsWith("sk_")) {
    const r = await verifyApiKey(token, env, fetchImpl);
    return r.ok ? { ok: true, userId: r.userId, userType: "agent" } : { ok: false };
  }
  const r = await verifyJwt(token, env, fetchImpl);
  return r.ok ? { ok: true, userId: r.userId, userType: "human" } : { ok: false };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `~/.nvm/versions/node/v24.15.0/bin/node --test worker/auth.test.ts`
Expected: 5/5 PASS,pristine。

- [ ] **Step 5: Commit**

```bash
git add worker/auth.ts worker/auth.test.ts
git commit -m "feat(worker): auth.ts — Supabase JWT/sk_ verification (Next-free, injectable fetch)"
```

---

### Task 2: worker/app.ts — /v1 网关路由(认证 + 头剥除 + 转发容器)

**Files:**
- Modify: `worker/app.ts`
- Test: `worker/entry.test.ts`(扩展)

**Interfaces:**
- Consumes: `authenticate`、`AuthResult`、`AuthEnv`(Task 1)
- Produces:
  - `Env` 增 `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY: string`
  - `createWorkerApp(deps: { nextHandler: NextHandler; authenticate?: (req: Request, env: Env) => Promise<AuthResult> })`(新增可选 `authenticate` 便于测试;默认用 Task 1 的真实现)

- [ ] **Step 1: 写失败测试(扩 worker/entry.test.ts)**

在 `worker/entry.test.ts` 追加(复用文件内已有的 `createWorkerApp`/`stubNext`/`stubCtx`;若无 `stubCtx` 则按此定义):
```ts
const stubCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function envWithContainer(captured: { req?: Request }) {
  return {
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: async (r: Request) => { captured.req = r; return new Response("container"); } }),
    },
  } as never;
}

test("/v1 public route -> container, no auth called", async () => {
  let authCalled = false;
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => { authCalled = true; return { ok: false }; } });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/popular", {}, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
});

test("/v1 authed route without creds -> 401, container not hit", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: false }) });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/chat", { method: "POST" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.req, undefined);
});

test("/v1 authed route with valid creds -> container gets X-User, no Authorization", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: true, userId: "u1", userType: "human" }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), "u1");
  assert.equal(cap.req?.headers.get("X-User-Type"), "human");
  assert.equal(cap.req?.headers.get("Authorization"), null);
});

test("client-forged X-User-Id is stripped on authed route (worker value wins)", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: true, userId: "real", userType: "human" }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), "real");
});

test("client-forged X-User-Id is stripped on PUBLIC route too", async () => {
  const app = createWorkerApp({ nextHandler: stubNext, authenticate: async () => ({ ok: false }) });
  const cap: { req?: Request } = {};
  await app.request("/v1/bangumi/popular", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `~/.nvm/versions/node/v24.15.0/bin/node --test worker/entry.test.ts`
Expected: FAIL(/v1 路由未实现 → 命中 catch-all 返 "next" 或 createWorkerApp 不认 authenticate dep)。

- [ ] **Step 3: 改 worker/app.ts(加 /v1 网关 + Env SUPABASE 字段 + authenticate dep)**

① `Env` 接口加三字段:
```ts
export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  [key: string]: unknown;
}
```
② 顶部 import + 公开路由判定 + 转发助手:
```ts
import { authenticate as realAuthenticate, type AuthResult } from "./auth.ts";

const PUBLIC_V1 = ["/v1/search/preview", "/v1/bangumi/popular"];
function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.includes(pathname) || /^\/v1\/bangumi\/[^/]+\/guide$/.test(pathname);
}

/** Forward a /v1 request to the container's default instance. Always strips
 * client-supplied X-User-* (anti-forgery); on authed paths also strips
 * Authorization and injects the worker-verified identity. */
function forwardV1(env: Env, request: Request, auth?: { userId: string; userType: string }): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("X-User-Id");
  headers.delete("X-User-Type");
  if (auth) {
    headers.delete("Authorization");
    headers.set("X-User-Id", auth.userId);
    headers.set("X-User-Type", auth.userType);
  }
  const forwarded = new Request(request, { headers });
  return env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(forwarded);
}
```
③ `createWorkerApp` 签名加 `authenticate?`,并在 catch-all **之前**注册 `/v1/*`:
```ts
export function createWorkerApp(deps: {
  nextHandler: NextHandler;
  authenticate?: (request: Request, env: Env) => Promise<AuthResult>;
}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const authenticate = deps.authenticate ?? ((req, env) => realAuthenticate(req, env));
  app.get("/healthz", (c) =>
    c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default")).fetch(c.req.raw),
  );
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.all("/v1/*", async (c) => {
    if (isPublicV1(new URL(c.req.url).pathname)) return forwardV1(c.env, c.req.raw);
    const auth = await authenticate(c.req.raw, c.env);
    if (!auth.ok) {
      return c.json({ error: { code: "unauthorized", message: "Valid credentials required." } }, 401);
    }
    return forwardV1(c.env, c.req.raw, { userId: auth.userId, userType: auth.userType });
  });
  app.all("*", (c) => deps.nextHandler.fetch(c.req.raw, c.env, c.executionCtx));
  return app;
}
```
(注:`realAuthenticate` 用默认全局 fetch;`Env` 含 SUPABASE_* 满足 `AuthEnv`。)

- [ ] **Step 4: 跑测试确认通过(新 5 例 + 原有回归全绿)**

Run: `~/.nvm/versions/node/v24.15.0/bin/node --test worker/entry.test.ts`
Expected: 全 PASS(原 healthz/catalog→next/unknown→next/catalogOutbound/img + 新 5 个 /v1 用例),pristine。

- [ ] **Step 5: Commit**

```bash
git add worker/app.ts worker/entry.test.ts
git commit -m "feat(worker): /v1 gateway — auth + X-User injection + container forward (fixes /v1 404)"
```

---

### Task 3: wrangler.toml — 确认 worker 运行时有 SUPABASE_* 凭据

**Files:**
- Modify: `wrangler.toml`

**Interfaces:**
- Consumes: 无(部署配置)
- Produces: worker env 具备 `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`

- [ ] **Step 1: 核对现状 + 落实**

`worker/app.ts` 的 /v1 认证在**运行时**读 `env.SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`。当前 `wrangler.toml` 仅在注释(行 15-17)记载这三者,未在 `[vars]`,也不在 `CONTAINER_ENV_KEYS`。旧 worker.js 用过它们(应为已设的 secrets,bc394ea 后可能仍在部署中)。
- `SUPABASE_URL`:非敏感 → 加入 `[vars]`(与现有 `CATALOG_API_URL` 同块):
```toml
SUPABASE_URL = "https://<project>.supabase.co"
```
（用真实 project URL;若已有等价 var 则复用,不重复。）
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`:**敏感 → secrets,不入 [vars]**。在 `[vars]` 上方注释明确:这两者经 `wrangler secret put SUPABASE_ANON_KEY` / `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` 配置(行 15-17 注释保留/收紧)。
- **部署核实**(人工,非本卡代码):`wrangler secret list` 确认两者已在目标 worker;缺则 `wrangler secret put`。

- [ ] **Step 2: 校验配置语法**

Run: `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dryrun-v1 2>&1 | tail -5`
Expected: 若 `.open-next` 存在则编译通过;若因 `.open-next` 缺失报错(已知,见 monorepo 迁移 spec C1),则改用 `node -e "require('@iarna/toml') ? 0 : 0"` 不可行——退而人工核对 toml 语法 + 确认无 secrets 写入 [vars]。**至少**确认 `SUPABASE_ANON_KEY`/`SERVICE_ROLE_KEY` 未出现在 `[vars]`(只 SUPABASE_URL 可在 [vars])。

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml
git commit -m "chore(worker): document + wire SUPABASE_* in worker env for /v1 auth"
```

---

## 自查(spec coverage)

- **修 /v1→容器 404** → Task 2(/v1 路由转发容器)✓
- **worker 单点认证(JWT/sk_)** → Task 1(auth.ts)+ Task 2(接线)✓
- **公开路由对齐 proxy.ts(search/preview、bangumi/popular、guide;nearby 认证)** → Task 2 `isPublicV1` ✓
- **头剥除(删 Authorization + 客户端 X-User;公开路由也删)+ 注入可信 X-User** → Task 2 `forwardV1` + 测试(伪造防护×2)✓
- **SUPABASE_* 在 worker env** → Task 3 ✓
- **测试:路由+认证+头剥除+伪造+回归** → Task 1(auth 5 例)+ Task 2(/v1 5 例 + 原回归)✓
- **不碰前端 / 无 Next 依赖 / 蓝本 worker.js** → Global Constraints + Task 1 移植 ✓
- **范围外(catalog/迁移/rebuild/OpenNext catch-all)** → Global Constraints 明列,无 Task ✓
