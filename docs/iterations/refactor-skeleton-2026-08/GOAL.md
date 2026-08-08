# GOAL — Monorepo 骨架重构（全波次 · 编排锁定）

**正式 spec：** https://github.com/lifeodyssey/animichi/issues/829  
**本文件：** 战役关账板 + **全波次计划** + 编排/合 PR 闸；与 #829 冲突时以本文件最新波次表为准并回写 #829 评论。  
**工作目录：** `~/work/animichi`

**Matt 流（已完成 → 执行中）：**  
grill ✅ → to-spec ✅ #829 → to-tickets ✅ → **implement 全波次** → **每 PR `/code-review`** → **两路 PR 评论闸** → merge → 本文件勾选

### 如何用 `/goal` 驱动本文件

本文件是**战役合同**；`/goal` 是**让 agent 一直干到完成条件成立**的开关。用法：

1. **工作目录**切到 `~/work/animichi`（或 monorepo 根）。  
2. 开新会话或当前会话发（Grok Build）：

```text
/goal 执行 docs/iterations/refactor-skeleton-2026-08/GOAL.md：从 W0 起按波次推进；一票一 worktree 一 PR；写码可用 opencode-go 或 subagent；每 PR 必经 Matt code-review（Standards∥Spec，base=origin/main）+ 两路 PR 评论闸（行级 threads 全处理 + 顶层 qodo/Sonar 判定 + 顶层「线程判定」）后才 merge；live≤6；HITL 波（W2 密钥、W6–W8）停住人确认；完成条件=本文件 W0–W8 与 §4 验收勾选齐（W7/W8 可显式 WONT 并写进变更日志）
```

3. **只开一波**（更稳）：

```text
/goal 只做 GOAL W0：合完 #833 #830 #859 并勾选 W0；纪律同 GOAL §1.2–1.3
```

4. 查询 / 暂停 / 取消（Grok）：`/goal status` · `/goal pause` · `/goal resume` · `/goal clear`  

5. **没有 `/goal` 时**直接说同一段自然语言即可（「按 GOAL 从 W0 开干」）。  

6. Claude Code 若用 planning-with-files：可先把本 GOAL 链进 plan，再 `/plan-goal` 或 `/goal <同上完成条件>`。

**完成条件（agent 自证用）：**  
`GOAL.md` 中 W0–W6 的「W? 完成」为 `[x]`（W7/W8 完成或变更日志写明延期）；每个已合 PR 有 code-review 记录与「线程判定」类 ACK；`gh pr list --state open` 无本战役遗留阻塞 PR。

---

## 一句话

只重构：目录/边界/竖切/配置/CI 骨架/DB 角色与迁移史/可选 rename；未完成 `TODO(refactor-skeleton)`；**无新产品功能**。  
执行能快则快；写码 **opencode-go 与 subagent 均可**；**合 PR 前 Matt review + 全部 PR 评论处理完**。

---

## 0. 非目标（违反即 scope creep）

- [ ] 无 Share / Check-in / しおり / 新 API 行为（仅 TODO 指针）
- [ ] edge / web / jobs / infra **无** 巡礼空 `domain/`
- [ ] **不** 改 branch protection **required check 名**
- [ ] **不** 在自动波次做 production DSN 切换（→ W7 HITL）
- [ ] **不** 放宽 coverage / typecheck / 1-10-50 / `--deny-warnings`
- [ ] **不** 在未完成评论闸时 `gh pr merge`（hook 也会拦）

**TODO 约定：** `// TODO(refactor-skeleton): <what> — see #<issue>|GOAL§`

---

## 1. 编排锁定

### 1.1 单元

| 单元 | 规则 |
|---|---|
| 票 | 一 GitHub issue = 一 worktree = **一 PR**（不大杂烩） |
| 实现 | Matt **`/implement`** 语义（tdd 优先、包门禁、再提交） |
| 写码执行器 | **opencode-go** 与/或 **Grok subagent** 均可；**同一 worktree 同时只有一个写者** |
| Track lead | 可 subagent / 主会话：写 brief → 派执行器 → GATE → 开 PR → review → 评论闸 → merge |
| 并行 | 同波次内无依赖的票可并行；**live ≤ 6**；opencode 仅 **一个 serve** |
| 关账 | 本文件波次勾选 + PR URL 证据 + 票 CLOSED |

### 1.2 单 PR 生命周期（强制顺序）

```text
1. worktree from origin/main + brief（票 AC 全文）
2. implement（opencode 和/或 subagent）
3. GATE：相关包 typecheck/lint/test（覆盖本 PR 改动路径）
4. commit + push + gh pr create（body：Closes #票 · Parent #829）
5. ★ Matt /code-review
     - fixed point: origin/main（三点 diff / merge-base）
     - Spec 轴：本票 body + 本 GOAL 对应波次
     - Standards 轴：AGENTS.md · 1-10-50 · 无 Any · 包 AGENTS · Fowler smell 基线
     - 阻塞 findings → FIX → 回 3–5 再 review
6. CI 全绿
7. ★ 两路 PR 评论闸（见 §1.3）— 全部完成才可 merge
8. gh pr merge（rebase-only；过全局 hook）
9. 本 GOAL 对应项 [x] + 证据 PR 号
```

### 1.3 两路 PR 评论闸（owner rule · 合前必做）

与 `AGENTS.md` + `~/.claude/hooks/check-pr-comments.sh` 一致。**只查一路 = 禁止合并。**

| 载体 | 查法 | 必须 |
|---|---|---|
| **行级 review threads** | GraphQL `reviewThreads(isResolved:false)` | 逐条读完：真问题→修；误报/已过时→**线程内 inline 回复理由**再 resolve |
| **顶层 issue comments** | `gh pr view <n> --json comments` | qodo Code Review 汇总（Bugs / Rule violations）、SonarCloud Quality Gate、codecov 等；非零 Bugs/violations 或 QG Failed → 修或书面判定 |

**放行条件（全部满足）：**

1. 未解决线程 = 0  
2. 顶层无未处理的阻塞 bot findings（或已在 maintainer 评论中判定）  
3. 顶层有一条 **OWNER/MEMBER/COLLABORATOR** 评论，含 **`线程判定`** 或 **`findings triaged`** 字样（hook ACK）  
4. Matt `/code-review` 双轴无未处理阻塞项（报告可贴 PR 或 lead 日志）  
5. `gh pr checks` 全绿  

**顺序：** inline 回复线程 → resolve → **最后** 发顶层「线程判定」→ 再 merge（避免 bot 刷新时间戳顶掉判定）。

**责任：** 编排 / lead **必须关注该 PR 全部 comments**（行级 + 顶层）；未 triage 不得合。

### 1.4 执行器选择（能快则快）

| 类型 | 优先 |
|---|---|
| 纯文档 / PATH-DELTA / N3 | subagent 或 opencode，**谁快用谁** |
| 包内竖切 / 重构代码 | 两者均可；厚逻辑可 opencode-go |
| CI YAML / 敏感路径 | 执行后 lead **逐行** diff；GATE 必须盖到改动包 |
| 需 Neon/staging 真密钥 / prod / force 历史 | **HITL**，不自动 merge |

---

## 2. 已锁定产品/结构决策（grill 摘要）

| 主题 | 决策 |
|---|---|
| Catalog 竖切 | PlanItinerary |
| Agent | CatalogReadGateway → HandleUserMessage |
| Users | 纯规则 → SavedRouteRepo；Share/Check-in TODO |
| 搬家 | Train 路径与竖切分 PR；尽量 git mv |
| Greenfield 名 | 竖切路径可用新名；全量 rename = W5 |
| CI | `actions/` 文件夹 composite；1–2 pipeline 样板；不改 required check **名** |
| ROLE/GRANT | Atlas；RLS 本波不作授权主路径 |
| Runtime DSN | 密钥面；staging = W2；prod = W7 HITL |
| Migration 史 squash | W6 HITL epic #845 |
| Git 日折叠 | W8 最后；#851 |

---

## 3. 全波次计划（按序；波内可并行）

状态：`[ ]` 未开 · 进行中写 PR · `[x]` 波次关（该波所有票合且评论闸过）

---

### W0 — 地图与文档基线（可立即并行）

**目标：** 导航真相与表归属文档，不堵代码轨。

| 票 | 内容 | 依赖 |
|---|---|---|
| #833 | SK-0 PATH-DELTA + CONTEXT-MAP | — |
| #830 | DB-1 表归属 + 角色矩阵文档 | — |
| #859 | N3 Neon 环境拓扑一页纸 | — |

**关波：** 三票 CLOSED + 文档在 main。

- [x] **W0 完成** — #861 PATH-DELTA (#833) · #862 DB-1 (#830) · #863 N3+security (#859); merged 2026-08-06

---

### W1 — 薄代码轨并行（needs W0 的仅 jobs/edge 配置可后置）

**目标：** 无互依赖或仅弱依赖的竖切骨架同时推进。

| 轨 | 票序 | 依赖 |
|---|---|---|
| Users | #834 → #835 | — |
| Catalog | #837 → #838 | 建议 #833 已合（可弱依赖并行） |
| Agent | #839 → #840 | 建议 #833 |
| Jobs | #836 | #833 |
| Edge | #841 | #833 |
| Web | #842 | #833 |
| Infra | #843 | #833 |
| CI 样板 | #844 | #833 |
| 工具 | #857 GH-1 日折叠 dry-run 脚本 | — |

**关波：** 上表票均合；GOAL §B/C 相关项可勾。

- [x] **W1 完成** — #866 Users 规则 (#834) · #873 SavedRouteRepo (#835) · #864 Catalog CA (#837) · #874 PlanItinerary (#838) · #865 Agent gateway (#839) · #875 HandleUserMessage (#840) · #869 Jobs (#836) · #867 Edge (#841) · #872 Web (#842) · #868 CI (#844) · #871 GH-1 (#857); merged 2026-08-07

---

### W2 — DB 角色落地 staging（串行）

| 票 | 内容 | 依赖 |
|---|---|---|
| #831 | DB-2 Atlas ROLE+GRANT 迁移 | #830 |
| #832 | DB-3 staging apply + 最小权限 DSN | #831；**密钥部分 HITL** |

**关波：** 迁移在 staging apply；DSN 接线完成或缺口写清 TODO；#832 评论闸 + 人确认密钥。

- [ ] **W2 完成**

---

### W3 — 配置下沉与文档卫生

| 票 | 内容 | 依赖 |
|---|---|---|
| #853 | SK-P1 Dockerfile / edge package-ize 收尾 | #833 · 宜 #841 |
| #856 | HY-1 文档/根卫生 | #833；宜 W1 大路径稳后 |
| #860 | N5 备份/监控/RPO stub | —（doc）；告警 HITL 可选 |

- [x] **W3 完成** — #880 配置下沉 (#853) · #877 HY-1 文档卫生 (#856) · #878 N5 备份/RPO (#860); merged 2026-08-07

---

### W4 — Greenfield 全量 rename（wide · expand–contract）

| 票 | 内容 | 依赖 |
|---|---|---|
| #852 | SK-G1 routes→saved_routes · work_id→bangumi_id 等 | 宜 #831 · #835 · #838；与 W6 二选一协调 |

**关波：** 合同+Workers+agent 新名；迁移+GRANT；测绿。

- [x] **W4 完成** — #881 spike 计划 (#852) · #890 users rename (#852) · #891 catalog rename (#852) · #892 agent language (#852) · #894 docs closeout (#852); merged 2026-08-08

---

### W5 — migrations 目录搬家（N4）

| 票 | 内容 | 依赖 |
|---|---|---|
| #854 | SK-M1 `db/migrations` → `migrations/neon` + CI | 宜 **W6 后** 搬短链，或 W6 前搬（冻结选一侧） |

- [x] **W5 完成** — #893 migrations 搬家 (#854); merged 2026-08-08

---

### W6 — Atlas 历史 squash + gazetteer 出链（HITL 重）

| 票 | 内容 | 依赖 |
|---|---|---|
| #846 | MS-1 baseline spike | #845 决策 D1–D6 |
| #847 | MS-2 gazetteer seed 路径 | 可与 #846 并行 |
| #848 | MS-3 staging 彩排 | #846 · #847 · owner D1 |
| #850 | MS-5 替换 main 链 | #848 |
| #849 | MS-4 prod soft baseline | #848 · owner 窗口 |

Epic：#845。**不** force-push git 历史（那是 W8）。

- [ ] **W6 完成**

---

### W7 — 生产权限（HITL）

| 票 | 内容 | 依赖 |
|---|---|---|
| #855 | DB-N2 prod 最小权限 DSN | #832 稳 |

- [ ] **W7 完成**（或显式 WONT 留到下战役）

---

### W8 — Git 日折叠（最后 · 冻结 main）

| 票 | 内容 | 依赖 |
|---|---|---|
| #857 | GH-1 dry-run 脚本 | —（可 W1 已做） |
| #858 | GH-2 执行 runbook + 备份 + swap/force-with-lease | #857 · **W0–W6 大波结束或显式冻结** |
| #851 | Epic 关账 | #858 |

**关波：** tip tree 不变；~1 commit/天；`main-legacy` 保留 ≥30 天。

- [ ] **W8 完成**

---

## 4. 验收勾选（与波次对应 · 关战役用）

### A. 仓骨架 — W0 · W3

- [x] PATH-DELTA 覆盖目标树 (#861)
- [x] CONTEXT-MAP / 包 CONTEXT 与有无 domain 一致 (#861)
- [x] 配置 owner-local（#880）

### B. 业务包 — W1

- [x] Catalog CA + PlanItinerary（#864 · #874）
- [x] Agent gateway + HandleUserMessage（#865 · #875）
- [x] Users 规则 + SavedRouteRepo；产品 TODO（#866 · #873）

### C. Edge / Web / Jobs — W1

- [x] 无巡礼 domain；测绿（#867 · #872 · #869）

### D. Infra / CI — W1 · W3

- [x] Infra 分段（#876）
- [x] package-ci 文件夹 + 1–2 pipeline；required check **名**不变（#868）

### E. Neon / 角色 — W0 · W2 · W6 · W7

- [x] 归属文档（#862）
- [x] staging 角色+DSN（#870 迁移已合；#832 staging apply+DSN 剩余）
- [ ] （可选）migration 史干净 + gazetteer 外置（#847 进行中）
- [ ] （可选）prod DSN

### F. 历史 — W8

- [ ] git 日折叠完成或显式延期

### G. 质量与合 PR 纪律（**每个 PR**）

- [ ] 包门禁绿
- [ ] 无用户可见 API 行为变更
- [ ] 1-10-50 破线不增
- [ ] **Matt `/code-review` 双轴通过**
- [ ] **两路 PR 评论闸完成 + 顶层「线程判定」**

---

## 5. 票板索引（全）

| Issue | 波次 | 标题摘要 |
|---|---|---|
| #829 | — | Spec 父票 |
| #833 | W0 | SK-0 PATH-DELTA |
| #830 | W0 | DB-1 归属文档 |
| #859 | W0 | N3 拓扑 |
| #834–#835 | W1 | Users |
| #837–#838 | W1 | Catalog |
| #839–#840 | W1 | Agent |
| #836 | W1 | Jobs |
| #841–#844 | W1 | Edge/Web/Infra/CI |
| #857 | W1/W8 | GH-1 脚本 |
| #831–#832 | W2 | DB 角色 staging |
| #853 #856 #860 | W3 | 配置/卫生/N5 |
| #852 | W4 | Greenfield rename |
| #854 | W5 | migrations/neon |
| #845–#850 | W6 | Atlas squash |
| #855 | W7 | Prod DSN |
| #851 #858 | W8 | Git 日折叠 |

---

## 6. 默认并行节奏（能快则快）

```text
现在：     W0 三票并行 + W1 多轨并行（live≤6）+ #857
W0∪W1 后： W2 串行（#831→#832）
           W3 并行
W2 后：    W4 或 W6（owner 选 rename 与 baseline 谁先；避免双改迁移史）
W6 后：    W5 搬家（若未提前）
           W7 HITL
全部代码波结束后冻结：W8
```

**每 PR 不加速项：** Matt code-review + 两路评论闸（不可跳）。

---

## 7. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿 GOAL |
| 2026-08-06 | #829 镜像勾选板 |
| 2026-08-06 | **全波次 W0–W8**；编排锁定；双执行器；**Matt code-review 强制**；**两路 PR 评论闸（线程判定）** 写入 GOAL |
| 2026-08-07 | **W1/W3 关账回写** + #884/#885/#886/#876 合入 |
| 2026-08-08 | **W4/W5 关账**（rename 三切片 + migrations 搬家） |
