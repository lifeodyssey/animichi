# CI / 部署架构（方向）

- Status: **DIRECTION ACCEPTED**（owner 2026-08-06 — 原则如下；**实现未开**；与 Neon DBA / catalog ingest **分轨**）
- Executable plan (also design-only until scheduled): [ci-cd-refactor-plan](./2026-08-06-ci-cd-refactor-plan.md)
- Date: 2026-08-06
- Related: `docs/ops/deployment.md` · S0-v2 B4 / CI-1 · 现网 `.github/workflows/*`

---

## 0. Owner 定调（LOCKED 原则）

### 0.1 架构上对的

| 原则 | 含义 |
|---|---|
| **Monorepo 下每个可部署小单元一条部署 pipeline** | catalog / users / web / agent(container) / edge(root) / jobs… 各自一条，**不是**错 |
| **标准阶段** | **lint → test → build → 发布 artifact → deploy**；之后 **打 tag**，再部署、再打 tag（环境递进） |
| **Staging 后质量** | staging 部署完成后跑 **API 测试 + E2E**；必要时 **scheduler** 定时跑 API/E2E — **合理** |
| **Shared pipeline as code** | reusable workflow / composite action — **方向对** |

### 0.2 实现上错的（体感「超级乱」）

| 问题 | 现状 |
|---|---|
| **顶层 workflow 过多** | ~23 个 yml；10 条 `pipeline-*` + 胖 `ci.yml` + 零散 purge/eval/neon |
| **Reusable 有，但仍复制粘贴** | 每条 pipeline 各自 checkout/setup/codecov/pin；改 pin 改 N 处 |
| **关注点混杂** | 包 CI、跨栈 e2e、安全、eval、Neon 集成、**整段 staging→prod 晋升** 挤在叙事不清的文件里 |
| **PR 行为与「按包」打架** | 多条 lane **PR pathless 全跑**（merge_group 一致），包级隔离的收益被吃掉 |
| **命名** | `pipeline-*` = 包 CI，又和 **数据 ingest pipeline**、部署 pipeline 口语撞车 |
| **遗留双轨** | 旧 GHA purge yml 与 jobs Worker 空壳并存风险（jobs 已 RETIRED，#1316）；`ci.yml` 仍 500+ 行上帝工作流 |

**结论：**
**「每包一条部署线」保留。**
要改的是：**文件编排、复用深度、阶段纯度、命名，以及把乱七八糟的东西移出包部署主路径。**

---

## 1. 目标叙事（一张图）

```text
                    ┌─────────────────────────────────────┐
                    │  Package CI (每可部署单元一条「细调用方」)  │
                    │  lint → test → build → (artifact)     │
                    │  实现：几乎全是 workflow_call 进 reusable  │
                    └─────────────────┬───────────────────┘
                                      │ artifacts / green checks
                    ┌─────────────────▼───────────────────┐
                    │  Deploy orchestration（按环境）         │
                    │  staging: deploy components in order   │
                    │       → API tests → E2E (or schedule)  │
                    │  prod: approval → deploy → tag         │
                    │       → (optional) post checks         │
                    └─────────────────────────────────────┘

旁路（不进包部署主路径，单独 workflow）:
  security / CodeQL / dependabot
  agent-eval nightly|smoke（报告向）
  neon test-base 维护
  文档-only quality（可选）
```

---

## 2. 目标文件形状（比现在少、比现在纯）

### 2.1 建议保留的「种类」（不是再加 20 个文件）

| 种类 | 数量目标 | 职责 |
|---|---|---|
| **`reusable-package-ci.yml`**（或 2 个：node-ts / python） | **1–2** | lint/test/build/artifact 的 **唯一实现** |
| **`ci-<component>.yml` 细调用方** | **≈ 可部署单元数**（~6–8） | 只传 `component`、paths、working-directory、语言；**几乎无步骤正文** |
| **`reusable-deploy-component.yml`** | **1**（已有，继续收瘦） | 单组件 deploy + 必要 atlas/pulumi/wrangler |
| **`deploy-staging.yml` / `deploy-prod.yml`（或一个带 environment）** | **1–2** | **只**编排顺序、needs、post API/E2E、tag |
| **旁路** | 少量 | security、eval、ops 定时；**禁止**再塞进包 CI 正文 |

### 2.2 相对现状的映射

| 今日 | 目标 |
|---|---|
| `pipeline-web/agent/catalog/...yml` 各写一遍 steps | **同一 reusable**；调用方 30 行级 |
| `ci.yml` = 安全 + eval + neon 集成 + **整段 deploy 晋升** | **拆开**：检查旁路 vs **deploy orchestration** |
| `deploy.yml` 手动 prod | 保留；与自动晋升 **共用** reusable-deploy |
| `purge-anonymous-*.yml` | **删除或归档**（jobs Worker 为权威） |
| `pipeline-quality.yml` 大杂烩 | 缩成 invariants **或** 并入 security/docs 旁路 |
| 名 `pipeline-*` | 建议改为 **`ci-<pkg>`** 或 **`check-<pkg>`**；「pipeline」留给部署叙事/数据面口语 |

### 2.3 每包 CI 阶段（LOCKED 语义）

```text
lint → test → build → publish artifact
```

- **不** 在包 CI 里直接 `wrangler deploy`（除非明确 local-only 例外，本项目 **否**）
- artifact：web bundle、worker 构建产物、agent 镜像引用等 — 按组件定义 inputs
- branch protection：**required checks** = 各包 `ci-<pkg>` 的结论 job（或一个 matrix 汇总 job）

### 2.4 部署阶段（LOCKED 语义）

```text
(需要时) atlas migrate as migrator
→ deploy component(s) in dependency order
→ smoke
→ (staging) API tests + E2E
→ tag environment/git as policy defines
→ next environment …
```

- Staging 后 API/E2E：**部署编排的一部分**或 **独立 workflow 由 deploy 成功触发** — 都对；不要散落在每个 `pipeline-web` 里复制
- **Scheduler** 跑 API/E2E：允许（合成监控）；与 PR 门禁分离配置

---

## 3. 什么叫「乱」的判定标准（实现验收反例）

实现完成后应 **消除**：

1. 同一套 `actions/checkout@sha` + setup 在 ≥5 个文件全文重复而无 reusable
2. PR 上出现 **与 diff 无关** 的全量包编译作为默认（除非 contract/共享触达或 merge_group 全量策略 **成文**）
3. `ci.yml` 同时拥有「随机 eval」和「prod 五连 deploy」且无目录/命名分层
4. 包 CI 文件 > ~80 行且大部分是可复用 steps
5. 两套 purge（GHA + jobs Worker）无「唯一权威」声明

---

## 4. 与 monorepo 包结构的对齐

| 可部署单元 | CI 调用方（目标名示例） | Deploy 顺序提示 |
|---|---|---|
| contract | `ci-contract` | 库；先于消费者 |
| db (Atlas validate) | `ci-db` | migrate 挂 **deploy** 不是包 lint |
| catalog | `ci-catalog` | staging 较早 |
| users | `ci-users` | 依赖 contract；deploy 在 catalog 后或并行（现网顺序可保留） |
| web | `ci-web` | artifact → CF |
| agent | `ci-agent` | image/build |
| edge (root) | `ci-edge` | 路由依赖 users/catalog 已上 |
| jobs | `ci-jobs` | 原 maintenance |

**db validate** 可以是 `ci-db`；**migrate apply** 只在 deploy reusable 里（已有方向）。

---

## 5. 实施切片（未开做）

**可执行逐步写法见：** [ci-cd-refactor-plan](./2026-08-06-ci-cd-refactor-plan.md)（PR-C1…C6、reusable 合同、Sonar 现状）。

| 切片 | 内容 |
|---|---|
| **C0** | 本文方向 ACCEPTED（本会话） |
| **C1** | 盘点 required checks 清单 + 每文件职责表（只读 PR 说明） |
| **C2** | 抽/加深 `reusable-package-ci`（node + python 两档） |
| **C3** | 把现有 `pipeline-*` 收成薄调用方；统一命名 |
| **C4** | 从 `ci.yml` **拆出** deploy orchestration；`ci.yml` 降级或改名 |
| **C5** | 删除/归档 purge GHA；scheduler E2E 若需要则独立 workflow |
| **C6** | branch protection / merge queue 文档更新 |

**不做进本列车：** 改 Neon 角色（DBA 图）；改 catalog ingest 代码结构。

---

## 6. 明确非目标

- 取消「每包一条线」改回巨型单体 job 且无法并行
- PR 上永远跑全 monorepo 且无法 path-skip（除非 merge_group 策略显式选择全量）
- 在包 CI 里藏生产 deploy

---

## 7. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | Owner：架构原则对（每包部署线 + lint/test/build/artifact/deploy/tag + staging API/E2E）；乱在实现与杂物；目标形状与切片 |
