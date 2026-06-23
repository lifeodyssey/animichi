# CI/CD Pipeline 设计 — monorepo 多组件独立部署 + 双级 GitOps

> 2026-06-23 · backend-survey。配套:`2026-06-23-platform-monorepo-cf-deploy-design.md`(架构)、`2026-06-23-multi-env-neon-supabase-design.md`(多环境)。

## Goal

monorepo(apps/agent · workers/catalog · workers/edge · apps/web)的每个组件**独立部署**,CI 与 CD 职责分离,prod 写全部走受控 CD(不在本地),DB schema 用 Atlas migration + Neon branching 验证。

## §1 CI vs CD 职责(设计原则)

| | CI | CD |
|---|---|---|
| 触发 | 每次 PR / push 分支 | merge→main(staging)、tag `v*`(prod) |
| 职责 | lint · typecheck · unit/integration test · 契约 parity | DB migration · infra(pulumi) · deploy(wrangler) · smoke |
| 凭据 | **零 prod 凭据** | GH environment secrets(prod/staging 隔离) |
| 失败 | 阻止 merge | 停,不进下一环境 |
| 信任边界 | 跑在每个 PR、泄露面最小 | 持 prod 密钥、只被受控事件触发 |

**核心:CI 不部署、CD 不重跑单测(信 CI 结论)。** 现状 `ci.yml` 把 `deploy-catalog`(CD)混进 CI 文件 → 本设计拆开。

## §2 触发模型 — 双级 GitOps

```
PR / push 分支  →  CI(affected lint/type/test + PR Neon branch 验 migration)  →  绿才能 merge
merge → main    →  CD-staging(affected:atlas→pulumi→deploy → Neon staging branch + staging Workers)  →  smoke
tag v*          →  CD-prod(affected:atlas→pulumi→deploy → Neon production + prod Workers)  →  smoke
```

- **prod 需人工 approval**:GH environment `production` 设 required reviewer —— tag 后需手动批准才真正 deploy prod。
- staging 自动(merge 即部),prod 受控(tag + approval)。

## §3 affected 检测 — "独立部署"的实现

`dorny/paths-filter@v4.0.1` 按改动路径决定部哪些组件:
- `workers/catalog/**` → catalog
- `apps/agent/**` → agent
- `workers/edge/**` → edge
- `apps/web/**` → web
- `packages/contract/**` → 触发**所有依赖它的**组件(catalog/agent/edge)

一个 tag 可以只动一个组件;改 contract 才扇出。CI 同样按 affected 只跑改动组件的检查。

## §4 DB migration — Atlas + Neon branching

**工具:Atlas**(`ariga/atlas-action@v1.15.5`)——declarative(写目标 schema、算 diff 生成 versioned migration + rollback)、Go 单 binary(CI 无 JVM 负担)、语言无关(schema 独立于 catalog[TS]/agent[Python],是 DB 的资产不归任一 app)。
- `atlas.hcl`(dev-db 指 Neon branch、migration dir `db/migrations/`)。
- 现有 `supabase/neon/0001_init.sql` 转成 Atlas 首条 baseline migration。
- catalog 的 TS 类型:`drizzle-kit pull` 从 DB introspect(drizzle 只做查询,不做 migration)。

**Neon branching — 两个验证时机(都要)**:
1. **PR 临时 branch**(merge **前**):`neondatabase/create-branch-action@6.3.1` 从 production 建 branch(~1s 带真数据)→ `atlas migrate apply` 到 branch(在 prod-like 数据上验 migration)→ integration test → PR 关闭 `neondatabase/delete-branch-action@v3.2.1` 删。**在合进 main 前就发现 migration 炸。**
2. **staging branch**(merge **后**):CD-staging 对常驻 staging branch `atlas migrate`(集成验)。
3. **production**:CD-prod 对 production branch `atlas migrate`。

## §5 Workflow 文件结构 — composite + reusable(DRY)

```
.github/
  actions/setup/action.yml      composite action:pnpm+node(+uv)+install —— CI 各 job & CD 共用的 setup 步骤序列
  workflows/
    ci.yml                      affected lint/type/test + PR Neon branch 验 migration(零 prod 凭据)
    _deploy-component.yml       reusable workflow:atlas→pulumi→wrangler→smoke【部署逻辑唯一一处】
                                inputs: component / environment / neon_branch;secrets: inherit
    cd-staging.yml              merge→main:算 affected → 对每个 affected `uses: ./_deploy-component`(environment=staging)
    cd-prod.yml                 tag v*:算 affected → `uses: ./_deploy-component`(environment=production,需 approval)
```

- **composite action** 打包步骤序列(setup);**reusable workflow** 打包整个部署 job(带 environment 隔离 + secrets)。
- 加一个新组件 = matrix 里加一行,不抄 yaml。

## §6 现成官方 Action 清单(全最新 + SHA-pin)

| 步骤 | action | 版本 |
|---|---|---|
| checkout | `actions/checkout` | v7.0.0 |
| Node | `actions/setup-node` | v6.4.0 |
| pnpm | `pnpm/action-setup` | v6.0.9 |
| uv(Python) | `astral-sh/setup-uv` | v8.2.0 |
| affected | `dorny/paths-filter` | v4.0.1 |
| Atlas | `ariga/atlas-action` | v1.15.5 |
| Pulumi | `pulumi/actions` | v7.0.0 |
| wrangler | `cloudflare/wrangler-action` | v4.0.0 |
| Neon 建 branch | `neondatabase/create-branch-action` | 6.3.1 |
| Neon 删 branch | `neondatabase/delete-branch-action` | v3.2.1 |

- **全部 pin 到 commit SHA + `# vX.Y.Z` 注释**(过 Sonar 供应链规则;"最新"与"SHA-pin"不冲突 —— pin 的是该最新版对应的不可变 SHA)。
- 升级现有 `ci.yml` 的旧版(checkout v6→v7、pnpm-action v4→v6、pulumi v6→v7 等)。
- 零手写脚本:每一步都是官方 action。

## §7 多环境

| | staging | production |
|---|---|---|
| Neon | staging branch(常驻,从 production fork) | production branch(`br-cold-term-aor1v6gl`) |
| Pulumi stack | `staging` | `prod` |
| GH environment | `staging`(自动) | `production`(required reviewer) |
| 触发 | merge→main | tag `v*` |
| Workers | `*-staging` | prod 名 |

Pulumi state 已在 R2(`seichijunrei-pulumi-state`);secrets 走 GH environment(Neon connStr / Pulumi passphrase / CF token / R2 creds)。

## §8 范围

本设计是**全 4 组件通用的模式**,但当前只 **catalog** 能落地(agent→Python Worker 是 Wave 3、edge/web 解耦是 Wave 4)。
- **Wave 2(当前)**:按本 pipeline 把 catalog 接入 —— ci.yml 拆分、建 composite + reusable + cd-staging/cd-prod、Atlas 落地(0001 转 baseline)、catalog 走双级 GitOps 上 prod。
- **后续 wave**:agent/edge/web 按同模式接入(各加一行 affected + matrix)。

## §9 安全

- prod 凭据只在 CD workflow + GH environment secrets,CI 永不接触。
- 所有 action SHA-pin。
- prod deploy 需人工 approval。
- (遗留:对话中暴露过的 CF token + R2 creds 部署完 rotate。)
