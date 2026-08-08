# Pulumi / `infra/` 现状与目标（设计）

- Status: **ACCEPTED (design only)** — owner 2026-08-06；边界 + best-practice 对照已定；**不含实现**
- Date: 2026-08-06
- Package: `infra/`（独立 pnpm 项目，**不在** workspace 成员里）
- Stacks: `staging` · `prod`（`Pulumi.staging.yaml` / `Pulumi.prod.yaml`）
- Aligns: monorepo 目标树、`docs/ops/deployment.md`、edge「routes ∈ Pulumi / code ∈ Wrangler」

---

## 0. 一句话

**职责切得对**：Cloudflare **共享平台**（R2、hostname/routes、staging WAF、zone 硬化）归 Pulumi；**Worker 代码与 service binding** 归 Wrangler。
**结构还薄**：几乎全部在 **单文件 `index.ts`（~458 行）**；测试有 topology  harness，但无 ComponentResource 分层；**Neon 项目/分支不在 Pulumi 里**（连接串当 secret 注入）。

---

## 1. 所有权边界（LOCKED · 保持）

| 归 Pulumi (`infra/`) | 归 Wrangler / 各 Worker | 归 Atlas / Neon |
|---|---|---|
| R2 buckets（media、tiles） | Worker 脚本内容、bindings 声明 | schema / GRANT / 迁移 |
| Custom Domain + **edge 路径 routes**（`/v1/*` `/img/*` `/tiles/*` `/healthz`） | `wrangler deploy` | 分支 connstr 内容 |
| www 占位与 redirect（prod） | secrets **推送**到 Worker（CI `wrangler secret put`） | |
| Staging WAF gate（cookie/header/IP） | 容器 image 构建 | |
| Zone DNSSEC / CAA / HSTS / zone rate-limit（prod zone） | | |
| 导出 `catalogDatabaseUrl` 给 CI（config secret，非 CF WorkersSecret 资源） | | |

**铁律（已验证、AGENTS 写明）：**
`wrangler deploy` **不** 覆盖 Pulumi 管的 routes → **routes 只在 Pulumi 改**。

---

## 2. 现状 inventory

```text
infra/
  Pulumi.yaml                 # project: seichijunrei-infra, runtime nodejs
  Pulumi.staging.yaml         # webRoutes + stagingGate + secrets
  Pulumi.prod.yaml            # webRoutes 默认关；catalogDatabaseUrl secret
  index.ts                    # 全部资源 + 导出 validate* 纯函数
  testing/harness.ts          # topology 测
  topology-*.test.ts          # node:test
  package.json                # 独立 lockfile；--ignore-workspace 安装
  AGENTS.md
```

### 2.1 资源块（`index.ts`）

| 块 | 内容 |
|---|---|
| R2 | `catalog-media*`、`map-tiles*`（protect + deleteBeforeReplace） |
| 可选拓扑 | `webRoutesEnabled`：web Custom Domain + 4 条 edge route；prod 另有 www |
| Zone 硬化 | 仅 **prod + zoneId**：DNSSEC、CAA、/v1 rate limit、HSTS |
| Staging gate | WAF custom rule + IP allowlist + token（secret） |
| Export | `catalogDatabaseUrl`、`catalogBucketName`、`tilesBucketName` |

### 2.2 正确碎片

- Stack 分名：prod 稳定名，非 prod 后缀
- 未知 stack **禁止** 误吃 `stagingDomain`
- Staging gate 表达式与 token 校验可测（export 纯函数）
- 每次 `up` 前 stack export → R2 rollback-backups（**非** 公开 GH artifact）
- 无 Hyperdrive（catalog = neon-http）— 有意简化

### 2.3 债 / 缺口

| ID | 问题 | 建议方向 |
|---|---|---|
| **I1** | **单文件上帝 `index.ts`** | 拆 `src/{r2,topology,hardening,staging-gate}.ts` 或 ComponentResource |
| **I2** | **不在 pnpm workspace** | 可保持（隔离 deps）或可选接入 workspace；二选一成文 |
| **I3** | **Neon 不在 IaC** | 可接受（分支手建 + secret）；或日后 `pulumi-neon` / ESC 只管引用 |
| **I4** | **Workers 脚本名硬编码** | `animichi` / `animichi-web` 与 wrangler name 双源；应用 config 或共享常量文档钉死 |
| **I5** | **rollback-backups 无 lifecycle** | #521；R2 生命周期规则应在 Pulumi |
| **I6** | **ESC / 中央 secrets** | #674 方向；避免更多 secret 只活在 stack yaml |
| **I7** | **preview 栈** | 无第三 hostname 映射；PR preview 若要上需显式加 stack 策略 |
| **I8** | **users/agent/jobs 的 CF 资源** | 多半仅 wrangler；确认是否缺 R2/队列等应进 Pulumi 的共享物 |
| **I9** | **TypeScript 5 vs 仓 TS 7** | 对齐大版本减少双轨（小） |

---

## 3. 目标结构（best practice · 一次说清）

```text
infra/
  Pulumi.yaml
  Pulumi.staging.yaml
  Pulumi.prod.yaml
  package.json
  AGENTS.md · CONTEXT.md
  src/
    index.ts                 # 只组装 + export
    config.ts                # stack/config 解析
    r2.ts                    # media + tiles buckets
    topology.ts              # Custom Domain + routes + www
    hardening.ts             # DNSSEC/CAA/HSTS/rate-limit（prod zone）
    staging-gate.ts          # WAF + IP helpers
    names.ts                 # script/bucket 命名与 wrangler 对齐表
  test/                      # topology-* 迁入
  testing/harness.ts
```

**不** 引入巡礼 `domain/`。
**可** 用 Pulumi **ComponentResource**（`AnimichiWebTopology`、`StagingAccessGate`）——这是 IaC 组件，不是 DDD。

---

## 4. 与 CI/CD、配置放置

| 项 | 放置 |
|---|---|
| `pulumi preview` | `ci-infra` / 今日 `pipeline-infra`（凭证 preview） |
| `pulumi up` | **仅 CD** `reusable-deploy-component`（staging/prod） |
| Stack yaml | **`infra/` 内**（已正确） |
| 状态后端 | R2 + `PULUMI_BACKEND_URL`（secret/env，不进公开 repo 明文） |

配置放置文：`infra/` 的 Pulumi* **属于包内配置**，不要搬到根。

---

## 5. 与 Neon DBA 的边界

| Neon | Pulumi |
|---|---|
| 库内角色、迁移、分支内容 | **不** 管 |
| 连接串作为 **secret 配置** | 可存 stack secret / 将来 ESC；**apply 后** CI 注入 Worker |
| 分支创建 | 人/neonctl/API；可选未来 IaC |

DBA 图 N1 换 app DSN **不** 要求先大改 Pulumi；最多更新 `catalogDatabaseUrl` 指向与角色匹配的 URL。

---

## 6. PR 切片（实现时）

| 切片 | 内容 |
|---|---|
| **P0** | 本文 ACCEPTED design only — **DONE 2026-08-06** |
| **P1** | `index.ts` → `src/*` 无行为拆分 + 测绿 |
| **P2** | #521 R2 lifecycle on rollback-backups |
| **P3** | `names.ts` 与 wrangler 脚本名单一来源文档/常量 |
| **P4** | ESC/中央 secret（跟 #674）可选 |
| **P5** | preview stack 策略（若产品要 PR 域名） |

---

## 7. 非目标

- 用 Pulumi 部署 Worker **源码**（继续 wrangler）
- 把 Atlas 迁移搬进 Pulumi
- 在 `infra/` 写巡礼业务

---

## 8. 与业界 / 官方 best practice 对照（2026-08 检索）

来源摘要：Pulumi 文档（[Secrets](https://www.pulumi.com/docs/iac/concepts/secrets/)、[ESC](https://www.pulumi.com/docs/esc/)、[Config](https://www.pulumi.com/docs/iac/concepts/config/)）、Pulumi Components 产品文、社区/技能库对 **ComponentResource** 的强调、CF 生态「routes vs wrangler」实践。

| 实践 | 官方/社区说法 | 我们现状 | 结论 |
|---|---|---|---|
| **Stack = 环境** | 每环境一 stack + `Pulumi.<stack>.yaml` | staging / prod | ✅ 符合 |
| **Config / secrets** | 敏感值用 `requireSecret`/`getSecret`；勿明文 | gate token、DB URL、allowed IPs 用 secret；AGENTS 强调 export 不带 show-secrets | ✅ 符合 |
| **跨栈/跨项目共享 secret** | 栈内 secret 够单栈用；**多栈共用 → ESC** 中央化 | 多在 stack yaml + GH secrets；#674 指向 ESC | ⚠️ 方向对，未做满 — 符合「下一步」而非做错 |
| **ComponentResource / Components** | 把相关资源打成可复用逻辑单元，避免扁平巨图 | 全在 `index.ts` 顶层 `new` | ⚠️ **结构上落后于 best practice**；拆分/组件化合理 |
| **项目结构** | 代码与配置分离、可按 repo 对齐 GitOps | `infra/` 独立、stack yaml 在旁 | ✅ 小项目可接受；大了应 `src/` |
| **多栈拆分** | 超大时 network/apps 分 project + StackReference | 单 project 两 stack，体量尚小 | ✅ 暂不必拆 project |
| **Cloudflare Workers** | 可用 Pulumi 管 Script+Route；也有 **Wrangler 管代码、IaC 管周边** | **routes/DNS/R2 ∈ Pulumi，code ∈ wrangler** | ✅ 常见、合理混合；不是「必须全在 Pulumi」 |
| **Worker secrets** | CF secret 常用 wrangler put；ESC 可与 CF/wrangler 集成 | CI `wrangler secret put` + 部分 Pulumi config 导出 | ✅ 可接受；ESC 统一是增强项 |
| **State 与备份** | 远端 state + 访问控制 | R2 backend + export 备份到同桶 | ✅；缺 lifecycle 是运营债不是架构错 |
| **prod 人工门** | 生产变更要控 | GitHub `production` environment | ✅ |

**总评：**

- **所有权与 secrets 用法**：与官方/最佳实践 **大体一致**，不是野路子。
- **「最佳」还差的主要是结构（组件化）与 secret 中央化（ESC）**，不是「routes 不该在 Pulumi」。
- 我们文档里建议的 `src/` 拆分 + ComponentResource + ESC + lifecycle，**对齐** 业界写法，不是自创洁癖。

**不必照抄的：**

- 为洁癖把 **Worker 源码** 也改成纯 Pulumi `WorkersScript` 管理（会与现 wrangler 工作流打架；CF 官方也同时支持两边）。
- 立刻把 Neon 全建成 Pulumi 资源（DBA/分支生命周期可继续 neonctl + Atlas）。

---

## 9. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：所有权、inventory、债、目标树、切片 |
| 2026-08-06 | §8 对照官方/社区 best practice（检索） |
| 2026-08-06 | Owner **ACCEPTED design only** |
