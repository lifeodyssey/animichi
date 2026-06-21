# 裸 monorepo → 受管 monorepo 迁移设计

> 设计稿(2026-06-21,brainstorm 一路聊定)。把"几个项目恰好在一个 repo"升级成"pnpm 工作区管理、共享包真 import、apps/workers/packages 分层"。

## 目标

消除当前裸 monorepo 的三个病:① 契约**手抄漂移**(catalog types / Python models / contract 三份各自演化)② 主 Worker **混在根包 + 部署编排**里 ③ 前端↔worker **无共享 TS 的家**(A′ 的验证模块无处放)。

## 现状(裸 monorepo)

- 一个 git repo,多个包,**无 workspace 工具**;各装各的 node_modules;`@seichijunrei/contract` **没被 import,被手抄**。
- `frontend/`(Next,独立包)、`catalog/`(TS Worker,独立包)、`worker/`(主 Worker = 根包 `seichijunrei-cloudflare-worker` 的代码 + 部署编排)、`backend/`(Python agent,uv)、`packages/contract/`(SoT,手抄)、`e2e/`(Playwright,独立包)。

## 关键决策(已定)

| 决策 | 选择 | 理由 |
|---|---|---|
| 包管理器 | **pnpm workspaces** | monorepo 首选,`workspace:*` 链接最干净(用户指定) |
| 布局 | **apps/ + workers/ + packages/** 三分 | apps=非-Worker 部署物;workers=两个 CF Worker 归类;packages=共享库 |
| 两个 Worker | edge / catalog **保持两个独立部署单元** | catalog 私有化靠 service binding(Worker→Worker);合一个会重新公网暴露 catalog(毁掉刚做的认证)+ bundle 超限 + 失去独立部署/DDD 边界。仅**目录**归到 workers/ 下 |
| Python | 搬 **apps/agent + 重命名 backend→agent** | 最对称;codemod `from backend.`→`from agent.`(用户选定,接受 churn) |
| 契约 | TS 侧 **真 import** `@s/contract`;Python 侧从 **openapi.json codegen** | 根治手抄漂移;Python 不能 import TS |
| 共享 auth | `packages/auth`(无 Next 依赖的 verify) | A′ 的家;web + edge 共享单一认证 |
| 测试 | 跟包走 + e2e 顶层 + TS 摆法统一 | 现已基本对,顺手收敛 |

## 目标结构

```
/
├── apps/
│   ├── web/            Next.js              (← frontend/)
│   └── agent/          Python agent,包名 agent (← backend/,backend→agent codemod)
├── workers/
│   ├── edge/           主 Worker 网关         (← worker/ + 根包的 worker 部分,成独立包)
│   └── catalog/        Catalog Worker        (← catalog/)
├── packages/
│   ├── contract/       oRPC SoT(真 import)  (← packages/contract/)
│   └── auth/           无 Next 的 verifyJwt/verifyApiKey(A′ 用,本迁移仅 scaffold)
├── e2e/                跨服务 E2E(留顶层)
├── supabase/  scripts/
├── pnpm-workspace.yaml  声明 apps/*  workers/*  packages/*
├── .npmrc               hoisting 配置(Next/wrangler/vitest 兼容)
└── package.json         工作区根:只编排(无业务代码)
```

`apps/agent`(Python)**不进 pnpm 工作区**(无 package.json,uv 工具链),只是目录归位。

## 分阶段迁移(每阶段结束:app 仍可部署 + `make check`/各包测试绿)

### Phase 0 — pnpm 工作区底座(不挪目录)
- 加 `pnpm-workspace.yaml`(就地声明 `frontend`、`catalog`、`worker`... 先按现路径)。
- 删各 `package-lock.json`,`pnpm install` 生成 `pnpm-lock.yaml`。
- `.npmrc`:`node-linker=hoisted`(或 `shamefully-hoist=true`)保 Next/wrangler/vitest 兼容(pnpm 严格 node_modules 会绊倒部分工具)。
- CI:`npm ci`→`pnpm install --frozen-lockfile`,`npm run X`→`pnpm X`,setup-node 加 pnpm。
- **验证**:各包 build + test 绿;`wrangler deploy --dry-run`(需 .open-next)或至少 typecheck/test 绿。

### Phase 1 — contract 变真 import(先治手抄,低风险高价值)
- `packages/contract` 设 `name: @s/contract`、正确 `exports`。
- catalog、(未来 edge)把手抄的 `types.ts` 改成 `import { ... } from "@s/contract"`(`workspace:*` 依赖)。
- Python:加 `openapi.json → agent 模型` 的 codegen(datamodel-code-generator),生成物替换手抄的 `catalog_client.py` 模型。**(可作为 fast-follow,不阻塞结构迁移)**
- **验证**:catalog typecheck + Python mypy/test 绿;契约只剩一份真相。

### Phase 2 — TS 目录归位(逐个搬,搬一个验一个)
- `frontend/` → `apps/web/`:改 wrangler `build:frontend` 路径、`.open-next/assets` 路径、CI、Storybook/vitest 配置里的相对路径。
- `catalog/` → `workers/catalog/`:改 catalog wrangler、CI、`packages/contract` 相对引用(workspace 后变包名,无所谓路径)。
- `worker/` → `workers/edge/`:**最大改动**——把根包的 worker 部分(hono/@cloudflare/containers 依赖 + entry.ts/app.ts)抽成 `workers/edge` 独立包;根 `package.json` 退化为纯工作区管理器;根 `wrangler.toml` 的 `main`/`assets`/`[[services]]`/`[[containers]]` 迁到 `workers/edge/wrangler.toml`。
- 更新 `pnpm-workspace.yaml` 为最终 `apps/* workers/* packages/*`。
- **验证**:每搬一个,该 Worker `wrangler deploy --dry-run` + 测试绿。

### Phase 3 — Python 归位 + 重命名
- `backend/` → `apps/agent/`;codemod `from backend.`→`from agent.`、`import backend`→`import agent`(全仓,含 tests)。
- 改 `pytest.ini` testpaths、`Dockerfile`(容器构建上下文 + 入口路径)、`Makefile`、CI、`wrangler.toml [[containers]] image` 路径。
- **验证**:`mypy` + `pytest`(全量)绿;容器 `docker build` 通;CONTAINER 部署路径正确。

### Phase 4 — 共享 auth scaffold + 测试收敛
- `packages/auth` scaffold:无 Next 依赖的 `verifyJwt`/`verifyApiKey` 接口骨架(**A′ 在后续单独实现逻辑**;本迁移只立包 + 占位 + 测试位)。
- TS 单测摆法统一(挑一种:挨源码 或 包内 `test/`),runner 收敛策略落档。
- **验证**:全绿。

## 风险与回滚

- **最高风险**:Phase 2 的 edge 抽包 + wrangler/deploy 路径迁移;pnpm hoisting 绊 Next/wrangler/vitest;Phase 3 的 Python codemod。
- **缓解**:逐阶段、逐目录搬,每步 `make check` + `wrangler deploy --dry-run` + 该包测试;每步独立 commit,坏了可单步 revert。**全程保持仓库可部署**(不在中途留半迁移态过夜)。
- **部署冻结**:迁移期间不打 deploy tag,直到 Phase 2/3 全绿 + 一次成功的 dry-run。

## 不在范围

- **A′ 认证逻辑本身**:本迁移只 scaffold `packages/auth`;A′ 落地是后续独立卡(落进新结构)。
- `/v1→容器` 修复(A′ 的一部分):排查已完成(根因 bc394ea),修复随 A′。
- 业务功能、parity gate、prod 部署:不动。

## 落地后收益

单一契约真相源(手抄绝迹)+ edge 成干净独立包 + A′ 有家(单一认证)+ apps/workers/packages 一眼看清边界 + pnpm 跨包 build/test 一条命令。
