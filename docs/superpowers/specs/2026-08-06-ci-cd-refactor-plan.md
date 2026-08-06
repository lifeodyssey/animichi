# CI/CD 重构怎么写（基于现方案 · 可执行计划）

- Status: **ACCEPTED (design only)** — owner 2026-08-06；**不实施 YAML**，直至另开实现列车  
- Aligns: [ci-deploy-architecture](./2026-08-06-ci-deploy-architecture.md)（DIRECTION ACCEPTED）  
- Date: 2026-08-06  
- Scope (when implemented): **只改 `.github` 编排与文档**；不改业务包运行时（除非 pin/脚本路径）  
- Out: Neon DBA N1、catalog ingest 代码、产品 enabler；**本会话不改 workflow 文件**

---

## 0. 先回答：Sonar 接了没？

| 证据 | 含义 |
|---|---|
| 根目录 **`.sonarcloud.properties`**（写明 automatic-analysis 唯一配置） | **SonarCloud 已接**，偏 **自动分析 / GitHub App**，不是每条 `pipeline-*.yml` 里手写 `sonar-scanner` job |
| PR 历史上有 **SonarCloud Quality Gate** 顶层评论 | 门禁在 **GitHub 检查/评论** 侧，不在我们自研 workflow 正文里 |
| `s0v2/GOAL.md` 仍有「sonar 配置合一且 QG 仍工作」 | 配置曾分叉风险；现文件注释称 twin 已退役 |
| **工作流内几乎无 `sonar-scanner` step** | 所以你会「有点忘了接没接」——**接了，但是隐形的** |

**重构时怎么写 Sonar：**

- **保留** SonarCloud 为 **仓级 CI 横切门**（Quality Gate = required check 之一，若 branch protection 已勾选）。  
- **不要** 复制进 9 个 package workflow。  
- **要做：** 在重构文档/部署 runbook 写清「Sonar = Automatic Analysis + `.sonarcloud.properties`」；验证 **一份配置**；QG 仍绿。  
- 若以后要 **CI-based analysis**（显式 action），再做成 **一个** `reusable` / 一个 `ci-quality` job，仍不 per-package 抄。

**Codecov：** 已在多条 pipeline 里 OIDC upload — 应 **收进 reusable-package-ci**，flag=`${{ inputs.component }}`。

**Security：** 已有 `reusable-security.yml` + `codeql.yml` — 保持横切；从胖 `ci.yml` 叙事上拆清楚即可。

---

## 1. 目标终态（重构写完后长什么样）

```text
.github/
  actions/setup/                    # 已有，继续唯一安装入口
  workflows/
    # ── CI：包级（薄调用方，~20–40 行）──
    ci-contract.yml
    ci-db.yml
    ci-catalog.yml
    ci-users.yml
    ci-web.yml
    ci-agent.yml
    ci-edge.yml
    ci-jobs.yml                   # 原 pipeline-maintenance

    # ── CI：横切（各 1 个）──
    ci-security.yml               # 调 reusable-security + 可选 codeql 触发关系写清
    # Sonar：Automatic Analysis（无 workflow 或将来单一 job）— 见 §0

    # ── 共享实现 ──
    reusable-package-ci.yml       # NEW：lint/test/build/artifact/codecov
    reusable-package-ci-python.yml # 或同一文件 matrix language: node|python
    reusable-deploy-component.yml # 已有，收瘦注释/preflight 若可能
    reusable-post-deploy-test.yml # 已有
    reusable-cross-stack-e2e.yml  # 已有
    reusable-security.yml         # 已有

    # ── CD 编排 ──
    deploy-staging.yml            # 从 ci.yml 拆出：顺序 deploy + post API/E2E
    deploy-prod.yml               # 自动晋升 + 与 manual 对齐
    deploy-manual.yml             # 今日 deploy.yml 改名/收束

    # ── 旁路（不进包部署主路径）──
    agent-eval-nightly.yml
    agent-eval-smoke.yml          # 可选：从 ci.yml 挪出
    neon-test-base.yml
    dependabot-agent.yml
    codeql.yml                    # 或并入 ci-security 文档关系

    # 删除/归档
    # pipeline-*.yml              → 被 ci-*.yml 取代
    # purge-anonymous-*.yml       → 权威在 workers/jobs
    # ci.yml 上帝文件             → 拆空或只剩 redirect 注释期
```

**每包 CI 语义（不变）：** `lint → test → build → (artifact)`  
**CD 语义（不变）：** migrate(若需) → deploy → smoke → staging API/E2E → tag → prod…

---

## 2. 核心 reusable 合同（重构要先写这个）

### 2.1 `reusable-package-ci.yml` inputs（草案）

| input | 用途 |
|---|---|
| `component` | 名字：catalog / web / …（codecov flag、artifact 名） |
| `language` | `node` \| `python` |
| `working_directory` | 包根 |
| `lint_command` | 覆盖默认时用 |
| `test_command` | |
| `build_command` | 空 = 跳过 build job |
| `coverage_file` | 如 `coverage/lcov.info` |
| `upload_codecov` | bool |
| `startup_smoke` | bool（catalog 类 wrangler boot） |
| `node_package_filter` | pnpm filter 名 |

**jobs 固定：** `lint` → `test` → `build`（needs test 或 parallel 策略成文）→ 可选 `smoke`。  
**禁止：** 在 reusable 里 `wrangler deploy`。

### 2.2 薄调用方示例（目标长度）

```yaml
# ci-catalog.yml — 目标形态（示意）
name: ci-catalog
on:
  pull_request:
  merge_group:
    branches: [main]
  push:
    branches: [main]
    paths: [ 'workers/catalog/**', 'packages/contract/**', ... ]
jobs:
  ci:
    uses: ./.github/workflows/reusable-package-ci.yml
    with:
      component: catalog
      language: node
      working_directory: workers/catalog
      test_command: pnpm run test:worker
      build_command: # or startup_smoke: true
      coverage_file: workers/catalog/coverage/lcov.info
      upload_codecov: true
      startup_smoke: true
    permissions:
      contents: read
      id-token: write
```

**PR path 策略（实现时二选一，须成文）：**

| 策略 | 说明 |
|---|---|
| **A（推荐）** | PR 用 **paths-filter / dorny 在调用方或 reusable 入口** 跳过无关包；`merge_group` **全量** 跑所有 ci-* |
| **B（现状）** | PR pathless 全跑 — 仅当 branch protection/queue 强制要求且短期不改 |

重构默认按 **A** 写；若 queue 约束暂不能 A，C3 可先薄调用方 + 仍 pathless，C4 再切 A。

---

## 3. 分 PR 怎么拆（推荐顺序）

### PR-C1 — 盘点与门禁表（无行为变化）

**写什么：**

- 表格：今日每个 workflow 的职责、触发、是否 required  
- Required checks 目标列表（ci-catalog 等新名映射）  
- Sonar：确认 Automatic Analysis + `.sonarcloud.properties` + QG 是否 required  

**验收：** 文档 PR；CI 行为不变。

### PR-C2 — 引入 `reusable-package-ci`（先迁 1–2 个最简包）

**先迁：** `contract`、`users` 或 `edge`（步骤最像）。  
**验收：** 原 pipeline 与新 ci-* 可短暂双跑或直接切；测绿；codecov flag 仍在。

### PR-C3 — 全部 `pipeline-*` → 薄 `ci-*`

| 旧 | 新 |
|---|---|
| pipeline-web | ci-web |
| pipeline-agent | ci-agent（python 档） |
| pipeline-catalog | ci-catalog |
| pipeline-users | ci-users |
| pipeline-edge | ci-edge |
| pipeline-maintenance | **ci-jobs**（与包 rename 可同波或先别名） |
| pipeline-contract | ci-contract |
| pipeline-db | ci-db（validate only；无 deploy） |
| pipeline-infra | ci-infra（特殊可保留更多 steps，但仍尽量 composite） |
| pipeline-quality | 缩成 `ci-invariants` 或并入 security/docs |

**验收：** 无 `pipeline-*.yml`（或仅 deprecated 空壳一周）；branch protection 更新 required 名。

### PR-C4 — 拆 `ci.yml` 上帝文件

| 挪出 | 去向 |
|---|---|
| security job | `ci-security.yml` → reusable-security |
| agent-eval-smoke | `agent-eval-smoke.yml`（旁路） |
| python-integration / catalog-spikes | 旁路或 path 触发的 `ci-agent-integration.yml` |
| deploy-staging/* / post-staging | **`deploy-staging.yml`** |
| deploy-prod/* / post-prod | **`deploy-prod.yml`** |
| cross-stack e2e | 由 **deploy-staging 成功** `workflow_run` 或 `needs` 调 reusable-cross-stack-e2e |

**验收：** 不再存在「打开 ci.yml 既有 eval 又有五连 prod deploy」；CD 只读 deploy-* 文件。

### PR-C5 — 清理杂物

- 删除或 archive：`purge-anonymous-sessions.yml`、`purge-anon-quota-counts.yml`（权威 **jobs Worker**）  
- `deploy.yml` → `deploy-manual.yml`，与 deploy-prod **共用** reusable-deploy  
- 文档：`docs/ops/deployment.md` 重画「CI 横切 / 包 CI / CD」三层 + Sonar 说明  

### PR-C6 — 策略打磨（可选同波）

- PR path-skip 策略 A  
- staging 后 API/E2E 触发关系写死  
- scheduler 健康检查（若需要）独立 `schedule: cron` workflow  

---

## 4. 每层放什么（写进 review 清单）

### 4.1 包 CI（reusable-package-ci）— **该重用却没重用的集中地**

| 步骤 | 重用 |
|---|---|
| checkout + setup | `actions/setup` |
| lint / typecheck | inputs |
| test + coverage | inputs |
| codecov | **一处** OIDC |
| build / emit artifact | inputs |
| 可选 startup smoke | inputs |

### 4.2 横切 CI — **不进包正文**

| 能力 | 放置 |
|---|---|
| gitleaks / 供应链等 | reusable-security / ci-security |
| CodeQL | codeql.yml 或 security 文档绑定 |
| **SonarCloud QG** | Automatic Analysis + `.sonarcloud.properties`（现状）；勿 9 份 scanner |
| 全仓 allowlist / pin 检查 | ci-invariants（原 quality 瘦身） |

### 4.3 CD — **只交付**

| 能力 | 放置 |
|---|---|
| Atlas apply | reusable-deploy（已有） |
| wrangler / pulumi | reusable-deploy |
| 组件顺序 | deploy-staging / deploy-prod |
| smoke / post-deploy | reusable-post-deploy-test |
| E2E / API after staging | deploy-staging 后触发 |
| tag | deploy 成功后策略（成文） |

---

## 5. 风险与迁移技巧

| 风险 | 缓解 |
|---|---|
| Required check 改名导致 merge 卡死 | C3 先 **双写 check 名** 或保护规则预加新名再删旧名 |
| merge_group 与 path-filter | 策略 A：merge_group 强制 full；PR 可 skip |
| agent python 特殊 | `language: python` 专用 job 模板，仍一个 reusable 文件内 `if` |
| Sonar 隐形 | C1 验证 QG；配置只认 `.sonarcloud.properties` |
| 大 PR 难 review | **严格按 C1→C6**；C2 只迁 2 包做样板 |

---

## 6. 成功标准（重构 Done）

- [ ] 包 CI **无** 大段复制的 checkout/setup/codecov  
- [ ] 部署编排 **不** 活在「还跑 eval 的 ci.yml」里  
- [ ] 顶层 workflow 数量明显下降或 **职责一目了然**（名见义）  
- [ ] Sonar / Security / Codecov 位置成文；Sonar **未** 复制进每包  
- [ ] purge 双轨消除  
- [ ] `docs/ops/deployment.md` 与本文一致  
- [ ] 一次完整 PR：改单包只跑相关 ci（若已上策略 A）或至少 merge_group 行为成文  

---

## 7. 建议的第一行「设计说明」（给将来写 PR 的人）

> 我们不否定「每包一条部署线」。  
> 本次重构把 **实现** 收成：薄 `ci-<pkg>` + 深 `reusable-package-ci` + 独立 `deploy-*` + 横切 security/sonar。  
> SonarCloud 已通过 Automatic Analysis 接入；本次只文档化与配置合一验收，不把 scanner 抄进每个包。

---

## 8. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：如何按已定方向重构现网 CI/CD；Sonar 现状澄清；C1–C6 PR 切片 |
| 2026-08-06 | Owner **ACCEPTED design only** — 实现后置 |
