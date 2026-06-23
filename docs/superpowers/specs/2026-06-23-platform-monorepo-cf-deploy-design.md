# Platform Monorepo + CF-native 组件独立部署 + Pulumi IaC 设计

> 2026-06-23。把仓库重构成 **platform monorepo**(apps + workers + packages + infra-as-code + 共享 CI),让每个组件按 **Cloudflare 最佳实践**独立部署。本次**先搞后端**(catalog / agent 容器 / edge)+ 必要的前端**部署**解耦;前端**代码重写**(TanStack/P4)押后。Pulumi(state on R2)现在就上。
>
> **更新 2026-06-23**:DB 改用 **Neon**(免费 branching)+ **Supabase 降为 auth-only** — 见 [`2026-06-23-multi-env-neon-supabase-design.md`](./2026-06-23-multi-env-neon-supabase-design.md)。本 spec 中所有"Supabase pg / Hyperdrive→Supabase"改为 **Hyperdrive→Neon**;新增 **staging** Pulumi stack;auth 仍 Supabase(edge JWT 验证不变)。

## §0 背景与动机

### 触发
v0.3.0 tag 部署失败:`deploy` job 在 `download-artifact frontend-out` 就挂(静态-export 时代遗留),后续(迁移/catalog/edge 部署)全 skip。根因不是单点 bug,而是**部署链路的结构问题**:

- root `wrangler.toml`(name=`seichijunrei`)把 **edge worker + 前端(OpenNext)+ agent 容器 + catalog service binding** 全塞进**一个** wrangler deploy。一处坏 → 全挂。
- `worker/entry.ts` 硬 `import nextHandler from "./.open-next/worker.js"` → edge 与前端**代码级耦合**。
- `frontend-build` 跑 `next build`(产 `.next/`,**不产** `.open-next/`)+ upload `frontend/out`(不存在)+ 缺 `open-next.config.ts` → OpenNext 部署链路**从未跑通**(v0.2.0 是静态 export 时代)。
- catalog 已是独立 Worker,却被塞进同一 deploy job + gate 在前端 build,被前端故障带挂。

### 目标
1. **组件独立部署**:catalog / agent 容器 / edge / web 各自独立部署,一个组件的部署问题不阻塞其它。
2. **CF-native**:用 Cloudflare Workers Routes(多 Worker 同 zone、最具体路由优先)分流,而非 edge 转发;OpenNext app 作标准独立 Worker。
3. **monorepo 最佳实践**:`apps/ workers/ packages/ infra/` 布局 + pnpm workspace + 每组件独立 CI/build/deploy。
4. **IaC**:Pulumi(TypeScript,state on R2)管声明式 infra;wrangler 管 worker 代码 + 容器部署。
5. **先后端**:catalog/agent/edge 先落地上线;前端仅做部署解耦(代码不重写)。

### 现状基线
- prod = v0.2.0(老 static-export 前端 + 单 worker),健康。**prod 当前没有 catalog、没有 hybrid 后端**。
- main = `8c365f1`(hybrid rewrite squash-merge,部署链路坏)。代码已在 main。
- 栈 = npm + 各叶 `package-lock.json`,无 workspace;Node 24;前端 Next 16 + `@opennextjs/cloudflare`(无 TanStack、无 `apps/`)。
- 分支 `backend-survey`。

## §0.5 Spike 后重大更新(2026-06-23 · 见 `2026-06-23-wave0-spike-results.md`)

spike 全绿,确认两个架构简化,**改写下面 §1-§5 的 DB 与 agent 部分**:

**① 数据 = Neon + auth = Supabase**(详见 `2026-06-23-multi-env-neon-supabase-design.md`):本 spec 所有"Supabase pg / Hyperdrive→Supabase"改为 **Neon**。

**② agent 容器 → Python Worker**(去容器,本节作废原"agent 容器"设计):
- agent 变独立 **Python Worker**(Pyodide + `pydantic-ai-slim`),**删 Dockerfile**、**去 Paid container**。
- edge **不再当容器宿主**(去 `[[containers]]` / `RuntimeContainer` DO);edge 经 **service binding** 调 agent。
- agent DB = **httpx + Neon HTTP**(Pyodide 无 socket,不用 asyncpg);读 catalog 经 service binding。
- agent LLM 默认 **MiMo**(`https://api.xiaomimimo.com/v1`,OpenAI-compat provider;DeepSeek 没额度)。
- agent **import 放 fetch handler 内**(opentelemetry/logfire 在 top-level 调 `os.urandom` 触发 CF global-scope 禁熵;保 logfire 则 fetch 内 import);冷启动 439-550ms。
- 依赖走 `pyproject.toml`(uv,与 CF `pywrangler` 一致;deps 换 Pyodide-compatible)。

**更新后部署拓扑 — 4 个 Worker,零容器**:
| Worker | 源 | route | 职责 |
|---|---|---|---|
| web | apps/web | `domain/*` | OpenNext |
| edge | workers/edge | `/v1/*` + `/img/*` | auth gateway + service-binding → agent / catalog |
| **agent** | apps/agent(**Python Worker**) | 无 public(service binding ← edge) | PydanticAI + httpx(Neon HTTP) + MiMo |
| catalog | workers/catalog | 无 public(service binding) | Neon 读 API |

部署单元从原"edge + 容器"变为 **edge + agent 两个独立 Worker**(共 4 Worker)。**§1 的"agent 容器挂 edge DO"、§2 的容器改造、§5 Wave 的容器部署步骤全部作废**,改为 agent Python Worker 化(pyproject Pyodide deps + httpx Neon HTTP + MiMo + service binding)。Pulumi 去掉容器/agent-Hyperdrive(agent 走 Neon HTTP);catalog 是否用 Hyperdrive 看 Wave 实测。

## §1 目标架构

### 目录布局(platform monorepo)
```
apps/
  web/          ← frontend/    Next + OpenNext(独立 Worker;代码本次不重写)
  agent/        ← agent/       Python + Dockerfile(FastAPI 容器)
workers/
  edge/         ← worker/      路由 + /v1 auth gateway + agent 容器宿主
  catalog/      ← catalog/     数据平台 Worker(无 public route)
packages/
  contract/     ← packages/contract/   oRPC 契约(catalog ↔ agent)
infra/          ← NEW          Pulumi(TypeScript):routes / Hyperdrive / R2 / DNS / secrets
.github/
  actions/      ← NEW          复用 composite actions(setup-node-pnpm、setup-uv 等)
  workflows/    ← 重构         每组件独立 CI/CD
supabase/  e2e/  docs/         留 root
pnpm-workspace.yaml            packages: apps/*, workers/*, packages/*, infra/
.npmrc                         node-linker=hoisted(兼容 OpenNext/wrangler/vitest-pool-workers)
```
Python(agent)用 uv,**不进** pnpm workspace;`apps/agent/` 有自己的 `pyproject.toml` + `uv.lock`。

### 部署拓扑(CF-native,route-based)
Cloudflare Workers Routes:多个 Worker 共享 zone `zhenjia.org`,**最具体的 route 优先匹配**。

| Worker | 来源 | route | 职责 |
|---|---|---|---|
| **web** | apps/web | `seichijunrei.zhenjia.org/*` | OpenNext 独立 Worker:页面 SSR + 静态 `[assets]` |
| **edge** | workers/edge | `seichijunrei.zhenjia.org/v1/*` + `/img/*`(更具体→优先) | /v1 JWT/sk_ auth gateway + agent 容器宿主 + catalog service binding + 图片代理 |
| **catalog** | workers/catalog | 无 public route | 数据平台读 API;仅 edge 经 **service binding** 内部调 |
| **agent 容器** | apps/agent(Dockerfile) | — | 挂 edge worker 的 `RuntimeContainer` DO(CF 容器必须有 Worker DO 宿主) |

浏览器**按 URL 自动分流**:页面/资源 → web;`/v1` API(前端 client 直接 fetch)→ edge;两个面向公网的 Worker **互不 import、互不转发**。

### 4 个独立部署单元
1. **catalog**(workers/catalog)— 完全独立。
2. **web**(apps/web)— OpenNext build → 独立 Worker。
3. **edge + agent 容器**(workers/edge + apps/agent)— 容器随 edge(DO 宿主约束)。
4. **migrations**(supabase/)— `supabase db push`。

## §2 关键代码改造

### edge worker(workers/edge)
- **删除** `import nextHandler from "./.open-next/worker.js"` 及 OpenNext DO 的 re-export。
- route 改 `/v1/*` + `/img/*`(不再吃 `/*`)。
- 非 /v1 不再转发前端(浏览器直接命中 web route)。
- 保留:A′ /v1 auth(JWT/sk_ → 剥 client X-User、注入可信 X-User、401 fail-closed)、catalog service binding(内部)、`[[containers]]` RuntimeContainer + DO、`/img` 代理。
- `createWorkerApp()` 去掉 `nextHandler` 入参。

### web(apps/web)
- 加 `open-next.config.ts`:`export default defineCloudflareConfig()`。
- 独立 `wrangler.toml`:`main=".open-next/worker.js"`、`[assets] directory=".open-next/assets" binding="ASSETS"`、route `seichijunrei.zhenjia.org/*`、`compatibility_flags=["nodejs_compat"]`。
- build/deploy:`opennextjs-cloudflare build` 产 `.open-next/`(CI 冒烟 build 防再坏)。
- 前端 React/Next 代码**不改**(P4 才重写)。

### catalog(workers/catalog)
- 已独立,基本只改路径(进 workers/catalog)。prod 经 Pulumi 加 Hyperdrive(去掉裸 DATABASE_URL fallback,或保留 fallback)。

### agent(apps/agent)
- Python + Dockerfile 进 apps/agent。Dockerfile `COPY apps/agent`,build-context 含 apps/(或在 apps/agent 内 self-contained)。`pyproject.toml`/`uv.lock` 移入 apps/agent。

## §3 Pulumi IaC(分层)

### 分层原则(CF 现实)
- **Pulumi 管**(声明式 infra,不常变):Workers **routes**(web `/*`、edge `/v1/*`+`/img/*`)、**Hyperdrive**(catalog→Supabase pg)、**R2** buckets(media + Pulumi state)、**DNS**、zone settings、Worker **secrets**。
- **wrangler 管**(应用部署,每 release):worker 代码上传、**agent 容器 image build+push**(Docker → CF Registry)、OpenNext `.open-next/` build、DO migrations。
- 理由:CF 文档明确容器/OpenNext 的 build+push 是 wrangler 特定流程,Terraform/Pulumi 做不了 image build+push。

### 技术选型
- Pulumi **TypeScript**(与 Workers 生态一致),`@pulumi/cloudflare`(基于 CF 官方 Terraform provider)。
- **state backend = R2**(S3-compatible,留 CF 生态):
  `pulumi login 's3://<state-bucket>?endpoint=https://<account>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true'`,凭据用 R2 S3 token(`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` = R2 token)。
- secrets passphrase:`PULUMI_CONFIG_PASSPHRASE`(GH secret)。
- stacks:`prod`(本次);`staging` 预留(Pulumi 的多环境是后续上 staging 时的主要收益)。

### CI 中的顺序
`pulumi up`(infra:确保 routes/Hyperdrive/R2/DNS/secrets 就位)→ 各组件 `wrangler deploy`(代码+容器)。route 资源由 Pulumi 管,故组件 wrangler.toml **不再声明 routes**(避免和 Pulumi 抢);wrangler.toml 只留 main/assets/bindings/containers/DO/migrations。

> 注:route 归 Pulumi、binding/容器归 wrangler 的边界要在 Wave 0 spike 确认(wrangler deploy 不会因 wrangler.toml 无 route 而清掉 Pulumi 建的 route)。

## §4 CI/CD(GitHub Actions,每组件独立 + affected)

保留 GH Actions(统一 gate Python+TS+Supabase;Workers Builds 分散难 gate,不用)。

### CI(push / PR)— path-filter 只跑 affected
| job | path filter | 内容 |
|---|---|---|
| agent | `apps/agent/**` `packages/contract/**` | ruff + mypy + pytest(≥80%) |
| web | `apps/web/**` | lint + tsc + vitest + `opennextjs-cloudflare build`(冒烟) |
| edge | `workers/edge/**` | node --test(auth/路由) |
| catalog | `workers/catalog/**` `packages/contract/**` | tsc + vitest + contract-parity |
| infra | `infra/**` | `pulumi preview`(干跑) |

### Deploy(tag `v*`)— 每组件独立 job + path-filter(自上个 tag 变了才部署)+ 依赖排序
```
pulumi up (infra: routes/hyperdrive/r2/dns/secrets)
   ↓
migrations (supabase db push)
   ↓
deploy-catalog ──┐   deploy-web (opennext build + wrangler deploy)   ← 与 catalog 并行
   ↓             │
deploy-edge (needs catalog: service binding 要 catalog 先存在;容器随 edge)
```
- 一个组件部署失败**不阻塞其它**(除真实依赖);没变的组件**跳过**。
- pnpm:`pnpm install`(workspace)+ pnpm store cache + `pnpm --filter <pkg>`。
- 复用 composite actions(setup-node+pnpm、setup-uv、wrangler-deploy)放 `.github/actions/`。

## §5 分波计划(每波独立 PR + 验证 + 保持可部署)

| Wave | 内容 | 验证门 |
|---|---|---|
| **0 · spike** | 加 `open-next.config.ts` 跑通 `opennextjs-cloudflare build`;preview 验 route-based(web `/*` + edge `/v1/*` + catalog service binding + 容器);Pulumi spike:R2 state backend 登录 + 管 1 个 route + `pulumi up/preview` + 验"wrangler deploy 不清 Pulumi-managed route" | 全部关键假设绿,否则回退方案(route→service-binding;Pulumi→wrangler.toml) |
| **1 · monorepo 骨架 + pnpm** | `pnpm-workspace.yaml`+`.npmrc` hoisted;`git mv` 到 apps/workers/packages/infra;改 wrangler/Dockerfile build-context/imports/pyproject/CI path;`make check` + 各组件 build/test 全绿 | 结构就位、全绿、仍可(旧式)部署 |
| **2 · catalog 先上 prod** | workers/catalog 独立 wrangler deploy;Pulumi 管 catalog Hyperdrive(+ 无 public route);CI `deploy-catalog` job;打 tag → **catalog 独立上 prod** | catalog 在 prod 起来、读 API 通(prod 此前无 catalog)|
| **3 · edge/web 部署解耦 + agent 容器** | edge 去 `import .open-next`、route `/v1/*`+`/img/*`、catalog binding;web 独立 OpenNext Worker route `/*`;agent 容器挂 edge;Pulumi 管 web/edge routes + DNS | preview 上 web/`/v1`/容器/auth 全通 |
| **4 · CI/CD affected** | 拆 ci.yml/deploy.yml → 每组件独立 job + path-filter + 依赖排序 + `pulumi up` 前置;composite actions | CI 绿、affected 生效 |
| **5 · prod cutover** | preview/staging 全绿 → `pulumi up`(infra) + 各组件 wrangler deploy → 切 routes(旧单 `seichijunrei` worker `/*` → web `/*` + edge `/v1/*`)→ mails.dev 真登录验 /v1 + 页面 | 全链路绿;旧 worker 退役 |

## §6 与前端 TanStack rebuild(P4)的关系 —— 稳定接缝,不白做

本次的 **route 拓扑(web=`/*`、edge=`/v1/*`、catalog 内部、容器挂 edge)是穿越 P4 的稳定接缝**:
- P4 把前端从 Next/OpenNext 换成 TanStack 静态(`.output/public`)时,**只改 `apps/web` 内部实现** —— web Worker 从"OpenNext SSR worker"变成"静态 `[assets]` worker(或纯 assets)",route/edge/catalog/容器拓扑**完全不变**。
- A′ edge auth 契约(X-User 头、/v1 路由)本就是穿越 rebuild 的稳定接缝。
- 故本次部署解耦为 P4 铺路,不会被推翻。P4 = 本设计之外的独立轨。

## §7 风险 / cutover

- **prod cutover 是整个 hybrid 后端 + 新拓扑第一次上 prod**(现 prod 仍 v0.2.0 老架构)。route 切换有瞬断风险 → Wave 0 spike + Wave 5 前必须 preview/staging 充分验证;切 routes 时旧 worker 兜底直到确认。
- **route 优先级**(`/v1/*` > `/*` 最具体优先)是 CF 标准行为,Wave 0 实测确认。
- **Pulumi×wrangler 边界**:route 归 Pulumi、binding/容器归 wrangler;Wave 0 验证 wrangler deploy 不清 Pulumi-managed route。否则回退:route 仍由 wrangler.toml 管,Pulumi 只管 Hyperdrive/R2/DNS/secrets。
- **pnpm×OpenNext/wrangler/vitest-pool-workers**:`.npmrc node-linker=hoisted` 兼容;Wave 1 验证所有 build/test 绿,否则逐个 `public-hoist-pattern`。
- **agent 容器 ~50% pg 挂**(dev 观察):Wave 0/5 在 preview/prod 验证是否只 dev(Hyperdrive 路径)。
- **Docker build-context**(agent 移 apps/agent):Wave 1 确认 Dockerfile COPY 路径 + CI build-context。
- **secrets**:Supabase(URL/anon/service_role/DB_URL)、CLOUDFLARE_API_TOKEN/ACCOUNT_ID、Mapbox、DeepSeek、R2 state token、PULUMI_CONFIG_PASSPHRASE —— 由 Pulumi 管 Worker secrets + GH secrets 供 CI。

## §8 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 范围 | C(apps/workers/packages + pnpm + 目录布局) | 完整 monorepo 最佳实践 |
| edge↔web 解耦 | **route-based**(CF Routes 最具体优先),非 service-binding 转发 | 更 CF-native、更解耦 |
| OpenNext 前端 | 独立 Worker(CF 标准 `main=.open-next/worker.js`) | 官方标准;斩断 edge `import` |
| CI/CD | GH Actions + 每组件独立 job + path-filter affected | 统一 gate Python/TS/Supabase |
| IaC | **Pulumi TypeScript,现在上**;分层(Pulumi infra + wrangler 应用/容器) | 用户定;容器/OpenNext 只能 wrangler |
| Pulumi state | **R2**(S3-compatible self-managed backend) | 留 CF 生态 |
| 落地顺序 | **先后端**(catalog/agent/edge)+ 前端仅部署解耦;前端代码重写(P4)押后 | 降风险;前端 cutover 最复杂 |
| 容器归属 | 挂 edge worker DO | CF 容器固有约束 |

## §9 不在范围
- 前端代码重写(Next/OpenNext → TanStack,P4)。
- 业务功能变更、eval/parity gate。
- staging 环境(Pulumi stack 预留,本次只 prod)。
