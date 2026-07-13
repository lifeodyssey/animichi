# Catalog Geocoding — 真正实现"按地点搜圣地"

- **Status**: Draft → dual review (Fable-authored, sonnet+codex review)
- **Date**: 2026-07-13
- **Related**: SD-29 (structured-first retrieval doctrine) · `docs/ARCHITECTURE.md:215` · MiMo eval search_nearby 错误分析 (fix/mimo-clarify-coercion 调查) · KNOWN_LOCATIONS gazetteer 缺口
- **PRs**: PR-A (capability), PR-B (data + measurement)

## 1. Problem

"按地点搜圣地" 由两半组成:**地名→坐标(geocoding)** 与 **坐标→附近点位(geo search)**。后者是真的
(PostGIS `ST_DWithin` + `<->` KNN + GiST 索引,`workers/catalog/src/lib/geo-query.ts:37-51`);
前者从未被实现:

- `_geocode_for_catalog` (`apps/agent/agent/agents/catalog_tools.py:126-138`) 只查 session origin 坐标
  和一个 **26 条硬编码 dict** (`KNOWN_LOCATIONS`, `sql_agent.py:71-100`,京都/大阪/东京核心站)。
- 其 docstring 声称 "The catalog service owns richer geocoding" —— 但 catalog 契约里**没有** geocode
  方法。承诺存在,实现不存在。
- 任何不在 26 条里的真实地名 → `ModelRetry` → 模型换名字重猜 → 重试耗尽。

**实测假阴性(库里有数据,却返回"找不到"):**

| 查询 | 库内数据 | `_geocode_for_catalog` | eval 现状 |
|---|---|---|---|
| 西宮/西宫 (凉宫圣地, seed 动画) | `db_state=hit_sparse` | `None` | `C1_ja_004`/`C1_zh_005` 把 `clarify` 标成正确答案 → **假阴性被制度化** |
| 箱根 (EVA) | — | `None` | MiMo eval `B1_en_001` 重试耗尽报错 |
| 豊郷 (K-On, seed 动画) | 有 | `None` | 无 case |

MiMo 全量 eval 剩余 8 个错误全部是这一类(模型无关——v4-pro 同样撞墙,只是 eval 数据集给它留了
`clarify` 逃生门)。

## 2. Goals / Non-goals

**Goals**
1. 用户以任意常见日本地名(车站/城市/区,ja/zh/en)搜附近圣地时,能解析出坐标并返回真实结果。
2. Geocoding 成为 catalog 的数据平面能力:可缓存、可生长、契约化(兑现 docstring 的承诺)。
3. 真歧义(多个"府中")走 clarify;真未知诚实报告;**不再把"查不到坐标"伪装成"需要用户澄清"**。
4. 量尺同步修正:eval 不再把假阴性标成正确答案,并新增第一个内容级(result-level)metric。

**Non-goals**
- ❌ LLM 参与 geocode 链(禁止模型报坐标——现有 "Never fabricate coordinates" 红线不动)。
- ❌ 向量/语义检索(SD-29;DD-11/12/13/22 冻结不变)。
- ❌ 反向 geocoding、路线 origin 换新链路(follow-up,见 §8)、前端改动、`/v1/bangumi/*` REST 面。
- ❌ 清理 `sql_agent.py` 死代码(独立 chore)。

## 3. Design

### 3.1 架构位置:catalog worker(不是 Python agent)

Agent 保持 upstream-free(AST 不变量测试 `test_agent_upstream_free.py` 不动)。geocoding 结果是
典型可缓存数据,归 catalog 数据平面。模式与番名搜索**同构**:本地表精确查 → miss 调外部 API →
写回库(下次本地命中)。

```
search_nearby(location)                    [agent tool, 编排]
  → catalog.geocode(location)              [新 RPC]
      gazetteer exact (locations 表)        ← PR-A: 26 条旧 seed;PR-B: ~12k 车站+城市
      → (PR-B) pg_trgm fuzzy
      → Google Geocoding 兜底 + 写回        ← key 已在生产 secrets
  → 1 candidate → catalog.nearby(lat,lng)  [现有 RPC,契约不动]
  → N candidates → 走 clarify
  → 0 candidates → 单次 ModelRetry 引导 clarify
```

**设计取舍**:独立 `/catalog/geocode` 端点、`nearby` 契约**不动**(而非 nearby 直接收地名)。
理由:(a) nearby 保持纯函数零风险;(b) geocode 可复用(路线 origin、未来地图 UI);
(c) 歧义候选的返回形状不污染 nearby 输出。代价是 agent 工具内两次 RPC(均为 Hyperdrive 毫秒级)。

### 3.2 Contract (`packages/contract/src/contract.ts`,纯增量)

```ts
export const GeocodeInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(), // default 5
});
export const GeocodeCandidate = z.object({
  id: z.string(),            // gazetteer row id
  label: z.string(),         // 展示名,含消歧上下文: "西宮北口駅(兵庫県西宮市)"
  name: z.string(),          // canonical 名
  lat: Latitude, lng: Longitude,
  kind: z.string(),          // 'station' | 'city' | 'ward' | 'landmark' | 'external'
  source: z.string(),        // 'seed' | 'mlit' | 'geonames' | 'google'
});
export const GeocodeResult = z.object({ candidates: z.array(GeocodeCandidate) }); // 0..limit

geocode: oc.route({ method: "POST", path: "/catalog/geocode",
                    summary: "Resolve a place name to coordinate candidates" })
  .input(GeocodeInput)
  .errors(pickCatalogErrors(["UPSTREAM_UNAVAILABLE"]))
  .output(GeocodeResult),
```

`emit:openapi` 幂等检查随 PR-A 跑(纯增量,无 drift)。

### 3.3 Schema(`db/migrations/`,Atlas)

```sql
CREATE TABLE locations (
  id         TEXT PRIMARY KEY,          -- 'seed:uji' / 'mlit:st-<code>' / 'g:<place_id-hash>'
  name       TEXT NOT NULL,             -- canonical (ja)
  kind       TEXT NOT NULL,             -- station|city|ward|landmark|external
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  location   GEOGRAPHY(POINT, 4326),    -- 复用 points 的 sync-trigger 模式自动派生
  source     TEXT NOT NULL,
  pref       TEXT,                      -- 都道府県,拼 label 消歧用
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE location_aliases (
  alias            TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,       -- normalizeAlias() 同款 NFKC 折叠
  location_id      TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  lang             TEXT,                -- ja|zh|en|NULL
  priority         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (alias_normalized, location_id)
);
CREATE INDEX idx_location_aliases_norm ON location_aliases (alias_normalized);
-- PR-B: CREATE EXTENSION IF NOT EXISTS pg_trgm;
--       CREATE INDEX idx_location_aliases_trgm ON location_aliases USING GIN (alias_normalized gin_trgm_ops);
```

同一迁移内 seed 现有 26 条 `KNOWN_LOCATIONS`(含 zh 变体作为 alias 行)——PR-A 落地即与现状
**平价**,Google 兜底使其严格更强。

### 3.4 Worker 解析链(`workers/catalog/src/lib/geocode.ts` + `api/geocode.ts`)

1. `norm = normalizeAlias(query)`(复用 `lib/alias.ts:55`)。
2. **Exact**: `SELECT ... FROM location_aliases a JOIN locations l ON ... WHERE a.alias_normalized=$1
   ORDER BY a.priority DESC, l.kind LIMIT $limit`。命中即返回(多行=歧义,原样返回候选)。
3. **(PR-B) Fuzzy**: `WHERE similarity(a.alias_normalized,$1) > 0.4 ORDER BY similarity DESC LIMIT $limit`;
   最高分 ≥0.6 且唯一 → 单候选;否则作为歧义候选返回。CJK 短串 trgm 弱是已知限制,阈值由测试钉住。
4. **Google 兜底**(`GOOGLE_MAPS_API_KEY` 存在时): GET `maps/api/geocode/json`,
   `region=jp&language=ja&components=country:JP`,10s 超时,解析 ≤limit 候选
   (参数/解析逻辑移植自现成的 `apps/agent/agent/infrastructure/gateways/geocoding.py`,该 Python 版
   随 PR-A 保留不动——它只被死代码引用)。key 缺失 → 跳过并 `logger.warning`,返回本地结果(优雅降级,
   与该 gateway 现行为一致)。
5. **写回**: Google 候选 upsert 进 `locations`(`id='g:'+sha1(place_id)[:16]`, `source='google'`)+
   `location_aliases`(原 query→每个候选,`ON CONFLICT DO NOTHING`)。同一查询第二次即本地命中,
   Google 成本趋零。与番名 ingest 同构:seed + on-demand 生长。
6. 全链确定性,无 LLM。DB 查询走既有 raw-`sql` 模板模式(Drizzle builder 在 workerd 下挂起的坑已知)。

### 3.5 Agent 侧(`apps/agent`)

- `CatalogClientProtocol` + `CatalogClient` 增 `geocode(query, limit=5) -> list[GeocodeCandidate]`
  (pydantic model 新增于 clients;`MockCatalogClient` 加确定性 fixture:西宮/宇治/府中×2/未知名)。
- `search_nearby(location: str = "", radius: int = 0)` 重写编排(替换 `_geocode_for_catalog`):

| 输入情形 | 行为 |
|---|---|
| `location` 空 且 session 有 GPS | 用 origin 坐标(现行"我附近"路径,不变) |
| `location` 空 且 无 GPS | `ModelRetry`:请用户给地点或分享位置(→clarify) |
| `location` 非空 | **geocode 优先**(行为变更,见下) → 1 候选:`nearby(lat,lng)`;N 候选:返回 `{"status":"ambiguous_location","options":[labels...]}`,docstring 指示模型转 `clarify`;0 候选:有 GPS 则回退 GPS,否则**单次** `ModelRetry`:"Could not locate '<X>'. Call clarify to ask the user for a nearby station or city." |

- **显式行为变更**:现行代码 GPS 无条件优先(`catalog_tools.py:127-130`),导致"用户在东京、
  问西宮附近"会搜东京。新规则:**显式地名 > GPS,空地名 = GPS**。`_INSTRUCTIONS` 的
  Location/nearby 段同步一句:用户点名地点时把地名原样传入 `location`;"我附近/near me" 传空。
- ModelRetry 消息统一引导 clarify 而非鼓励换名重猜——消灭 MiMo 式 retry 风暴(对 v4-pro 同样生效)。
- 删除 `catalog_tools.py` 对 `KNOWN_LOCATIONS` 的 import(dict 本体留在死代码 `sql_agent.py`,
  随独立 chore 清理)。

### 3.6 数据(PR-B)

- **车站**: 国土数値情報 N02 鉄道データ(国土交通省,~10,600 站,出典明记可商用)。
- **城市/区**: GeoNames JP(cities500 子集,CC-BY 4.0,~1,900 行)。
- 处理后 CSV(~700KB)检入 `workers/catalog/data/gazetteer-jp.csv` + 生成脚本
  `workers/catalog/scripts/build-gazetteer.md`(文档化下载/转换步骤)+ 幂等 seed 脚本
  `workers/catalog/scripts/seed-locations.ts`(upsert,可重跑)。
- **多语言 alias**: 城市 zh/en 变体复用 `apps/agent/agent/agents/geo_names.py` 数据
  (662/747 城市 en↔ja/zh)导出;车站 PR-B 仅 ja(en/zh 长尾靠 Google 写回自然生长)。
- 归属声明入 `docs/data-sources.md`(MLIT 出典 + GeoNames CC-BY)。

### 3.7 Eval 与量尺(PR-B)

1. **修正被制度化的假阴性**:`C1_ja_004`/`C1_zh_005`(西宮,库有数据)`acceptable_stages`
   `["clarify"]` → `["search_nearby"]`。逐条审 C1/C2 族:凡"具体真实地名+库有数据"一律改;
   仅"真模糊查询"(近くに何がある 无 GPS)保留 clarify。
2. **新增 case**:箱根(geocode 成功+库空→诚实空结果)、豊郷(hit)、"Nishinomiya"(en)、
   "西宫"(zh 简体)、府中(歧义→clarify 正确)。
3. **第一个内容级 metric** `nonempty_results`(L1 确定性):dataset 增可选字段
   `expect_nonempty: true`;评估器对带标记的 case 检查任一 search payload `row_count > 0`,
   未标记的 case 不产出该 metric(实现须确认 pydantic-evals 对 per-case 缺失 metric 的均值语义,
   避免虚高)。这是"检索质量零标尺"窟窿上的第一颗钉子——不是终点。
4. Baseline:PR-B 合并后 MiMo trajectory 全量重跑(~¥2)刷新 MiMo baseline 并验证
   search_nearby 8 错误归零;DeepSeek baseline 待余额补充后刷新(现 ~¥14,一次 ~¥10)。
5. 已知边界:trajectory tier 用 `MockCatalogClient`,geocode 的 mock fixture 决定 eval 覆盖;
   真实 Google 路径由 worker 单测(mock fetch)+ 手动 smoke 覆盖。CI 的 agent-eval job 目前
   `&& false` 硬禁用——本 spec 不改 CI 门禁(独立议题)。

## 4. Acceptance Criteria(Quality Ratchet:每条带测试)

**PR-A**
| # | AC | 测试 |
|---|---|---|
| A1 | `/catalog/geocode` exact 命中返回候选(西宮→兵庫坐标) | worker vitest (unit) |
| A2 | miss + key 存在 → Google 调用(mock fetch)→ 候选返回 + `locations`/`location_aliases` 写回;同 query 第二次不再调 Google | worker vitest (unit) |
| A3 | miss + 无 key → 空候选,warning,无异常 | worker vitest (unit) |
| A4 | `nearby`/`search` 契约与行为零变化;`emit:openapi` 幂等 | 既有 worker 测试 + drift check (ci) |
| A5 | agent `search_nearby("西宮")` → geocode→nearby→rows(FunctionModel e2e,MockCatalog) | agent unit (e2e) |
| A6 | 歧义地名("府中")→ `ambiguous_location` payload → 模型转 clarify | agent unit (e2e) |
| A7 | 未知地名无 GPS → 恰好一次 ModelRetry(消息含 clarify 引导),**无重试耗尽** | agent unit |
| A8 | 显式地名 > GPS;空地名 → GPS;空地名无 GPS → ModelRetry | agent unit ×3 |
| A9 | 26 条旧 KNOWN_LOCATIONS 全部经新链路可解析(迁移 seed 平价) | worker vitest (unit, 遍历断言) |
| A10 | 全量门禁:agent 933+ tests / coverage ≥82%;worker vitest 全绿;mypy/ruff/tsc 干净 | ci |

**PR-B**
| # | AC | 测试 |
|---|---|---|
| B1 | gazetteer seed 幂等,≥10k 车站 + ≥1.5k 城市,重跑无 dup | worker vitest (integration, 测试 PG) |
| B2 | trgm:"西宮北口" 命中 "西宮北口駅";阈值下无候选→走 Google | worker vitest (unit) |
| B3 | eval C1 西宮 case 期望修正 + 新 case 落 dataset;MockCatalog geocode fixture 同步 | eval dataset + agent unit |
| B4 | `nonempty_results` metric 上线,带标记 case 正确计分,未标记不虚高 | eval evaluator unit |
| B5 | MiMo trajectory 全量重跑:search_nearby 错误 8→0;baseline 刷新 | eval (manual gate, PR 附证据) |

## 5. Ops / Security

- `GOOGLE_MAPS_API_KEY`:GitHub repo secret 已存在(container 用);PR-A 需在 deploy workflow 给
  **catalog worker** 注入(`wrangler secret put`,staging + production)。**部署到 prod 的 approve
  关卡照例需用户批准。**
- Key 只经 env → worker secret;不入代码/日志(沿用现有 gateway 的 redact 习惯)。
- Google 成本:cache-first + 写回,预估稳态每月个位数美元;worker 记 `google_geocode_called`
  日志计数器便于观测。
- 迁移经 Atlas(`db/migrations/`);`supabase/migrations/` 历史树不动。

## 6. Risks

| 风险 | 缓解 |
|---|---|
| trgm 对 CJK 短串效果差 | 阈值保守(0.6 auto / 0.4 candidate)+ 歧义一律走 clarify;romaji/zh 靠 alias 行与 Google 写回,不指望 trgm |
| Google 返回日本外同名地 | `components=country:JP` 硬过滤 |
| GPS/地名优先级翻转改变既有行为 | A8 三态测试钉死;eval H2/H4("从这里出发")回归确认 |
| 写回污染(Google 坏候选入库) | 写回行 `source='google'` 可识别可清理;alias 仅绑原 query,不做泛化 |
| 26 条平价迁移漏项 | A9 遍历断言 |
| eval 期望大改引发基线漂移 | PR-B 单独重跑基线,gate 按新语义重置(有 v1.1/v1.2 勘误先例) |

## 7. Open Questions(带默认值,评审可推翻)

- **OQ1** 外部兜底选 Google(默认,key 已备,zh/en 支持最好)vs 国土地理院 API(免费,仅日文)。
  默认 Google;若成本敏感,PR-B 可加 GSI 为第一兜底、Google 第二。
- **OQ2** 候选 label 本地化(zh 用户见"西宮北口駅(兵库县)")——默认 PR-A 仅 ja label,
  PR-B 用 geo_names 数据本地化城市部分。
- **OQ3** `points` 表自身地名(如"大吉山展望台")是否并入 gazetteer 查询(UNION)——默认 PR-B 不做,
  记 follow-up(它让"圣地名"本身可作为搜索中心)。

## 8. Follow-ups(不在本 spec 范围)

- 路线 origin(`plan_route`/K-path `execute_selected_route`)接入 `catalog.geocode`。
- `sql_agent.py` 死代码清理(SQLAgent、旧 resolve_location、Python geocoding gateway)。
- 检索质量量尺体系化(内容级 recall/precision,超出 `nonempty_results` 的完整方案)。
- CI agent-eval job 解禁策略。
