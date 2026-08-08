# Jobs Worker 结构（原 maintenance · 定时任务 · 无巡礼 domain）

- Status: **ACCEPTED**（owner 2026-08-06 — 包名 **`workers/jobs`**；内部分 **jobs/**）
- Date: 2026-08-06
- **Package (target):** `workers/jobs`
- **Package (today):** `workers/maintenance` → 实现时 `git mv` 改名
- Tier: **Thin** · scheduled-only · **无 HTTP**
- Supersedes naming: `2026-08-06-maintenance-thin-structure-design.md`（见文末）

---

## 0. 为什么不叫 maintenance / 为何选 jobs

| 名 | 评价 |
|---|---|
| **maintenance** | 像「运维杂项」，看不出跑什么 |
| **scheduler** | 像平台调度器 / 编排；和 CF `scheduled`、各类 agent scheduler 易混 |
| **`jobs`** | **推荐**：包内就是一条条 **job**；cron 只是触发器 |

**LOCKED：** 目标包名 **`workers/jobs`**（pnpm name / wrangler name 同步，如 `animichi-jobs` 或 `jobs`）。
对外说明：Cloudflare **Scheduled Worker** that runs retention **jobs**.

---

## 1. Domain model？

**无巡礼 `domain/`。** 只有：

- **Job** = 一次可调度的工作单元（输入：clock + db；输出：report/log）
- **Schedule** = cron 表达式 → 选哪个 job

Session 表权威仍在 **Agent**；本包是 **执行删除的定时作业**。

---

## 2. 职责（不变，只改名）

| Job | Cron（保持字节一致） | 作用 |
|---|---|---|
| `purge-anonymous-sessions` | `37 18 * * *` | 过期匿名会话（无关联 saved_route） |
| `purge-anon-quota` | `37 19 * * *` | 过期 `anon_daily_message_count` |

- Secret：`AGENT_DATABASE_URL`
- 不碰 Catalog；不删 Users 已归属文档
- SQL 谓词与历史 Python port 对齐；表 rename 同波

---

## 3. 目标树（一次最好）

```text
workers/jobs/                    # 原 workers/maintenance
  package.json                   # name: "jobs"（或 @animichi/jobs）
  wrangler.toml                  # name = "jobs" / "jobs-staging"
  AGENTS.md
  CONTEXT.md
  src/
    index.ts                     # scheduled export；组装 only
    database.ts                  # DatabaseClient + neon 工厂
    schedule.ts                  # CRON 常量 + dispatch(cron) → job
    jobs/
      cutoff.ts                  # retentionCutoff / quotaCutoff 纯函数
      purge-anonymous-sessions.ts
      purge-anon-quota.ts
      types.ts                   # PurgeReport 等
  test/
    jobs/
    schedule.worker.test.ts
    …
```

**今日 → 目标**

| 今日 `workers/maintenance` | 目标 `workers/jobs` |
|---|---|
| 包目录 maintenance | **`jobs`** |
| `src/purge.ts`（双 job） | `src/jobs/purge-*.ts` + `cutoff.ts` |
| `src/index.ts` 内 cron 字符串 | `src/schedule.ts`（与 wrangler 双写注释钉死） |
| `src/database.ts` | 同路径语义 |
| wrangler `name = "maintenance"` | **`jobs`** / `jobs-staging` |
| CI paths `workers/maintenance` | `workers/jobs` |
| 根 AGENTS / CONTEXT-MAP 表述 | maintenance → **jobs** |

---

## 4. Pattern

| 用 | 不用 |
|---|---|
| **Job module**（一文件一作业） | 巡礼 domain / use case 深树 |
| **Schedule dispatch** | HTTP router |
| **Injected clock + DatabaseClient** | 散落 `new Date()` 难测 |
| 作业名 = 文件名 = 日志 event 前缀 | 模糊 `maintenance_run` |

---

## 5. PR 切片

| 切片 | 内容 |
|---|---|
| **J0** | 本文 ACCEPTED；文档全局 `maintenance`→`jobs` 用语 |
| **J1** | `git mv workers/maintenance workers/jobs`；package/wrangler/CI/filter 改名；测绿 |
| **J2** | 拆 `src/jobs/*` + `schedule.ts`；删上帝 `purge.ts` |
| **J3** | Greenfield：SQL `routes`→`saved_routes`（与 users 表 rename **同波**） |
| **J4** | Agent Python `purge_*.py` deprecate/删除；只认 jobs Worker |

**一次最好：** J1+J2 可合并；**J3 不可与 users rename 脱节**。

---

## 6. 与邻包

| 邻居 | 关系 |
|---|---|
| Agent | 表/匿名语义权威；jobs 执行 purge |
| Users | EXISTS 哨兵表 `saved_routes`（原 `routes`） |
| Edge | 无公网路径 |
| Catalog | 无 |

---

## 7. 验收

- [ ] 仓库路径为 `workers/jobs`
- [ ] 无 `workers/maintenance`（或仅 re-export 过渡 **零** 终态）
- [ ] `src/jobs/` 下每 job 可单测
- [ ] wrangler crons 与 `schedule.ts` 一致
- [ ] 无 `domain/`、无 public fetch

---

## 8. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 由 maintenance Thin 稿更名：**包 `workers/jobs`** + 内部分 `jobs/`；弃用 scheduler 作包名 |
