# 小配置文件放哪（Monorepo 放置规则）

- Status: **DESIGN** — 与 monorepo P3「根只做编排」对齐；**不强制一次搬完**
- Date: 2026-08-06
- Parent: [monorepo-target-layout](../../specs/2026-08-06-monorepo-target-layout.md)

---

## 0. 三条总则

1. **谁拥有生命周期，配置就跟谁**
   只服务一个 app/worker 的 → 放在该包根下（`apps/web/vitest.config.ts`）。
2. **工具强制要求仓库根的 → 留在根**
   例如 GitHub、SonarCloud Automatic Analysis、多数 pre-commit、pnpm workspace。
3. **根上禁止「假装编排、其实是 edge 运行时」**
   已定：`wrangler.toml`、edge 的 hono/jose deps、agent `Dockerfile` → 沉入 `workers/edge` / `apps/agent`。

**不搞** 统一的 `config/` 大筐把所有东西塞进去——会破坏工具发现路径，也违反「跟 owner 走」。

---

## 1. 决策树

```text
这个文件只影响一个可部署包/库吗？
  是 → 放 packages|apps|workers/<name>/
  否 ↓
工具/平台要求必须在 git 根目录吗？
  是 → 留根（或 .github/）
  否 ↓
是仓级质量/安全/覆盖率策略吗？
  是 → 根（或 docs/ops 只写说明，可执行配置仍常在根）
  否 ↓
是本机/IDE/agent 私货吗？
  是 → 点目录（.claude/.grok）或 gitignore；不要进业务包
```

---

## 2. 根上该留什么（编排 + 仓级门禁）

| 文件 | 去留 | 说明 |
|---|---|---|
| `package.json` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` | **根** | workspace 编排；**目标：** 无 edge 业务 runtime deps |
| `.npmrc` · `.nvmrc` | **根** | 全仓 Node/pnpm 约定 |
| `.gitignore` · `.dockerignore` | **根** | 工具读根 |
| `Makefile` | **根** | 跨包命令入口（可再薄） |
| `AGENTS.md` · `CLAUDE.md` · `CONTEXT-MAP.md` · `README*` | **根** | 人/agent 入口 |
| `.oxlintrc.json`（根） | **根 base** | 共享严格规则；**包内** `.oxlintrc.json` extends 根（现状合理） |
| `.pre-commit-config.yaml` | **根** | pre-commit 默认根配置 |
| `.sonarcloud.properties` | **根** | Sonar Automatic Analysis 要求/惯例在根 |
| `codecov.yml` | **根** | Codecov 仓级 flag/门禁 |
| `.sqlfluff` · `.semgrepignore` · `.codacy.yml` | **根** | 仓级静态分析入口 |
| `.env.example` · `.env.test.example` | **根** 或拆 | 跨服务本地变量总表可留根；**单包** 用 `apps/web/.env.example` |
| `.github/**` | **根下** | CI/CD、模板、actions — 永不沉到 workers |

---

## 3. 应沉入包的（已定目标 · 与 edge package-ize 一致）

| 文件 | 目标位置 |
|---|---|
| 根 `wrangler.toml` | `workers/edge/wrangler.toml` |
| 根 `Dockerfile` | `apps/agent/Dockerfile`（容器定义跟 agent） |
| 根 `package.json` 的 hono/jose/containers | `workers/edge/package.json` |
| 各包 `tsconfig` / `vitest.config` / 包级 `.oxlintrc` | **已在包内 · 保持** |
| `apps/web/vite.config.ts` · `lighthouserc.cjs` · `wrangler.jsonc` | **web 包内 · 保持** |
| `infra/Pulumi*.yaml` · `infra/tsconfig` | **infra/ · 保持** |
| `e2e/playwright.config.ts` | 目标 `tests/e2e/`（随 e2e 搬家） |
| `db` 迁移 + atlas.sum | 目标 `migrations/neon/`（DBA D19） |
| `supabase/` | 目标 `migrations/supabase/` |

包内配置命名习惯（统一即可，不必再套一层 `config/`）：

```text
workers/catalog/
  package.json
  tsconfig.json
  vitest.config.ts
  .oxlintrc.json          # extends ../../../.oxlintrc.json
  wrangler.toml
```

---

## 4. 按类型速查

### 4.1 语言 / 构建

| 类型 | 放置 |
|---|---|
| `tsconfig.json` | **包内**；根可不设（或仅 `tsconfig.base.json` 被 extends — **可选**，现在没有就别硬加） |
| `vitest.config.*` | **包内** |
| `vite.config.ts` | **apps/web** |
| Python：`pyproject.toml` / `ruff` / `mypy` | **apps/agent**（uv 项目根） |
| `Dockerfile` | **产生镜像的包**（agent） |
| `docker/` 测试镜像 | **`docker/` 顶层** 或 `apps/agent/docker/` — 测试基础设施可顶层 |

### 4.2 质量 / 安全 / 覆盖

| 类型 | 放置 |
|---|---|
| oxlint 共享规则 | **根** `.oxlintrc.json` + 包 extends |
| Sonar | **根** `.sonarcloud.properties` |
| Codecov | **根** `codecov.yml` |
| Semgrep / Codacy / sqlfluff | **根** 点文件（工具默认） |
| pre-commit | **根** |

### 4.3 密钥与环境样例

| 类型 | 放置 |
|---|---|
| 跨服务「本地要哪些变量」总表 | 根 `.env.example` |
| 单 Worker secrets 形状 | `workers/<pkg>/.dev.vars.example`（已有 users/maintenance） |
| Web 仅前端 `VITE_*` | `apps/web/.env.example` |
| **真实 secret** | 永不入库；CI Environment / `wrangler secret` |

### 4.4 本机 / Agent 工具

| 类型 | 放置 |
|---|---|
| `.claude/` · `.grok/` · `.serena/` | 可留根；**不要**塞进 `apps/web/src` |
| 个人 override | gitignore 或 user-level |

### 4.5 脚本与夹具

| 类型 | 放置 |
|---|---|
| 跨包运维脚本 | 根 `scripts/` |
| 仅 agent 的 | `apps/agent/scripts` 或 `apps/agent/src/.../scripts` |
| 测试 fixture | 跟测试 owner：`apps/agent` fixtures、`e2e/`、`fixtures/`（少而精；避免根无限涨） |

---

## 5. 目标根目录「点文件 + 编排」清单（干净后）

```text
.
├── package.json              # private 编排 ONLY
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── Makefile
├── AGENTS.md · CLAUDE.md · CONTEXT-MAP.md · README*
├── .gitignore · .dockerignore · .npmrc · .nvmrc
├── .oxlintrc.json            # base
├── .pre-commit-config.yaml
├── .sonarcloud.properties
├── codecov.yml
├── .sqlfluff · .semgrepignore · .codacy.yml   # 若仍用这些工具
├── .env.example · .env.test.example           # 跨服务样例
├── .github/
├── apps/ · workers/ · packages/ · migrations/ · infra/ · tests/ · scripts/ · docs/
└── （可选）docker/   # 仅共享测试镜像
```

**根上不应再长期存在：** `wrangler.toml`、业务 `Dockerfile`、edge runtime deps、`db/` 名（改为 migrations）、把 e2e 当「随便根目录邻居」而不进 `tests/`（目标态）。

---

## 6. 和已有列车的关系

| 列车 | 会动哪些小配置 |
|---|---|
| Edge package-ize (E1) | 根 wrangler + edge deps |
| Agent 结构 | Dockerfile 路径、容器 image 引用 |
| DBA D19 | `db/` → `migrations/neon/` |
| CI C2–C5 | 只动 `.github`；不把 sonar 拆进包 |
| jobs rename | `pipeline-maintenance` → `ci-jobs` 路径字符串 |

---

## 7. 非目标

- 建 `config/sonar/` `config/lint/` 深层树（除非工具强制）
- 每个包复制一份 `.sonarcloud.properties`
- 把 `pnpm-workspace` 沉到子目录

---

## 8. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：小配置放置决策树 + 根/包对照表 |
