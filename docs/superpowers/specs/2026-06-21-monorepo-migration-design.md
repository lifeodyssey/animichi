# 受管 monorepo 迁移设计(修订版 · 部署真相 spike 后)

> 设计稿。**2026-06-22 大改**:经只读"部署真相 + 迁移就绪" spike(7 路并行调查 + opus 综合)解了早先评审的 C1-C4,并按风险重排为 P0-P6。原版(假设静态导出、一次性挪全部目录、立即上 pnpm)**已废**——与真实部署严重不符。

## 部署真相(spike 确认)

- **前端是 OpenNext-SSR,不是静态导出**(CLAUDE.md/AGENTS.md "static export `output:export`" 是**陈旧错误**,与现实矛盾)。
- OpenNext 产物(`.open-next/worker.js` + `.open-next/assets`)由 `frontend/next.config.ts` 的 `initOpenNextCloudflareForDev()` **模块加载副作用**产出(非 `opennextjs-cloudflare` CLI)。`worker/entry.ts:2` import 这个产物。**管线能跑但隐式/脆弱**。
- 两条部署路,都以 **root `wrangler.toml`** 为中心(`main=worker/entry.ts`、`[assets]=.open-next/assets`、`[[services]] catalog`、`[[containers]] RuntimeContainer image=./Dockerfile`):
  - 手动(`deploy.yml`,workflow_dispatch):`next build` → `supabase db push` → root `wrangler deploy`。**不部署 catalog Worker**。
  - tag(`ci.yml`,`v*`):catalog 先(workingDirectory: catalog)→ root(含容器)。
- 3 份 wrangler:只 **root** 被部署用;`frontend/wrangler.jsonc`=本地 dev 脚手架(死);`catalog/wrangler.toml`=独立 Worker(tag 路)。
- 栈 = npm + 各叶 `package-lock.json`,**无 workspace 字段**(文件夹式 monorepo)。7 处 CI cache 硬编码 `cache:npm`。

## C1-C4 裁决(spike 后)

| 项 | 状态 | 要点 |
|---|---|---|
| C1 OpenNext vs 静态导出 | **解决** | 确认 OpenNext-SSR;管线隐式但能跑;"静态导出"假设错。 |
| C2 web↔edge 经 .open-next 耦合 | **解决(确认硬耦合)** | `worker/entry.ts` import `.open-next/worker.js` + `[assets]=.open-next/assets`。**OpenNext 在就拆不开 web/edge**——只有 TanStack rebuild(P4)斩断 import 才解。 |
| C3 Python 重命名清单 | **changed(全清单)** | 558 imports/203 文件 + 23+ 配置(pyproject 7、pytest 3、pre-commit 9、Makefile 11、ci.yml 9、codacy、e2e 脚本)。 |
| C4 重命名断容器 | **解决** | Dockerfile:41 CMD、:16 COPY、pyproject:76 hatch packages、:53 entry;apps/agent 移动需 Docker build-context 含 apps/(故 P1 就地、P6 才挪)。 |
| 新:Python 契约 codegen | **open→决策** | codegen 会把 sentinel 默认(episode=-1 等)退成 Optional,改验证语义。**保手写 Pydantic 模型,不 codegen**。 |
| 新:pnpm 硬刺 | **open→决策** | vitest-pool-workers/wrangler/OpenNext 要扁平 node_modules(`.npmrc node-linker=hoisted`);frontend 有 npm alias + 6 overrides;7 CI cache 要换。**P4 去掉 OpenNext 后再做(P5)**。 |

## 关键排期洞察

TanStack rebuild(分支 `docs/frontend-rebuild-plan`)会让 **C1/C2 自动 moot**(去 OpenNext、斩 .open-next import、worker 变纯路由 + `[assets]→.output/public`)——但 **rebuild 尚未开始**(main 仍 Next 16.2.3,无 apps/web),且 gated 在后端 eval parity。**edge worker 的认证契约(X-User 头、/v1+/img 路由)是穿越 rebuild 的稳定接缝**——后端工作不必等前端。

⟹ **能现在安全做的 = P0-P3(都不碰 OpenNext/TanStack);P4-P6 hard-blocked,必须等 rebuild**。

## 目标结构(最终态,P4-P6 后)

```
apps/{web(TanStack), agent(Python)} + workers/{edge, catalog} + packages/{contract, auth} + e2e/ + supabase/
pnpm-workspace.yaml + .npmrc(node-linker=hoisted)
```
当前只走到 P1-P3(agent 就地重命名、契约卫生、catalog 部署补齐);apps/workers/packages + pnpm = P4-P6。

## 阶段计划(P0-P6;每阶段保持可部署)

### Do-now(无 OpenNext/TanStack 耦合)
- **P0 修陈旧文档(近零风险,doc-only)**:CLAUDE.md/AGENTS.md 的"static export `output:export`/frontend/out"→ 改为 OpenNext-SSR(`.open-next/`,next.config 副作用)现实 + 注明 TanStack rebuild 计划;记 3-wrangler 分工、手动/tag 部署差异、`.open-next` build-order 依赖。**防后续 agent 按假象行动。**
- **P1 Python `backend`→`agent` 就地重命名(不移 apps/)**:`git mv backend agent` → codemod 558 imports → 改 23+ 配置(按 C3 清单)→ Dockerfile CMD:41/COPY:16(→agent,暂留 root)→ `make check` + 全 CI。**不移 apps/,避开 Docker build-context 重构**(留 P6)。
- **P2 oRPC 契约卫生(不 codegen)**:加 CI 字段-parity 检查(`@seichijunrei/contract` ↔ `catalog/src/types.ts`)+ lint 强制 catalog 用 `import type` + 文档化 Python sentinel 分歧故意性。**不引入 openapi→Python codegen**。
- **P3 catalog 部署补进 deploy.yml**:手动部署补 catalog-first(对齐 ci.yml)+ Dockerfile-exists 校验。闭合"手动部署对 stale catalog 失败"的洞。

### Deferred(hard-blocked,等 rebuild)
- **P4 TanStack Start 前端 rebuild(去 OpenNext)**:scaffold SPA+SSG→`.output/public`;斩 `worker/entry.ts` 的 .open-next import;`[assets]→.output/public`;保 edge JWT 验证 + /v1//img//healthz。**这才真正解 C1/C2**。gated 在后端 eval parity;协调式 cutover(entry.ts 与 [assets] 同翻)。
- **P5 pnpm workspaces**:`pnpm-workspace.yaml` + `.npmrc node-linker=hoisted` + 迁 frontend overrides/alias + 7 CI cache 换 pnpm。**P4 去 OpenNext 后做**(少一个扁平-node_modules 消费者)。
- **P6 agent→apps/agent + web→apps/web(最终布局)**:挪目录 + Dockerfile COPY apps/agent + build-context 含 apps/。**与 P4/P5 一起,让 apps/* 布局一次定型**。

## 硬阻塞

- **拆 web/edge** 需 P4(OpenNext .open-next import);P4 前 C2 解不了。
- **apps/agent 移动** 需 Docker build-context 含 apps/ → P1 先就地重命名,P6 才挪。
- TanStack rebuild(P4)gated 在后端 eval parity 且未开始 → C1/C2 在此前保持 live。
- pnpm(P5)与 OpenNext/wrangler/vitest-pool-workers 扁平-node_modules 冲突 → 排在 P4 后。
- WATCH:手动 deploy.yml 不部署 catalog(P3 修);OpenNext build 隐式(next.config 副作用,若断则 `next build` 出 .next/ 而非 .open-next/,部署期才炸)。

## 不在范围

A′ 认证(已完成)、业务功能、parity gate、prod 部署时机。
