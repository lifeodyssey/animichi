# Neon 数据面 · DBA 能力图（缺什么）

- Status: **ACCEPTED**（owner 2026-08-06 — gap 地图 + 目标按 best practice；**不含实现**）  
- Date: 2026-08-06  
- Scope: **一张 Neon 数据面**（catalog + agent 会话/计量 + users 文档表）+ `neon_auth` 旁路 schema  
- Explicitly out of this doc: **CI `pipeline-*.yml` 布局**（另开讨论，勿与本图混谈）；catalog **ingest 数据 pipeline**（属 catalog 结构）

---

## 0. 一句话

迁移 **作者工具链已经像样**（Atlas 单史、边界清楚、deploy 前 apply）。  
作为 **DBA 运营与权限模型**，还差一整层：**角色矩阵真落地、按服务最小权限连接、可观测、备份/分支治理、扩展与容量、审计**。

现有 issue 信号：**#685**「角色矩阵 — readonly/migration/developer + 服务运行时角色（GRANT 全是装饰）」。

**实施默认：** 按本文 §3 角色矩阵 + §5 切片 **N0→N5** 推进；先 **staging** 再 production；负向权限测为门禁。

---

## 1. 已有（别推倒）

| 能力 | 现状 | 评价 |
|---|---|---|
| **单一迁移史** | `db/migrations` + `atlas.sum`；Drizzle **只 typing** | ✅ monorepo P4 |
| **Auth 迁移隔离** | 新数据表禁止进 `supabase/migrations` | ✅ |
| **Apply 时机** | 应用 **不** 在启动 migrate；deploy 用 Atlas apply | ✅ |
| **Expand/contract 意识** | `docs/ops/migrations.md` 写明 | ✅ 文档有，执行靠人 |
| **角色名存在** | `catalog_svc` / `agent_svc` NOLOGIN + 部分 GRANT | ⚠️ 半成品 |
| **测试分支纪律** | `test-base`、配额、清理 runbook（`neon-test-infra.md`） | ✅ agent 侧较完整 |
| **Worker 连接** | catalog/users：`DATABASE_URL` + neon-http；agent：`SUPABASE_DB_URL`/Neon wire；jobs：`AGENT_DATABASE_URL` | ⚠️ 角色是否真 SET ROLE 未证 |
| **CI** | `atlas migrate validate`；边界测防 drizzle migrate / supabase push | ✅ 静态 |
| **地理/扩展** | PostGIS、pgvector、pg_trgm 等在迁移里 | ✅ 有用到 |

---

## 2. DBA 缺口清单（按优先级）

### P0 — 安全与正确性（没有就不能称「有 DBA」）

| ID | 缺口 | 现状痛点 | 目标 |
|---|---|---|---|
| **D0** | **运行时角色矩阵真生效** | `catalog_svc`/`agent_svc` GRANT 在迁移里，但连接多半是 **超级/owner DSN**，GRANT「装饰」(#685) | 每服务 **专用角色 + 连接串**；禁止 app 用 migration owner 跑业务 |
| **D1** | **`users_svc`（或等价）** | users Worker 写 `routes`/未来 `saved_routes`，GRANT 史偏 agent/catalog | 显式 users 角色：仅用户文档表 CRUD；无 catalog 主数据写 |
| **D2** | **`jobs_svc` / maintenance 角色** | purge 用 `AGENT_DATABASE_URL`，权限边界不清 | 仅 DELETE/SELECT 匿名 retention 所需表；无 DDL |
| **D3** | **migration 角色 vs app 角色** | apply 需要强权限；业务不该同 DSN | `migrator`（或 CI secret）只用于 Atlas；app 永不持有 |
| **D4** | **只读角色** | 无标准 `readonly` / reporter | 人查 staging、BI、紧急读：SELECT only + 可选 statement timeout |
| **D5** | **`neon_auth` 与 `public` 隔离** | deploy 已 `search_path=public`；策略未成文矩阵 | 文档 + 角色：业务角色 **无** auth schema 写；auth 只给 Neon Auth |

### P1 — 运营与变更安全

| ID | 缺口 | 目标 |
|---|---|---|
| **D6** | **环境拓扑图** | main / staging / test-base / dev/* / preview 的 **parent、用途、谁可写、保留策略** 一张表（现散落 runbook） |
| **D7** | **Branch 配额与命名 SLA** | 已有 10 分支意识；缺：自动 GC 策略、preview 过期、禁止在 main 上做实验 |
| **D8** | **迁移 apply 可观测** | apply 后强制记录：branch id、atlas status、revision、操作者；PR 模板勾选 |
| **D9** | **锁与在线 DDL 规范** | 大表/索引：CONCURRENTLY、超时、扩缩容窗口；禁止「大迁移默默上」 |
| **D10** | **回滚叙事** | 已写「Worker 回滚不回滚 DB」；缺：forward-fix 清单、坏迁移热修流程 |

### P2 — 性能与容量

| ID | 缺口 | 目标 |
|---|---|---|
| **D11** | **连接模型** | neon-http vs pooler vs direct：每服务选哪种、上限、冷启动 | 成文 + 与 CF Worker 约束一致 |
| **D12** | **慢查询 / 指标** | 无统一 pg_stat / Neon 监控告警 | 至少 staging：慢查询阈值 + 磁盘/计算告警 |
| **D13** | **索引与 explain 门禁** | 新热点路径无强制 explain | 大查询迁移附 before/after 或 ticket AC |
| **D14** | **Scale-to-zero / 计算大小** | 环境各自 endpoint 规格未在 repo 钉死 | infra/文档：staging vs prod 规格 |

### P3 — 合规、备份、审计

| ID | 缺口 | 目标 |
|---|---|---|
| **D15** | **备份 / PITR 意识** | 靠 Neon 平台默认；缺 RPO/RTO 与恢复演练 | 成文 + 年/季演练勾选 |
| **D16** | **数据分级** | 匿名 session、GPS check-in、BYOK 相关 | 哪些可进 log、保留多久（与 jobs purge 对齐） |
| **D17** | **RLS** | init **去掉** RLS（服务角色路径） | 是否用 Neon RLS 作纵深：默认 **应用层权威**；RLS 可选 defense-in-depth（users 已文档化） |
| **D18** | **审计 DDL** | 谁在 console 手改 | 禁止生产 console DDL；仅 Atlas；破例要 issue |

### P4 — 仓库与目录（和 monorepo 对齐）

| ID | 缺口 | 目标 |
|---|---|---|
| **D19** | **`db/` → `migrations/neon/`** | 目标树已写，未搬 | 一次 `git mv` + CI path + AGENTS |
| **D20** | **`migrations/CONTEXT.md` / DBA runbook 入口** | 知识散在 ops 多文件 | 单页 **DBA index** 链到 migrations / neon-test / secrets |
| **D21** | **表归属注释** | 同库多 BC | 每表 owner 服务：catalog / agent / users / jobs-read；防乱 GRANT |

---

## 3. 目标角色矩阵（草案 · 对齐 #685）

| 角色 | 用途 | 权限概要 |
|---|---|---|
| **migrator** | Atlas apply only | DDL + 必要 DML（seed）；**不进** Worker secret |
| **catalog_svc** | catalog Worker | catalog 主数据读写；ingest 表；**无** users 文档写 |
| **agent_svc** | agent 容器 | sessions/conversations/messages/quota/usage 等；**catalog 只读**（若仍直连；目标应经 API） |
| **users_svc** | users Worker | `saved_routes` / shares / checkins；**无** catalog 写 |
| **jobs_svc** | jobs Worker | purge 所需 SELECT/DELETE；最小表集合 |
| **readonly** | 人 / 报表 | SELECT；statement_timeout；可无敏感列视图 |

**连接：** Neon 上 LOGIN 角色或 pooler user → `SET ROLE` / 直接 login 为 svc。  
**验收：** 用 catalog DSN 写 `saved_routes` 必须失败；用 users DSN 写 `points` 必须失败。

---

## 4. 与「结构重构列车」的关系

| 列车 | Neon DBA |
|---|---|
| Greenfield 表 rename（`routes`→`saved_routes`，`work_id`→`bangumi_id`） | **迁移 PR** + GRANT 更新 + jobs SQL |
| Catalog/Agent/Users 代码结构 | 不替代角色矩阵 |
| CI pipeline 文件个数 | 正交；`pipeline-db` 只是 validate，不是 DBA 运营 |

**不要** 把 DBA 工作塞进 feature story 顺手做完；**D0–D5** 应有独立 ticket/史诗。

---

## 5. 交付切片（ACCEPTED 顺序 · best practice）

| 切片 | 内容 | 验收（可开票） |
|---|---|---|
| **N0** | 本文 ACCEPTED；#685 链到本图 | 文档 + issue 互链 |
| **N1** | 角色矩阵 SQL：`migrator` / `catalog_svc` / `agent_svc` / `users_svc` / `jobs_svc` / `readonly`；GRANT 按表归属（D21）；**staging** 各服务换最小权限 DSN | staging：catalog 不能写 users 表；users 不能写 points；jobs 无 DDL；Atlas 仍仅 migrator |
| **N2** | 生产同 N1 + 负向权限测进 CI 或 runbook 勾选 | 生产 DSN 矩阵与 secrets 文档一致；无 app 持 migrator |
| **N3** | 环境拓扑 + branch SLA 单页（D6–D7） | main/staging/test-base/dev/preview 表可读 |
| **N4** | `db/` → `migrations/neon/`（D19）+ CI path | monorepo 目标树一致 |
| **N5** | 监控/备份/RPO（D12/D15）+ 坏迁移剧本（D10） | 成文 + 至少一条告警或演练勾选 |

**与 greenfield 表 rename：** `saved_routes` / `bangumi_id` 等迁移 **必须** 同步改 GRANT（N1 矩阵）与 jobs SQL；可与代码 greenfield 同波或紧前。

---

## 6. 明确非目标（本图）

- 换掉 Neon / 上第二套 OLTP  
- 用 Drizzle 生成迁移  
- 在 Agent 启动时 migrate  
- 把 catalog **ingest 业务 pipeline** 画进本 DBA 图（属 catalog）  

---

## 7. 你现在「还差很多」——浓缩版

若只记五条：

1. **GRANT 装饰 → 真·最小权限连接**  
2. **users / jobs 独立角色**  
3. **migrator 与 app DSN 分离**  
4. **环境/分支/拓扑一张图**  
5. **备份、监控、坏迁移剧本**  

迁移文件本身 **不是** 短板；**权限与运营** 才是。

---

## 8. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：Neon DBA 已有/缺口/角色矩阵草案/切片 |
| 2026-08-06 | Owner **ACCEPTED** best-practice 路径；CI pipeline 布局 **明确另议**；N0–N5 验收可开票 |
