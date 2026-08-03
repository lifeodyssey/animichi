# Wave 1 — Monorepo 骨架 + pnpm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh subagent per task + review). Steps use `- [ ]` tracking.

**Goal:** 把仓库转成 pnpm workspace + monorepo 布局,先搬**独立组件**(agent→apps/agent、catalog→workers/catalog、contract 已在 packages/),全程保持现状可运行(make check 绿 + 各组件 build/test 绿)。**不改架构**(agent 仍容器代码、edge 仍 import .open-next、web 仍 OpenNext)——架构改造在后续 wave。

**Architecture:** 增量、低风险的结构搬迁。`web` + `worker`(edge)因 `.open-next` 代码级耦合**本波不搬**(留原地 `frontend/`、`worker/`),等 Wave 4 route 解耦时一起搬到 `apps/web` + `workers/edge`。本波只搬无耦合的 `agent`、`catalog`。

**Tech Stack:** pnpm workspace(`.npmrc` node-linker=hoisted)、uv(Python,pyproject)、wrangler、Node 24。

## Global Constraints
- worktree `backend-survey`;Node 24(`source ~/.nvm/nvm.sh && nvm use 24`)。
- 每个 task 末尾 **make check 绿**(Python:mypy+770 单测+≥80%) 且相关 JS 组件 build/test 绿。
- 无抑制、无 `Any`、保持 1-10-50。
- **本波不碰** `frontend/`、`worker/`(它们的 `.open-next` 耦合留 Wave 4);不改 agent 运行方式(容器代码暂留,Dockerfile 暂留)。
- pnpm hoisted 兼容 OpenNext/wrangler/vitest-pool-workers。

---

## Spike 后的 wave 序列(本波是 Wave 1;后续供 context)
1. **Wave 1**(本波):pnpm workspace + 搬 agent→apps/agent、catalog→workers/catalog。
2. Wave 2:catalog → Neon(Hyperdrive/serverless)+ Pulumi catalog infra + CI deploy-catalog → catalog 先上 prod。
3. Wave 3:agent 容器→**Python Worker**(pyproject Pyodide deps、httpx+Neon HTTP、MiMo、import 在 handler 内、service binding);删 Dockerfile。
4. Wave 4:edge route 解耦(去 import .open-next → route `/v1/*`+service binding)+ web 独立 OpenNext Worker(route `/*`);搬 frontend→apps/web、worker→workers/edge。
5. Wave 5:CI/CD 每组件独立 job + path-filter affected + `pulumi up` 前置。
6. Wave 6:prod cutover(preview 验 → pulumi up + 各 Worker deploy → 切 routes → mails.dev + MiMo 验 /v1)。

---

### Task 1: pnpm workspace 脚手架

**Files:**
- Create: `pnpm-workspace.yaml`、`.npmrc`(repo root)
- Modify: 无(纯新增;现有 npm 包本 task 不动)

**Interfaces:** Produces: pnpm workspace 定义,供 Task 2-5 的包 resolve。

- [ ] **Step 1: 建 pnpm-workspace.yaml**

```yaml
packages:
  - "frontend"          # 留原地,Wave 4 → apps/web
  - "worker"            # 留原地,Wave 4 → workers/edge
  - "catalog"           # Task 4 → workers/catalog
  - "workers/*"
  - "apps/*"
  - "packages/*"
  - "e2e"
```

- [ ] **Step 2: 建 .npmrc(hoisted,兼容 OpenNext/wrangler)**

```
node-linker=hoisted
shamefully-hoist=true
```

- [ ] **Step 3: 确认 pnpm 可用 + 干跑 install(不提交 lockfile 改动前先看)**

```bash
source ~/.nvm/nvm.sh && nvm use 24; corepack enable pnpm 2>/dev/null; pnpm --version
pnpm install --lockfile-only 2>&1 | tail -8
```
Expected:pnpm ≥9;`pnpm-lock.yaml` 生成,无 resolve 错误。
Fail 回退:若 frontend 的 npm alias(`animal-island-ui: npm:animal-island-ui-tailwind`)/overrides 在 pnpm 下报错 → 见 Task 2。

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml .npmrc
git commit -m "build(wave1): pnpm workspace scaffold (hoisted)"
```

---

### Task 2: JS 包迁到 pnpm(删 npm lockfile + 迁 frontend alias/overrides)

**Files:**
- Modify: `frontend/package.json`(overrides 语法)、`catalog/package.json`、`worker/`(若有 package.json)
- Delete: 各 `package-lock.json`
- Create: `pnpm-lock.yaml`(根,workspace 统一 lockfile)

**Interfaces:** Consumes: Task 1 workspace。Produces: 统一 pnpm-lock。

- [ ] **Step 1: 迁 frontend overrides → pnpm 语法**

`frontend/package.json` 现有 `"overrides": {...}`(npm)。pnpm 用根 `package.json` 的 `pnpm.overrides` 或保留(pnpm 也读 `overrides`)。确认 alias `"animal-island-ui": "npm:animal-island-ui-tailwind@^0.8.3"` 在 pnpm 下 resolve(pnpm 支持 npm: alias)。

- [ ] **Step 2: 删 npm lockfiles + pnpm install**

```bash
source ~/.nvm/nvm.sh && nvm use 24
find . -name package-lock.json -not -path '*/node_modules/*' -delete
pnpm install 2>&1 | tail -10
```
Expected:`pnpm-lock.yaml` 生成,所有 workspace 包装好。

- [ ] **Step 3: 验各 JS 组件 build/test(pnpm)**

```bash
pnpm --filter ./frontend run lint && (cd frontend && npx tsc --noEmit)
pnpm --filter ./catalog exec tsc --noEmit && pnpm --filter ./catalog run test:worker
pnpm --filter ./frontend exec vitest run 2>&1 | tail -3
```
Expected:lint/tsc/vitest/worker 全绿(与 npm 时一致)。
Fail 回退:hoisted 不够 → 加 `public-hoist-pattern[]` 到 `.npmrc` 针对报错包。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "build(wave1): migrate JS packages npm→pnpm (delete package-lock, pnpm-lock)"
```

---

### Task 3: agent → apps/agent

**Files:**
- Move: `agent/` → `apps/agent/`(git mv)
- Move: `pyproject.toml`、`uv.lock`、`pytest.ini`(root) → `apps/agent/`(若 agent 包配置在 root)
- Modify: `Dockerfile`(COPY 路径,暂留)、`.github/workflows/*.yml`(path)、`pre-commit`、`Makefile`(agent 路径)

**Interfaces:** Consumes: 无。Produces: agent 在 apps/agent,导入路径不变(`agent.*` 包名保持,只是物理位置变)。

- [ ] **Step 1: 确认 agent 包配置位置(root pyproject vs agent/)**

```bash
grep -nE 'packages|\[tool.hatch|agent' pyproject.toml | head
```
判断:`agent.*` 包由 root `pyproject.toml` 的 hatch packages 指 `agent/`。搬到 apps/agent 后,要么 root pyproject 指 `apps/agent`,要么 pyproject 也搬 apps/agent(独立包)。**选择**:pyproject + uv.lock 搬到 `apps/agent/`(agent 成自包含 uv 项目,符合 monorepo + Wave 3 pywrangler)。

- [ ] **Step 2: git mv**

```bash
git mv agent apps/agent
git mv pyproject.toml apps/agent/pyproject.toml
git mv uv.lock apps/agent/uv.lock
[ -f pytest.ini ] && git mv pytest.ini apps/agent/pytest.ini
```

- [ ] **Step 3: 修 apps/agent/pyproject.toml 的包路径**

hatch packages 从 `["agent"]` 保持(现在 cwd=apps/agent,`agent/` 在其下)。确认 `[tool.hatch.build.targets.wheel] packages = ["agent"]` + uv 从 apps/agent 解析。

- [ ] **Step 4: 修引用路径(Dockerfile / CI / Makefile / pre-commit)**

- `Dockerfile`:`COPY agent /app/agent` → `COPY apps/agent/agent /app/agent`(+ COPY apps/agent/pyproject.toml apps/agent/uv.lock);build-context 仍 root。(Dockerfile 暂留,Wave 3 删。)
- `.github/workflows/ci.yml`+`deploy.yml`:`agent/` → `apps/agent/`(uv working-dir、pytest 路径、import smoke、coverage)。
- `Makefile`、`.pre-commit-config.yaml`:`agent/` → `apps/agent/`。

- [ ] **Step 5: make check(from apps/agent)**

```bash
cd apps/agent && source ~/.nvm/nvm.sh && nvm use 24
uv sync --all-extras && uv run mypy agent/ && uv run pytest tests/unit/ --no-header -q 2>&1 | tail -5
```
Expected:mypy clean + 770 单测过 + 覆盖 ≥80%。
Fail 回退:import 路径若有硬编码 `agent.` 绝对引用,确认包名未变(物理移动不改 `agent.` 命名空间)。

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/Seichijunrei-agent/.claude/worktrees/backend-survey
git add -A
git commit -m "refactor(wave1): move agent → apps/agent (paths updated; container code unchanged)"
```

---

### Task 4: catalog → workers/catalog

**Files:**
- Move: `catalog/` → `workers/catalog/`(git mv)
- Modify: `catalog/test/contract-parity.worker.test.ts`(相对 import `../../packages/contract` → `../../../packages/contract`)、`.github/workflows/ci.yml`(catalog-quality path)、根 `wrangler.toml`(`[[services]]` catalog 若引路径)、`pnpm-workspace.yaml`(catalog 已被 `workers/*` 覆盖,去掉单列 `catalog`)

**Interfaces:** Consumes: Task 1 workspace。Produces: catalog 在 workers/catalog。

- [ ] **Step 1: git mv**

```bash
git mv catalog workers/catalog
```

- [ ] **Step 2: 修 contract-parity 测试的相对路径**

`workers/catalog/test/contract-parity.worker.test.ts`:`from "../../packages/contract/src/..."` → 深度多一层 → `from "../../../packages/contract/src/..."`。同理任何 catalog→contract 的相对 import。

- [ ] **Step 3: 修 pnpm-workspace + CI + 根 wrangler**

- `pnpm-workspace.yaml`:删单列的 `- "catalog"`(已被 `workers/*` 覆盖)。
- `.github/workflows/ci.yml` catalog-quality:`working-directory: catalog` → `workers/catalog`;path filter `catalog/**` → `workers/catalog/**`;`packages/contract npm install` 步骤的相对路径。
- 根 `wrangler.toml`:`[[services]]` catalog binding 用 service name(`catalog`),不引路径 → 大概率不用改;deploy 的 `workingDirectory: catalog` → `workers/catalog`。

- [ ] **Step 4: 验 catalog(pnpm + 装 contract deps)**

```bash
source ~/.nvm/nvm.sh && nvm use 24
(cd packages/contract && npm install >/dev/null 2>&1)
pnpm --filter ./workers/catalog exec tsc --noEmit
mv workers/catalog/.dev.vars /tmp/cdv.bak 2>/dev/null; pnpm --filter ./workers/catalog run test:worker 2>&1 | tail -3; mv /tmp/cdv.bak workers/catalog/.dev.vars 2>/dev/null
```
Expected:tsc 0 + 93 worker 测试过。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(wave1): move catalog → workers/catalog (contract paths + CI updated)"
```

---

### Task 5: CI 路径终审 + make check 全量

**Files:**
- Modify: `.github/workflows/ci.yml`、`deploy.yml`(确认所有 agent/catalog 路径已改;pnpm cache 替换 npm cache)

**Interfaces:** Consumes: Task 1-4。

- [ ] **Step 1: pnpm cache + path 全检**

CI 各 job:`actions/setup-node` 的 `cache: "npm"` → `cache: "pnpm"` + `cache-dependency-path: pnpm-lock.yaml`;`npm ci`(各组件)→ `pnpm install --filter`;`backend-quality`/`backend-test` 的 `agent/` → `apps/agent/`;catalog-quality 的 `catalog/` → `workers/catalog/`。frontend/worker 路径**不动**(本波没搬)。

- [ ] **Step 2: 本地 yaml + 全量 make check**

```bash
ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); YAML.load_file('.github/workflows/deploy.yml'); puts 'yaml ok'"
cd apps/agent && nvm use 24 && uv run pytest tests/unit/ --no-header -q 2>&1 | tail -3
```
Expected:yaml ok + agent 单测全绿。

- [ ] **Step 3: 确认无遗漏的旧路径引用**

```bash
cd ~/Documents/Seichijunrei-agent/.claude/worktrees/backend-survey
grep -rnE '(^|[^/])\bcatalog/|(^|[^/])\bagent/' .github/ Makefile .pre-commit-config.yaml 2>/dev/null | grep -vE 'apps/agent|workers/catalog|frontend|#' | head
```
Expected:无残留裸 `agent/`、`catalog/`(都已 → apps/agent、workers/catalog);frontend/worker 的不算(本波保留)。

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "ci(wave1): pnpm cache + apps/agent + workers/catalog paths"
git push origin HEAD:backend-survey
```

---

## Self-Review
- **Spec coverage:** platform spec §1 目录布局(apps/workers/packages + pnpm)→ Task 1-4 覆盖 agent/catalog/contract/infra;web/edge 明确延到 Wave 4(spec §0.5 拓扑 + 本 plan wave 序列一致)。pnpm hoisted(spec)→ Task 1。✓
- **Placeholder scan:** 命令 + 路径具体;"若…回退"是真判据。
- **Consistency:** 包名 `agent.*` 物理移动不改命名空间(Task 3);catalog→contract 相对路径深度 +1(Task 4)。
- **不在本波:** Neon 迁移(Wave 2/3)、agent Worker 化(Wave 3)、edge/web 解耦+搬(Wave 4)、CI affected(Wave 5)、cutover(Wave 6)。

## Execution Handoff
推荐 **Subagent-Driven**(superpowers:subagent-driven-development):各 task 独立可验证,fresh subagent 每 task + review。注意:**worktree 内 Python 用 `uv tool run` / `nvm use 24`**;每 task make check 绿才进下一个。
