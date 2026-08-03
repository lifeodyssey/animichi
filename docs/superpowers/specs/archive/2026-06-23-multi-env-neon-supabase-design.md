# 多环境设计 — Neon(数据 + branching) + Supabase(auth-only) → 全 Neon 收敛(auth 迁 Neon Auth,SD-31)

> 2026-06-23。platform-monorepo(`2026-06-23-platform-monorepo-cf-deploy-design.md`)的多环境补充决策。解决"隔离测试环境"痛点:数据迁 **Neon**(免费 branching),auth 留 **Supabase**(GoTrue,降为 auth-only)。
>
> **状态更新(2026-07-07,SUPERSEDED-IN-PART)**:本设计「auth 留 Supabase」的分工已被 **SD-31** 修订——auth 后端迁 **Neon Auth**(Better Auth v1.4.18 底座),往**全 Neon**收敛。当初 §8「等 Neon Auth GA 稳定再评估」的门槛(见下)已由用户按 **Better Auth 底座成熟度**提前解冻(原被否的 Stack Auth 底座已换成成熟的 Better Auth,否决理由过期);登记册 DD-1 同步翻为已激活。**数据侧(Neon)结论不变**,仅 auth 侧超越:edge JWT 验证从连 Supabase GoTrue 改为对 **Neon Auth JWKS 本地验签**(端点走 `NEON_AUTH_JWKS_URL` env 注入,不硬编码主机名 / project-id,公开 repo)。传导详情见 `2026-07-06-frontend-rebuild-inputs.md` §七 SD-31 / `2026-07-06-frontend-rebuild-spec.md`。

## §0 背景与动机
- 多环境(prod/staging/preview)的核心痛点 = **隔离的数据库**。
- Supabase **Branching = Pro only**($25/mo + 每分支计费);免费 tier 每 org 2 个 active 项目,**已占满**,不能再开第三个作 staging。
- Neon 免费 tier 提供 **DB branching**(10 branches/project,copy-on-write 含数据,官方 per-PR GitHub Action),且支持 **postgis/pgcrypto/vector**(我们全部用到)。比 Supabase branching 还强(Supabase preview 不复制数据)。
- 用户决策:**数据全搬 Neon,auth 留 Supabase**。

## §1 架构 — auth / data 解耦
```
用户 magic-link 登录 → Supabase GoTrue 签 JWT(sub = user UUID)
        ↓
edge worker 验 JWT → 注入可信 X-User-Id
        ↓
agent / catalog 容器 → asyncpg/Hyperdrive 直连 Neon → WHERE user_id = X-User-Id
```
- **Supabase = 身份**(GoTrue magic-link,JWT 真相源;`auth.users` 在 Supabase)。降为 **auth-only**,只占 1 个免费项目。
- **Neon = 数据**(sessions / conversation_messages / routes / user_memory / feedback / catalog 全表)。`user_id` = JWT `sub`,**不 FK 到 auth.users**(它在另一系统)。
- 衔接键 = **JWT `sub`**(标准 auth-provider-独立模式)。

## §2 关键事实(已确认,决定改动量)
后端 `agent`/`catalog` 用 **asyncpg / Hyperdrive 直连 Postgres DSN**(`SUPABASE_DB_URL`,superuser,**绕 RLS**),授权全在 **app 层** `WHERE user_id = $1`(`user_id` = edge 注入的 X-User-Id),**不依赖 RLS / auth.uid / JWT claims**。
⟹ supabase/migrations 里的 RLS policy 在后端运行时**不参与授权**(防御性);迁 Neon 去掉无功能影响。

## §3 迁移改动(小)
| 项 | 改动 |
|---|---|
| `auth.users` FK ×2 | `operational_tables`/`remote_schema` 的 `user_id ... REFERENCES auth.users(id)` → 普通 `UUID NOT NULL` 列 |
| RLS policy ×4(含 `auth.uid` ×5)| 去掉(Neon 无 Supabase auth schema;后端不依赖,无功能影响)|
| extensions | `postgis`/`pgcrypto`/`vector` — Neon 全支持,迁移无碍 |
| `DATABASE_URL` | → Neon connection string(参数化,Hyperdrive 连 Neon)|
| 授权逻辑 | **不改**(app 层 user_id 过滤)|
| catalog 表(bangumi/points/clusters…)| 纯数据,无 auth 依赖,直接迁 |
| 数据 | `pg_dump` 现有 Supabase → restore Neon;或 Neon branch 从导入的 prod 克隆 |

## §4 环境矩阵
| 环境 | 数据(DB) | Auth | 隔离方式 |
|---|---|---|---|
| **prod** | Neon(prod project/main branch)| Supabase GoTrue(magic-link)| — |
| **staging** | Neon branch(长期 staging)| Supabase GoTrue(同)或 `sk_` | branch 隔离 |
| **dev / CI(per-PR)** | Neon per-PR branch(官方 GH Action,含数据,merge/close 自动清)**或**本地 `supabase start` | `sk_`(后端测试)/ 本地 GoTrue(登录流测试)| 每 PR / 每次全新 |

- 真 magic-link 登录流端到端测试 → 本地 `supabase start`(完整 GoTrue)或 prod;staging/preview 后端测试用 `sk_`。

## §5 Pulumi 多 stack + Neon 工具链
- **Pulumi stacks**:`prod` / `staging`。stack config 驱动:CF 资源(routes/Hyperdrive/R2/DNS)、`DATABASE_URL`(→Neon,secret)、Supabase auth URL/keys。
- **Neon 不归 Pulumi**(非 CF 资源):Neon project/branch 由 `neonctl` + Neon 官方 per-PR GitHub Action 管;Pulumi 只把 Neon connection string 注入 Hyperdrive 配置 / Worker secret。
- **Neon 工具链**(已装):`neonctl` 2.27.0、remote MCP(`mcp.neon.tech`)、skills(`neon` / `neon-postgres`)。

## §6 对 platform-monorepo spec 的影响
- DB 决策更新:**prod+staging 都用 Neon**(原 spec 假设 Supabase pg → 改 Neon)。Hyperdrive → Neon。
- 加 **staging** Pulumi stack。
- Wave 计划:**新增 "Neon 迁移" 子任务**(去 FK/RLS、`pg_dump`→Neon、`DATABASE_URL` 切换),并入 Wave 2(catalog)/ Wave 3(operational + agent)。Auth 不动(edge JWT 验证仍连 Supabase)。**→ SUPERSEDED-IN-PART(SD-31,2026-07-07)**:auth 后端改迁 **Neon Auth**,edge JWT 验证改对 **Neon Auth JWKS** 本地验签(`NEON_AUTH_JWKS_URL`)。

## §7 风险 / 待确认
- **Neon scale-to-zero 冷启动**:免费 tier 闲置 scale-to-zero,首次请求有冷启动延迟(~几百 ms)。catalog 读路径要容忍(已有 retry)。
- **Neon 0.5 GB/branch 免费限**:catalog 数据量评估(bangumi/points;43 spots seed 很小,全量摄入要算)。超了考虑 Launch plan 或精简。
- **数据迁移一致性**:`pg_dump`/restore 时机(prod 数据搬 Neon)+ 后续 Supabase 仅留 auth(app 表从 Supabase DB 移除或留作历史)。**→ SD-31(2026-07-07)起 auth 亦迁 Neon Auth,Supabase 待集成落地后整体退役**。
- **Hyperdrive + Neon**:确认 Hyperdrive 连 Neon connection string(pooled endpoint)正常(Wave 验证)。
- **后端 `SUPABASE_DB_URL` 命名**:迁 Neon 后 env 名宜改 `DATABASE_URL`(去 Supabase 语义)——但保留兼容别名避免大改。

## §8 不在范围
- ~~全弃 Supabase(连 auth 也迁 Neon Auth)— Neon Auth(Better Auth)还在 Beta;等 GA 稳定再评估,届时是平滑追加。~~ **→ SUPERSEDED-IN-PART(SD-31,2026-07-07)**:此「等 GA」门槛已作废——用户改按 **Better Auth 底座成熟度(v1.4.18)** 提前解冻(原被否的 Stack Auth 底座已换 Better Auth,否决理由过期),auth 迁 **Neon Auth** 已定案;虽仍 Beta,但每个 Neon 分支自带独立 auth 环境的收益 + 部署区已覆盖使其可接受。彻底删 Supabase auth 项目 + 真实用户迁移仍是集成落地后的 future wave。
- 前端代码重写(P4/TanStack)。
