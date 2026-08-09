# Web UI 结构重构（一次做到位 · 无巡礼 domain）

- Status: **ACCEPTED**（owner 2026-08-06 — `routes`≈pages + `features` + platform；**无**巡礼 domain；**不含实现**）
- Date: 2026-08-06
- Package: `apps/web`（TanStack Start · Cloudflare）
- Tier: **UI**（monorepo §4.3 LOCKED）
- Parents: monorepo-target-layout · greenfield · `apps/web/AGENTS.md`
- Scope: **已有代码** 边界收敛 + api 纪律 + greenfield 跟车；**无** 假 domain 层

---

## 0. 关于「domain model」—— Web **不用**

| 概念 | Web 是否用 |
|---|---|
| 巡礼 **DDD domain model**（实体不变量、仓储） | **否** — 权威在 Catalog / Users / Agent |
| 目录 `src/domain/` | **否** — 禁止为「像样」mkdir |
| **Contract DTO**（`@animichi/contract` 的 Point / Itinerary / SavedRoute） | **是** — **边界类型**，不是包内 domain 再建模 |
| Feature 内 **view-model / UI state** | **是** — 仅 UI 状态（chat draft、panel open），不复制主数据权威 |
| Clean Architecture 四圈 | **否** — UI 用 **Feature module + Route + API hook** |

一句话：**Web 消费发布语言（contract），不拥有领域模型。**
组件里的 `Point` 类型 = **wire/view 形状**，规则以服务端与 contract 为准。

---

## 1. 目标（一次最好）

1. **依赖方向一次钉死（已有好基础，写成硬规则）：**
   `routes / components → features → api/hooks → api clients → 公网 /v1`
   UI **永不** 手写 JSON 旁路 contract。
2. **Feature 边界一次理清：** 跨 feature 共享进 `platform/` 或极薄 `components/`；feature 私货不进 `lib/` 黑洞。
3. **`lib/` 降级为 platform 工具：** auth / byok / turnstile 等跨面能力；chat/route-detail **迁回或明确归属 feature**。
4. **Greenfield 一次跟车：** contract 改名/path 时 hooks + MSW + 类型 import 全改，无长期 `UserRoute` 别名。
5. **不半吊子：** 不做「文档写 feature-first、仓库继续双堆 components+lib 无时间表」。

---

## 2. 现状 inventory（实盘）

```text
apps/web/src/
  api/           # clients, orpc, hooks, config, query-client — 正确
  routes/        # TanStack file routes
  features/      # chat, shiori, map-*, anime, seo, bubble-map, config
  components/    # landing, auth, home, legal, route-detail, …
  lib/           # auth, byok, turnstile, chat, route-detail
  platform/      # theme-bootstrap, geo
  i18n/ server/ styles/
```

### 2.1 正确碎片

- oRPC OpenAPILink + 分 service client（catalog / users）
- hooks 前缀 key 分离；SSR QueryClient per request
- MSW 用 contract zod parse，不手写 envelope
- features 已按产品面切开
- 1-10-50 / coverage floors 已在 AGENTS

### 2.2 结构债

| 债 | 说明 |
|---|---|
| `components/route-detail` vs `lib/route-detail` vs 未来 feature | 三处风险 |
| `lib/chat` vs `features/chat` | 双栖 |
| `components/*` 与 `features/*` 标准不清 | 新人不知放哪 |
| 无 CONTEXT.md | 语言/边界靠 AGENTS 散落 |
| Greenfield 未做 | 仍消费旧 wire 名（随 contract 列车） |

---

## 3. 目标树（一次最好 · 无 `domain/`）

```text
apps/web/src/
  app/                         # 可选：router.tsx、全局 provider（若从根迁入）
  routes/                      # 只负责 URL ↔ 组合 features（薄）
  features/
    chat/                      # UI + hooks 私有 + 原 lib/chat
    route-detail/              # 合并 components/route-detail + lib/route-detail
    shiori/
    anime/
    maps/                      # 收敛 map-spike + maplibre + bubble-map（见下）
    seo/
    auth/                      # 登录 UI（原 components/auth）+ 与 lib/auth 的边界
    landing/                   # landing / home / splash
    legal/
  api/                         # 保持：唯一 HTTP 出口
    clients.ts
    orpc.ts
    hooks/                     # 可按 service 分子目录 catalog/ users/ agent/
    config.ts
    query-client.ts
  platform/                    # 跨 feature 真共享
    auth/                      # session/token 获取（非业务）
    byok/
    turnstile/
    i18n/                      # 或保持 src/i18n 顶层
    styles/
    geo.ts
    theme-bootstrap.ts
  components/                  # 仅真正无业务的 primitive / 壳（或最终清空并入 platform/ui）
  server/                      # SSR 仅有逻辑
  # 禁止：domain/
```

### 3.1 Maps 收敛（一次说清）

今日 `map-spike` / `maplibre` / `bubble-map` 并存。目标：

- **`features/maps/`** 统一出口；spike 中已生产化的代码并入，死 spike **删除**（已有码清理，不是新功能）。
- 若某文件仍是实验且无路由引用 → 删或移 `_dev`，不留三套真源。

---

## 4. 搬家表（from → to，已有码）

| 今日 | 目标 |
|---|---|
| `lib/chat/*` | `features/chat/*`（或 `features/chat/lib/*` 若需子层） |
| `lib/route-detail/*` | `features/route-detail/*` |
| `components/route-detail/*` | `features/route-detail/ui/*` |
| `components/auth/*` | `features/auth/ui/*` |
| `components/landing|home|Splash|Landing` | `features/landing/*` |
| `components/legal/*` | `features/legal/*` |
| `lib/auth|byok|turnstile` | `platform/auth|byok|turnstile` |
| `platform/geo.ts` · `theme-bootstrap.ts` | 保留 `platform/` |
| `features/map-spike` + `maplibre` + `bubble-map` | `features/maps/*` + 删死代码 |
| `api/hooks/*` | 可按 `hooks/catalog` `hooks/users` 分子夹（同 PR 或紧后） |
| 无 `CONTEXT.md` | 新增 `apps/web/CONTEXT.md`（UI 语言 + 无 domain 声明） |

**路由层：** `routes/*.tsx` 只 import features 的 page 入口，避免 route 文件堆业务。

---

## 5. Pattern（UI · 非 DDD）

| 用 | 不用 |
|---|---|
| **Feature module** | 包级 `domain/entities` |
| **Route as composition root** | Route 内巨型业务函数 |
| **Query/Mutation hooks** | 组件内直接 `createCatalogClient` 散落 |
| **Contract DTO at boundary** | 手写平行 interface 与 contract 漂移 |
| **MSW = contract parse** | 手写 JSON fixture 旁路 zod |
| **View state in feature** | 全局 store 镜像整份 Catalog |

**SOLID 在 UI 的落点：**

- **S：** 一个 feature 一个产品面；hook 不渲染
- **O：** 新卡片/流式 part → registry 扩展（既有 generative 纪律）
- **D：** UI 依赖 hook 抽象，不依赖 OpenAPILink 细节

**1-10-50 / coverage：** 搬家不降 floor；超标组件拆，不靠 disable。

---

## 6. Greenfield（一次跟车）

| 项 | 动作 |
|---|---|
| 类型名 | `PilgrimagePoint`→`Point`，`Route`→`Itinerary`，`UserRoute`→`SavedRoute` |
| Client path | catalog itinerary；users `saved-routes` |
| MSW handlers | 同步 path + schema |
| i18n / 文案 | 产品词可保留日文「ルート」；**代码标识符** 用 SavedRoute/Itinerary |
| 禁止 | `export type Route = Itinerary` 长期别名 |

与 catalog/users G1 **同波或紧后**；web 单独半截旧类型 = 不允许作为终态。

---

## 7. PR 切片

| 切片 | 内容 | 完成判据 |
|---|---|---|
| **W0** | 本文 + CONTEXT.md ACCEPTED | 文档 |
| **W1** | 钉死 api 层纪律（eslint/path 或 AGENTS 硬句 + 违反例清理） | 无 UI 直连乱 fetch |
| **W2** | `lib/chat` + route-detail → features；删双栖 | import 单向；测绿 |
| **W3** | landing/auth/legal 进 features；components 只留 primitive 或清空 | 树符合 §3 |
| **W4** | maps 三源收敛 + 删死 spike | 单 features/maps |
| **W5** | platform 收 auth/byok/turnstile | lib/ 可删或空 |
| **W6** | Greenfield 类型/path/MSW | typecheck + unit 绿 |

**允许 W2–W5 合并** 若团队接受大 PR；**目标态必须完整**，禁止「maps 永远 spike」。

---

## 8. Non-goals

| 不做 | 去向 |
|---|---|
| `src/domain` 巡礼模型 | Catalog/Users/Agent |
| Share/Check-in/しおり **后端** | tickets #235 #243 #212… |
| 实现新页面产品 | 各 story |
| Edge package-ize | edge 结构文 |
| 放宽 coverage / 1-10-50 | 禁止 |

---

## 9. 验收（实现后）

- [ ] 无 `apps/web/src/domain`
- [ ] UI → hooks → clients 单向；无组件手写业务 URL 散落
- [ ] `lib/chat`、`lib/route-detail` 不存在或仅 re-export 过渡 **零**（终态无 re-export）
- [ ] maps 单一 feature 入口
- [ ] contract 新名全站编译通过

---

## 10. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：UI 一次到位；明确 **无** 巡礼 domain model；feature/platform 终态 |
| 2026-08-06 | Owner **ACCEPTED**（`routes`≈pages + `features` + platform） |
