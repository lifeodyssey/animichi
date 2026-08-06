# Agent 教科书式 DDD + Clean Architecture 设计

- Status: **ACCEPTED** — owner 确认 2026-08-06；**设计锁定，不含实现**
- Date: 2026-08-06
- Package: `apps/agent`（Python / PydanticAI / FastAPI 容器）
- Language: ADR-0002 · `CONTEXT-MAP.md` · `apps/agent/CONTEXT.md`
- Sibling: [Catalog 设计（已 ACCEPTED）](./2026-08-06-catalog-clean-architecture-design.md)
- Parent: `docs/superpowers/specs/2026-08-06-monorepo-target-layout.md`
- Accepted: A1–A5（含 §0.1 只读校准 / X12·G4 A3）
- Greenfield: `2026-08-06-greenfield-language-and-data-plane.md`（语言/契约/删直连写 **一次最佳**）
- Refactor train: **已有代码** 真·结构重构（移文件/抽 use case/化简/SOLID），**不止 rename**；未写产品能力归既有 ticket

---

## 0. 目标

在 **已有** `domain/` · `application/` · `infrastructure/` · `interfaces/` · `agents/` 骨架上，收敛成教科书依赖方向与清晰用例边界，使：

1. **Session** 与工具循环的领域规则可单测、不绑 FastAPI  
2. **Catalog** 访问只经明确 port（客户–供应商）——对齐 **X12 / G4**  
3. **SavedRoute / 身份** 不在 Agent 内重建  
4. 与 monorepo Full tier、ADR-0002 **greenfield 语言**一致（Point / Itinerary / Session）  

**非目标：** 本文阶段直接改生产代码；重写 PydanticAI。  
**已否决：** 长期保留 Python `Route` / `PilgrimagePoint` 镜像旧名。

### 0.1 「只读」校准（对齐早期定案，避免误解）

| 层 | 是否只读 | 权威来源 |
|---|---|---|
| **Catalog 主数据**（Point / Bangumi / Itinerary 算法与结果） | **只读客户** | X12 去数据化；`apps/agent/AGENTS.md`；ingest 归 catalog |
| **Agent 会话 / 编排**（Session、messages、fact ledger、anon quota 等） | **可写** | G4：agent 只保留 session/orchestration state |
| **用户域**（SavedRoute、打卡、しおり） | **不新增 agent 数据端点** | G4 / SD-2 → `workers/users` |
| **LLM tools 副作用** | **工具面只读**（无写 catalog/用户主数据） | SD-19 架构不变量 |

一句话：**对 catalog 主数据只读；对 Session/编排可写；禁止往 agent 服务新增数据端点。**  
「全服务零写库」**不是**目标。

---

## 1. 现状诊断

### 1.1 今日目录（概要）

```text
apps/agent/src/animichi/
  domain/           # entities, ports, fact_ledger, errors, …
  application/      # 偏薄
  infrastructure/   # gateways, session, supabase, observability
  interfaces/       # FastAPI, persistence, chat_wire, routes
  agents/           # runner, tools, catalog_adapter, handlers
  clients/ tools/ config/ utils/ scripts/ tests/
```

### 1.2 已有正确碎片

| 碎片 | 评价 |
|---|---|
| `domain/ports.py` Protocol | 出站 port 形状已有 |
| `domain/entities.py` | Point/Bangumi 等存在；**Route → Itinerary 改名**（greenfield） |
| `domain/fact_ledger.py` | Session 内硬约束记忆 — 真 domain |
| interfaces 与 infrastructure 分离意识 | 接近 CA |
| catalog 只读客户 | BC 关系正确 |

### 1.3 差距

| 期望 | 现状 |
|---|---|
| agents/ 是 application 还是 framework？ | **混杂**：编排 + PydanticAI + catalog 适配 |
| application 用例清晰列表 | **偏薄**；主路径在 `animichi_runner` / tools |
| domain 不依赖基础设施 | 大体如此，但 entities 命名与 ADR-0002 未对齐 |
| 单一「对话用例」入口 | 分散在 public_api / routes / runner |

**结论：** 比 catalog **更接近** 分层命名，但仍需 **教科书式收紧依赖与用例**，不是从零 mkdir。

---

## 2. 领域模型（Agent BC）

### 2.1 语言（LOCKED 跨包 + 本包）

| 词 | 含义 |
|---|---|
| **Session** | 一次用户–agent 对话与工具状态（可匿名、可 claim） |
| **Point / Bangumi / Itinerary** | 与 Catalog 同义；Agent **不拥有**主数据，只消费 |
| **SavedRoute** | Users 拥有；Agent 至多触发/引用 |
| **Fact ledger / hard constraint** | Session 内必须保留的用户约束（如 pacing） |
| **Tool turn** | 一次模型–工具交互步（实现细节可留 agents，概念上属 application） |

### 2.2 拥有 / 不拥有

| 拥有 | 不拥有 |
|---|---|
| Session 生命周期与状态机语义 | Point/Bangumi 主数据 |
| **Conversation / 消息 / 会话内 memory**（写权威；见 Users §2.1.1） | **Users.listSessions 投影的「产品列表面」**（可挂 Users，数据仍本 BC） |
| 对话策略、工具选择边界、compaction 保留规则 | Itinerary **算法**（Catalog 算） |
| 对 Catalog/Users/LLM 的 **调用意图** | JWT 签发、Edge 限流 |
| 匿名配额计数语义（与 maintenance 清理对象对齐） | SavedRoute 持久化权威；跨会话 `user_memory`（唤醒后归 Users） |

### 2.3 不变量（草案，确认后 LOCK）

1. Session 有稳定 id；匿名 Session 可被 claim 到用户，不能无主合并丢约束。  
2. 硬约束进入 fact ledger 后，compaction 不得静默丢弃。  
3. Agent **不**在本地「发明」与 Catalog 冲突的 Point 几何权威；**不写** catalog 主数据表。  
4. 需要 Itinerary 时，经 Catalog port，不在 Agent 内复制规划 kernel（SD-28 已统一到 catalog）。  
5. 对外 HTTP 错误经 registry 映射，不把领域异常直接当 500 文本泄漏。  
6. **X12 / G4：** 不往 agent 服务新增任何 **数据端点**（catalog 域或用户域）；新能力问归属桶（catalog / users / session-only）。  
7. **SD-19：** 面向模型的 tools 默认只读副作用；写 Session/配额走应用层与 port，不经「工具随便写库」。

---

## 3. Clean Architecture 圈层

```text
FastAPI · PydanticAI · asyncpg/Neon · HTTP clients · Logfire
        ▲
interfaces/ (inbound HTTP, wire) + infrastructure/ (outbound impls)
        ▲
application/  (use cases: HandleUserMessage, …)
        ▲
domain/       (Session rules, entities, port *protocols*)
```

**依赖硬规则：**

- `domain/` 不 import FastAPI、PydanticAI agent 运行时、infrastructure 实现类  
- `application/` 只依赖 domain + port 协议  
- `agents/` 定位：**PydanticAI 适配器 + 工具绑定**（framework adapter），调用 application/domain，而不是反向  
- `interfaces/`：HTTP 入站适配  
- `infrastructure/`：port 的具体实现  

**与现状命名对齐（不必强行改文件夹名）：**

| 教科书 | 今日可对应 |
|---|---|
| domain | `domain/` |
| application | `application/` + 从 `agents/runner` 抽出的用例 |
| inbound adapters | `interfaces/` |
| outbound adapters | `infrastructure/` + `agents/catalog_adapter` |
| framework agent runtime | `agents/*`（明确降为适配器层文档角色） |

---

## 4. 目标职责树（设计，非强制一次改名）

```text
animichi/
  domain/
    model/              # entities 分文件（可选整理）
    session/            # Session 规则、fact_ledger、compaction_retention
    ports.py            # 仅 Protocol
    errors.py
  application/
    handle_user_message.py
    restore_session.py
    claim_related.py    # 若有
    ports 使用 domain.ports
  adapters/
    inbound/            # 目标名；今日 interfaces/
      http/
    outbound/           # 目标名；今日 infrastructure/ + catalog_adapter
      catalog/
      session_store/
      llm/              # 若需
  agents/               # framework: build agent, tool defs → 调 application
  config/
  tests/
    domain/
    application/
    …
```

**近端不强制改路径：** 可先 **文档 + 依赖规则 + 用例边界** 落地，目录 rename 分期（同 catalog P 分期思想）。

---

## 5. 端口（出站）

沿用并收紧 `domain/ports.py` 语义（名称可逐步对齐 ADR-0002）：

| Port | 职责 | 读写 |
|---|---|---|
| **CatalogLookup / CatalogGateway** | search/resolve/points/itinerary 等（今 `catalog_adapter` / `CatalogClient`） | **只读**（X12） |
| **SessionRepo** | Session 持久化 | 读写（G4 允许） |
| **ConversationLog** | 消息日志 | 读写（G4 允许） |
| **RouteArchive** | 与 SavedRoute/归档相关（命名应对齐 Users，避免与 Itinerary 混淆） | 目标迁 Users 或仅引用 |
| **UsageMeter / AnonQuotaCounter** | 配额 | 读写（会话/计量域） |
| **BangumiRepo / PointsRepo（直连）** | 旧双路径 | **Greenfield：删除写路径**；读一律 CatalogGateway |

**目标依赖方向（= X12 + greenfield）：**

- 巡礼主数据 **只经 Catalog HTTP/oRPC 读**（新 path：`/catalog/itinerary` 等）。  
- **禁止** Agent→Neon 主数据写入；**无包袱 → 删 upsert 而非长期标债**。  
- Session / messages / fact ledger / anon quota：**保留写**（Agent 表）。  
- 类型名与 contract 对齐：**Point / Itinerary / Bangumi / Session**。

---

## 6. 主要用例（Application）

| Use case | 说明 |
|---|---|
| HandleUserMessage | 鉴权后的一轮用户输入 → 加载 Session → agent turn → 持久化 |
| StreamAgentTurn | 同上，流式（AI SDK wire） |
| RestoreSession | 按 id 恢复状态与 fact ledger |
| ApplyHardConstraint | 写入/合并 pacing 等约束 |
| RequestItinerary | 选点后经 Catalog 取 Itinerary |
| SearchPoints | 经 Catalog search（含 partial 语义理解） |
| PhotoSearch / BYOK 相关 | 边界用例，port 另列 |

---

## 7. 与 Catalog / Users / Edge

| 邻居 | 关系 |
|---|---|
| **Catalog** | 供应商：Point/Bangumi/Itinerary |
| **Users** | SavedRoute claim/列表 — Agent 不拥有 |
| **Edge** | 入站身份头、容器调度 — Agent 不实现网关 |
| **Contract** | 跨服务 DTO；domain 内可 map 为内部类型 |

---

## 8. 测试策略（设计）

| 层 | 内容 |
|---|---|
| domain | fact_ledger、实体守卫、compaction 规则 — 无 DB |
| application | use case + fake ports |
| adapters | 现有 integration / api 测 |
| eval | 模型相关仍独立 `tests/eval` |

---

## 9. 分阶段（仅计划）

| 阶段 | 内容 |
|---|---|
| **A0** | 本文 DESIGN → owner ACCEPTED — **DONE 2026-08-06** |
| **A1** | 文档化 agents/ 为 framework adapter；禁止 domain→agents import（边界检查） |
| **A2** | **Greenfield 语言 + CatalogClient**：Point/Itinerary；跟 contract 新 path；**删除**主数据直连写 |
| **A3** | Catalog 调用统一单一 gateway port；Session 写路径保留且文档化 |
| **A4** | 抽出 HandleUserMessage（或等价）application，runner 变薄 |
| **A5** | 可选目录 rename 与 AGENTS 更新（只读口径与 §0.1 一致） |

每阶段独立 PR；**A0 无代码。** A2 可并入仓级 **G1**。

### 9.1 重构列车里 Agent **做什么 / 不做什么**

| 做（已有 `apps/agent` 码） | 不做（留给 ticket） |
|---|---|
| `agents/` 降为 framework adapter；**抽出** HandleUserMessage 等已有主路径 use case | 新 tool / 新数据端点 / 新记忆产品 |
| **移动** catalog 适配到单一 gateway；**删除** 已存在的主数据直连写 | UserMemory 跨会话（Users/SD-15） |
| 化简 runner/deps 上帝对象；port 可测；SOLID / 1-10-50 拆文件 | match_scene 全管线等未落地能力的首次实现 |
| greenfield 类型名与 CatalogClient path | 产品 ticket 自有范围 |

**抽象：** 少而深的 port > 一层层空 interface；PydanticAI 留在 adapter 圈，不渗 domain。

---

## 10. Owner 确认（Agent 设计）— **全部 ACCEPTED 2026-08-06**

| # | 议题 | 决议 |
|---|---|---|
| **A1** | 整体圈层与依赖规则 | **ACCEPTED** — §3 |
| **A2** | `agents/` = framework adapter，不是 domain | **ACCEPTED** |
| **A3** | **X12/G4 + greenfield：** catalog 只读；Session 可写；不新增 agent 数据端点；主数据直连写 **删除** | **ACCEPTED** |
| **A4** | 分期 A1–A5（代码阶段） | **ACCEPTED** — A0 已完成；A1–A5 实施后置 |
| **A5** | 本文 Status → ACCEPTED | **ACCEPTED** |

---

## 11. 相关文档

| 文档 | 角色 |
|---|---|
| `apps/agent/CONTEXT.md` · `apps/agent/AGENTS.md` | 语言；只读 catalog 消费者口径 |
| `2026-07-06-frontend-rebuild-inputs.md` **X12** | Agent 去数据化 |
| `2026-07-06-frontend-rebuild-spec.md` **G4** · **SD-19** | 归属桶；tools 只读不变量 |
| Catalog CA 设计（ACCEPTED） | 供应商边界 |
| ADR-0002 | 发布语言 |
| monorepo-target-layout | 仓级进度 |

---

## 12. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿 DESIGN ONLY；Catalog 已 ACCEPTED 后开写 |
| 2026-08-06 | §0.1「只读」校准 + A3 对齐 X12/G4：catalog 只读、Session 可写、遗留 PointsRepo 标债 |
| 2026-08-06 | Owner 确认 A1–A5 → Status **ACCEPTED**（仍无实现） |
| 2026-08-06 | 与 Users §2.1.1 对齐：Conversation 写权威在 Agent；跨会话 memory 归 Users |
| 2026-08-06 | Greenfield：删直连主数据写优先；Route→Itinerary 全量；并入仓级 G1 |
| 2026-08-06 | §9.1：重构 = 已有码搬家/抽用例/化简/SOLID，不止 rename；未写能力归 ticket |
