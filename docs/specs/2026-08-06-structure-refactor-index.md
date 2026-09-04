# 结构重构索引（三包 only）

- Status: **五包结构 ACCEPTED**；jobs（原 maintenance）**RETIRED (#1316)**——空壳从未落地
- Date: 2026-08-06
- Workflow (three packages): `.grok/workflows/structure-design-three-packages.rhai`
- Parent: greenfield · monorepo-target-layout

---

## 0. 范围

| 包 | 状态 |
|---|---|
| catalog · agent · users | ACCEPTED |
| edge · web | ACCEPTED（无巡礼 domain） |
| **jobs**（原 maintenance） | **RETIRED (#1316)** — 空壳从未落地 |

**Domain model 用法：**

| 包 | 巡礼 DDD `domain/` |
|---|---|
| catalog / agent | **有** |
| users | **浅** |
| edge / web | **无** |
| **jobs** | **无** — Job + Schedule only |

---

## 1. 结构设计一览

| 包 | 结构设计 | PR 切片（摘要） |
|---|---|---|
| Catalog | [catalog-structure…](./2026-08-06-catalog-structure-refactor-design.md) **ACCEPTED** | S0–S8 |
| Agent | [agent-structure…](./2026-08-06-agent-structure-refactor-design.md) **ACCEPTED** | S0–S7 |
| Users | [users-structure…](./2026-08-06-users-structure-refactor-design.md) **ACCEPTED** | U-S1–S5 |
| Edge | [edge-gateway-structure…](./2026-08-06-edge-gateway-structure-design.md) **ACCEPTED** | E1–E5 package-ize + src 关切分包 |
| Web | [web-ui-structure…](./2026-08-06-web-ui-structure-design.md) **ACCEPTED** | W1–W6 routes≈pages + features + platform |
| **Jobs** | **RETIRED (#1316)** — 结构设计稿随空壳一并删除 | — |

---

## 2. 跨包顺序建议（仍仅三包）

1. **Contract 语言**（Point / Itinerary / SavedRoute / bangumi_id）— 三包消费，宜先或与 Catalog S1 / Users U-S5 同波。
2. **Catalog** 纯 domain 抽出（S2）与 **Agent** 删双写/双读（S1–S2）可并行（不同树）。
3. **Users** U-S1–S4 小，可与上并行。
4. 竖切（Catalog S3+、Agent S3+）按包内依赖推进；测绿再合。

**不做：** 为 edge/web 开结构切片，直到单独讨论。

---

## 3. 共同 pattern 纪律（三包）

| 用 | 不用 |
|---|---|
| Use case 函数 / 薄 application | 空 domain entity、演示用 OOP 树 |
| 窄 Port（Protocol / 结构类型） | God `Db` / 万能 container |
| 纯 domain 函数（尤其 itinerary/cluster） | Domain 进 Hono / PydanticAI |
| 删死路径优先 | 长期兼容 re-export 双名 |

---

## 4. 相对「之前缺什么」

此前只有 CA 目标树与分期口号。
现已补齐：**实盘 inventory · from→to · smell 证据路径 · pattern 取舍 · 按包 PR 切片**。
仍缺：**你拍板切片优先级**、以及 **edge/web 是否同一套规则**（未讨论）。

---

## 5. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 三包 structure design 由 subagent 产出；本索引锁定范围 |
| 2026-08-06 | Owner ACCEPTED 三包结构（best practice）；实现按各包切片；edge/web 另议 |
| 2026-08-06 | Edge Gateway + Web UI 结构文（一次到位、**无**巡礼 domain）；待确认 |
| 2026-08-06 | Edge/Web **ACCEPTED**；Maintenance Thin 结构稿 |
| 2026-08-06 | **maintenance → jobs** 包名与 `src/jobs/`；结构 ACCEPTED |
