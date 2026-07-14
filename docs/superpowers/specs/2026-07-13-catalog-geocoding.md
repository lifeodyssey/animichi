# Catalog Geocoding — 真正实现"按地点搜圣地"

- **Status**: **v4 定稿**(v3 终审:sonnet approve-with-changes + codex approve-with-changes,全部修改项已折入;双评审闭环完成)
- **Date**: 2026-07-13
- **Related**: SD-29 · `docs/ARCHITECTURE.md:215` · MiMo eval search_nearby 错误分析 · GOAL 同目录 `*-GOAL.md`
- **PRs**: PR-A (capability), PR-B (data + measurement)
- **v3 变更摘要**: ①**外部兜底整体移出本 spec**(Google 因 ToS 30 天缓存上限出局;GSI 因混入 CSIS 实验数据、要求**用户可见署名**——已一手核实——出局;两者均降级为带 spike 前置的 follow-up)——geocoding = 纯 gazetteer(PR-A 20 行 seed → PR-B ~12k 行,许可干净);②**三态分离重设计**:零行(honest empty)/歧义/真失败是三个不同状态,不再共用 failed-step(v2 方案会把正常歧义变成 `success=false`+`pipeline_error` 的公开 API 失败,且现有代码把零行结果整个丢弃——均为 codex 复核实证);③都道府县 47 行显式种入 + 裸名→县厅市别名(v2 的 prefecture kind 无生产者);④歧义 eval 用独立 stage `clarify_after_nearby`(`_STAGE_TOOL_CHAINS` 按 stage 键控,直改会污染全部 clarify case);⑤折叠算法精确化(tier 短路 + union-find 单链 + 确定性 tiebreak);⑥DML 迁移 hardening(trigger 只算 NULL、CHECK 约束、300 行规则豁免声明)。

## 1. Problem(与 v2 同,数字为实测)

"按地点搜圣地" = **地名→坐标(geocoding)** + **坐标→附近点位(geo search)**。后者健康
(PostGIS `ST_DWithin` + `<->` KNN + GiST,`workers/catalog/src/lib/geo-query.ts:37-51`);前者从未实现:

- `_geocode_for_catalog`(`catalog_tools.py:126-138`;GPS 优先 134-137)只查 session origin 坐标 +
  **27 键/19 坐标对**硬编码 dict(`sql_agent.py:71-100`)。
- docstring 声称 "The catalog service owns richer geocoding" —— catalog 契约无此方法。
- Agent 指令明令 bare-location 走 `web_search → clarify`、"Do NOT call search_nearby"
  (`pilgrimage_agent.py:73-82`,例句 108/112)。

**实测假阴性**:西宮/西宫(凉宫,`hit_sparse`,dict 无键)→ eval `C1_ja_004`/`C1_zh_005` 竟把
`clarify` 标为正确答案(假阴性制度化);箱根(EVA)→ MiMo `B1_en_001` 重试耗尽;豊郷(K-On)同。
MiMo 残余 8 错误全属此类,模型无关。

**新发现(codex 复核实证,v3 起修)**:现有代码把"零行成功"当失败——
`_run_catalog_nearby` `success=bool(rows)`(`catalog_tools.py:167`)→ 零行不写 tool_state
(`catalog_tools.py:71`)→ validator 拒绝 search_response(`pilgrimage_agent.py:389`)。
即"诚实空结果"在当前管道**不可能存在**。

## 2. Goals / Non-goals

**Goals**
1. 常见日本地名(车站/市区/都道府县,ja 主 + zh/en 别名)可解析坐标并返回真实结果。
2. Geocoding 成为 catalog 数据平面能力:**许可干净、可审计**、契约化。
3. 三态各归其位:零行=诚实空结果(`success=true`);跨域同名=歧义→clarify;查无此名=引导 clarify;
   都不再伪装成失败或"需要澄清"。
4. 量尺同步修正:翻正制度化假阴性 + 第一个内容级 metric。

**Non-goals**
- ❌ LLM 参与 geocode / 模型报坐标(红线不动)。
- ❌ 向量/语义(SD-29;DD-11/12/13/22 冻结)。
- ❌ **一切外部 geocoder**(本 spec 范围内):Google 违 ToS(lat/lng 缓存 ≤30 天,仅 place_id 可存);
  GSI AddressSearch 混入 CSIS シンプルジオコーディング実験数据,其参加规约要求 Web 应用**用户可见界面**
  显示「CSISシンプルジオコーディング実験を利用」+ 链接(已核实:gsimaps issue #29 + CSIS 参加规约)——
  前端改动超出本 GOAL 范围,且端点无公开 schema/SLA。外部兜底整体降级 follow-up(§8,含 spike 前置)。
- ❌ 反向 geocoding、路线 origin(follow-up)、前端、`/v1/bangumi/*`、`sql_agent.py` 清理、CI eval 解禁。

**没有外部兜底的覆盖论证**:PR-B gazetteer(MLIT 全部车站 ~10.6k + GeoNames cities500 全部市区町村
~1.9k + 47 都道府县)覆盖:全部 8 个 MiMo 失败地名、全部 C1/C2 eval 地名(西宮市/箱根町/豊郷町/
高円寺=杉並区内车站 均在源内)。gazetteer 外的长尾 → 诚实 clarify,仍严格优于现状(27 别名 → ~12k 行)。

## 3. Design

### 3.1 架构与数据流

Agent 保持 upstream-free(`test_agent_upstream_free.py` 不变;`CatalogClient` 是 sanctioned seam)。

```
search_nearby(location)                     [agent tool, 编排]
  → catalog.geocode(location)               [新 RPC;纯本地 gazetteer,无出网]
      exact(locations/location_aliases)     ← PR-A: 20 坐标行 · 30 别名;PR-B: ~12k 行
      →(exact-miss 时)pg_trgm 模糊(PR-B)
      → 候选折叠(§3.4b)
  → 1 候选(kind≠prefecture)→ catalog.nearby(lat,lng,kind 半径)→ 结果(含零行=诚实空)
  → 1 候选(kind=prefecture)→ geocode-step + ModelRetry 引导收窄
  → ≥2 簇 → geocode-step(success=True,data=候选)+ ModelRetry 携候选 → clarify
  → 0 候选 → geocode-step(success=True,data=空)+ ModelRetry → clarify
```

延迟:agent→catalog HTTP(client 超时 30s);worker→DB 直连 `DATABASE_URL`(Hyperdrive 注释中);
无出网调用 → geocode 为纯 DB 毫秒级。

### 3.2 Contract(纯增量)

```ts
export const GeocodeKind = z.enum(["station", "city", "ward", "landmark", "prefecture"]);
export type GeocodeKind = z.infer<typeof GeocodeKind>;
export const GeocodeSource = z.enum(["seed", "mlit", "geonames", "manual"]);
export type GeocodeSource = z.infer<typeof GeocodeSource>;

export const GeocodeInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});
export type GeocodeInput = z.infer<typeof GeocodeInput>;

export const GeocodeCandidate = z.object({
  id: z.string(),
  label: z.string(),          // "西宮駅(兵庫県)" — pref 缺失时降级为 name
  name: z.string(),
  lat: Latitude, lng: Longitude,
  kind: GeocodeKind,
  source: GeocodeSource,
  effective_radius_m: z.number().int().positive().optional(),
  // ^ 簇内成员 kind 半径最大值(§3.4b.4);agent 的 nearby 调用优先用它
  //   (PR 评审 F1 勘误:v4 正文有此规则但契约段漏列字段)
});
export type GeocodeCandidate = z.infer<typeof GeocodeCandidate>;

export const GeocodeResult = z.object({ candidates: z.array(GeocodeCandidate) });
export type GeocodeResult = z.infer<typeof GeocodeResult>;

geocode: oc.route({ method: "POST", path: "/catalog/geocode",
                    summary: "Resolve a place name to coordinate candidates (local gazetteer)" })
  .input(GeocodeInput)
  .output(GeocodeResult),   // 无 .errors():纯 DB 查询,先例= nearby(contract.ts:81-85)
```

`workers/catalog/src/types.ts` 加镜像;`emit:openapi` 幂等随 PR-A。

### 3.3 Schema(`db/migrations/`,Atlas;新迁移 + `atlas migrate hash`)

```sql
CREATE TABLE locations (
  id         TEXT PRIMARY KEY,          -- 'seed:uji' / 'mlit:st-<code>' / 'geonames:<id>' / 'pref:13'
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('station','city','ward','landmark','prefecture')),
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  location   GEOGRAPHY(POINT, 4326),
  source     TEXT NOT NULL CHECK (source IN ('seed','mlit','geonames','manual')),
  pref       TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
-- 注意(codex 复核):sync_points_coordinates() 仅在 NEW.location IS NULL 时计算(init.sql:29-45)。
-- 本 spec 全部写入为 INSERT(location 置 NULL → 触发计算);无 UPDATE 坐标场景(无外部写回)。
CREATE TRIGGER trg_locations_sync_coordinates
  BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

CREATE TABLE location_aliases (
  alias            TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  location_id      TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  lang             TEXT CHECK (lang IN ('ja','zh','en') OR lang IS NULL),
  priority         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (alias_normalized, location_id)
);
CREATE INDEX idx_location_aliases_norm ON location_aliases (alias_normalized);
GRANT SELECT ON locations, location_aliases TO catalog_svc;   -- 只读即可(无运行时写回)
-- PR-B 独立迁移: CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX idx_location_aliases_trgm ON location_aliases USING GIN (alias_normalized gin_trgm_ops);
```

**PR-A seed(迁移内 DML;deploy 只跑 `atlas migrate apply`,数据必须随迁移)**:
27 别名键 → 19 坐标行,+ 西宮駅(补种)= **20 locations / 30 aliases**(zh 行 `lang='zh'`:东京/
东京站/秋叶原/镰仓/涩谷/横滨/西宫;en:nishinomiya)。DML 语义:**apply 一次;再次
`atlas migrate apply` 为 no-op**(非"可重放");clean-DB 与 upgrade-DB 双路径测试。

### 3.4 Worker 解析(`lib/geocode.ts` + `api/geocode.ts`;raw-sql 模板,禁 Drizzle builder)

**(a) 检索(严格短路,v2 歧义已纠)**
1. `norm = normalizeAlias(query)`(`lib/alias.ts:55`)。
2. **Exact**:命中 → 携命中行进入 (b),**不再执行后续级**。
3. **(PR-B) Fuzzy**:仅 exact-miss 时;`similarity > 0.4` 降序取 ≤10;命中 → 进入 (b)。
4. 全 miss → 返回空候选。

**(b) 候选折叠(单一 tier 的命中行上执行)**
1. union-find 单链聚簇:任意两行距离 ≤12km 即连通(算法先例 `lib/clustering.ts:72-91`,阈值不同)。
   桥链效应(A-B-C 链式连通)对同名候选集合是**期望行为**(同城多站折一)。
2. 每簇代表:kind 优先 `station > city > ward > landmark > prefecture`;同 kind 按
   `priority DESC, id ASC`(确定性 tiebreak,v2 缺失)。
3. 簇按代表的 `(exact 命中优先, priority DESC, id ASC)` 排序,截断至 `limit`。
4. **有效半径(codex 终审 P1)**:代表按 kind 优先选出,但后续 nearby 的默认半径取
   **簇内成员 kind 半径的最大值**(mixed city+station 簇 → max(5km,10km)=10km),防止 station
   代表把城市查询静默缩到 5km。
5. 测试钉:西宮→1(PR-B 三行折一)、府中→2(跨域)、東京→1(seed 保留 東京 city 与 東京駅
   **两行真坐标**,实测相距 10.56km——12km 阈值由此实测边界确定,B2' 用真实坐标钉住,
   有效半径断言 10km)。shuffled-input 确定性测试必备。

### 3.5 Agent 侧(`apps/agent`)——三态分离(v3 核心重设计)

**管道语义前置修复(PR-A,scope 限 nearby 路径)**:
- `_run_catalog_nearby`:仅改**其调用 `_store_catalog_result` 时传入的 `success=` 实参**为"查询执行成功"(零行也是 True;共享的 `_store_catalog_result` 本体与 resolve/search_bangumi 路径不动——sonnet 终审 NEW-3a);payload 恒写
  `tool_state["search_nearby"]`(含 `row_count: 0`)。零行时 SSE data 照发,`status:"empty"`
  已有字段承载。→ 诚实空结果全链路可达(validator 放行、`NearbyMap` 渲染空态)。
- 新增内部 step 工具名 `geocode`(在歧义/零候选/prefecture 收窄/缺地名无GPS 路径记录 `success=True`;
  transient 失败路径记录 `success=False`——实现勘误:所有 ModelRetry 出口都先记 step,堵死空步解武,
  data=候选摘要;**成功直达路径不记**,保持 C1/C2 期望链 `("search_nearby",)` 的精确率不受污染)。
  该 step 保证 `ctx.deps.steps` 非空 → validator 武装;`AgentResult.success` 不受影响
  (`agent_result.py:40` 语义 = 全部 step 成功);无 `pipeline_error`(`response_builder.py:82`)。

`search_nearby(location: str = "", radius: int = 0)` 行为表:

| 情形 | 行为 | 响应形态 |
|---|---|---|
| location 空 + 有 GPS | origin 坐标 → nearby | 结果(可为诚实空) |
| location 空 + 无 GPS | `ModelRetry`:请给地点或分享位置 | →clarify |
| 1 候选,kind≠prefecture | nearby(**有效半径**:簇内 kind 半径最大值;station/ward/landmark 5km、city 10km) | 结果(可为诚实空) |
| 1 候选,kind=prefecture | geocode-step + `ModelRetry`("X县太大,问用户哪个市/站") | →clarify(`success=true`) |
| ≥2 簇 | geocode-step + `ModelRetry` 携簇代表 label(≤5,消毒:仅取自类型化 `GeocodeCandidate.label`,长度截断——SD-19 `_retry_message` 规则的显式豁免) | →clarify,options=地名字符串(anime 富化空结果可容忍,AC A6 断言) |
| 0 候选 | geocode-step + `ModelRetry`("查无此地,请问用户站名/市名") | →clarify;**显式地名不回退 GPS** |

- 歧义后模型强返 `search_response` → tool_state 无键 → validator 现有规则拒绝(A6')。
- `_INSTRUCTIONS` **全段重写**(PR-A):Location/nearby 工作流改为"有地名 → `search_nearby(地名原样)`;
  '我附近' → `location=''`";删除 "Do NOT call search_nearby" 禁令与例句 108/112 旧流;A10 grep 断言。
- GPS 优先级:显式地名 > GPS;ModelRetry 消息以内容引导 clarify(`retries=2` 全局不动)。
- 删 `KNOWN_LOCATIONS` import。`MockCatalogClient.geocode` fixture(PR-A 即多语言):西宮/西宫/
  nishinomiya、宇治、東京/东京、府中×2、山梨県(prefecture)、未知名→空;PR-B 扩 G4 形态
  (宇治市/東京都/神奈川県)与 镰仓/秋叶原/宫崎。

### 3.6 数据(PR-B)

- 车站:MLIT 国土数値情報 N02(版本/URL/取得日/SHA256 锁 `docs/data-sources.md`),
  **站名+坐标聚簇去重**(原始按路线/事业者重复)→ ~10.6k 行(kind=station)。
- 市区町村:GeoNames JP cities500(CC-BY 4.0,锁版本)→ ~1.9k 行(kind=city/ward)。
- **都道府县 47 行**(kind=prefecture,县厅坐标):**带后缀别名**(岐阜県/神奈川県/宮崎県…+
  zh 简体 后缀形 + en "X Prefecture");**裸名**(岐阜/神奈川/宮崎/埼玉…)别名指向**县厅所在市**行
  (岐阜市/横浜市/宮崎市/さいたま市)——裸名查询直接搜市,后缀查询触发收窄引导。
  (消解 v2 的 prefecture 无生产者 + 岐阜自相矛盾;裸名/后缀行为由 B3 逐 case 审计钉住。)
- zh/en 城市别名:`geo_names.py` 数据导出(**655/662 条非空 zh**)。
- 落库 = **Atlas 数据迁移**(生成 SQL 检入;~12k 行大文件为生成物,**豁免 300 行文件规则并在文件头
  声明 generated-artifact**,分块为多迁移文件亦可);生成器 + 行数/checksum 校验脚本检入
  `workers/catalog/scripts/`。
- pg_trgm:独立迁移;B1 测试镜像 `CREATE EXTENSION`(postgis 镜像含 contrib);Neon 官方支持。

### 3.7 Eval 与量尺(PR-B)

1. **翻转面**:C1 全 16 + C2 全 17 中"具体真实地名"→ `["search_nearby"]`,`expected_data_keys`
   → `["results"]`;**都道府县 carve-out 按 §3.6 裸名/后缀规则逐 case 审计**(数据集含 8 个
   都道府县形 case,不是 v2 说的 5 个;岐阜裸名两案统一翻转,后缀案保留收窄)。C3/H1/H2/H4 不动(已核无 search_nearby 翻转面);**C4 的 `acceptable_stages` 追加
   `clarify_after_nearby`**(模型合法先试 search_nearby 再 clarify 的轨迹不再被误扣——sonnet 终审
   NEW-2;disjunction 语义下严格更宽容);E2/G4 收紧 follow-up。
2. **歧义轨迹**:新 stage **`clarify_after_nearby`**(`_STAGE_TOOL_CHAINS` 按 stage 键控,直改
   `clarify` 链会向全部 75 个 clarify case 开放该链——codex 复核实证):
   链 `(("geocode","clarify"),)`、`_STAGE_MIN_STEPS=2`。新歧义 case(府中 ja/zh/en)用之。
3. **新 case**:箱根(honest-empty:geocode 成功+零行,断言 `row_count==0` 且 `success=true`)、
   豊郷(hit)、Nishinomiya(en)、西宫(zh)、山梨県(prefecture 收窄)。
4. **`nonempty_results`**:`expect_nonempty: true` 标注 **≥15** 个翻转 hit case(>min_paired=10,
   容忍 errored 抽损);评估器读 `tool_state["search_nearby"]["row_count"]`;未标注返回 `{}`;
   `METRIC_NAMES` 条件收录 vs `collect_scores` ValueError(`eval_report.py:14-19`)——实现挑一,
   测试钉;触点:`evaluators.py:53-59`、`eval_harness.py:69-79,118-121,146-156`、`gate.py:96,201-215`。
5. **B5 证据**:完整 run 产物 + 8 case id(B1_en_001, C1_ja_004, C1_zh_005, I1_zh_004, I3_en_002,
   J3_en_001, L3_en_001, A3_en_008)归零对照。
6. CI agent-eval 仍禁用,不动。

## 4. Acceptance Criteria(每条带测试)

**PR-A**
| # | AC | 测试 |
|---|---|---|
| A1 | geocode exact:西宮/西宫/nishinomiya → 兵庫坐标;東京 → 1 候选 | worker vitest |
| A2 | gazetteer miss → 空候选,**零出网**(fetch 未被调用断言) | worker vitest |
| A3 | 折叠:seed 内多别名同点折一;shuffled-input 结果确定 | worker vitest |
| A4 | `nearby`/`search` 契约零变化;`emit:openapi` 幂等;`types.ts` 镜像 | 既有 + drift |
| A5 | agent `search_nearby("西宮")` e2e → rows(FunctionModel+Mock) | agent unit |
| A5' | **诚实空**:geocode 成功+nearby 零行 → `search_response` 通过 validator,`success=true`,`row_count=0`,无 `pipeline_error` | agent unit (e2e) |
| A6 | 歧义(府中)→ geocode-step(success=True)+ ModelRetry 携候选 → clarify 产出;`AgentResult.success==true`,无 `pipeline_error` | agent unit (e2e) |
| A6' | 歧义后强返 search_response → validator 拒绝 | agent unit |
| A7 | 0 候选 → ModelRetry 引导 clarify;无重试耗尽;不回退 GPS | agent unit |
| A8 | 三态优先级:显式地名>GPS / 空→GPS / 空+无GPS→ModelRetry | agent unit ×3 |
| A8' | prefecture(山梨県 fixture)→ 不搜、收窄引导、`success=true` | agent unit |
| A9 | 迁移 seed 平价:30 别名(TS fixture 镜像迁移 SQL)全解析正确 | worker vitest(测试 PG) |
| A10 | `_INSTRUCTIONS` 无旧禁令;新工作流+例句就位 | agent unit(grep) |
| A11 | 全量门禁:agent ≥933 passed/≥82% cov;worker vitest;mypy/ruff/tsc;drift | ci |

**PR-B**
| # | AC | 测试 |
|---|---|---|
| B1 | Atlas 数据迁移:≥9k 站(聚簇去重后实测 9044,原始 10,240 feature)+≥1.8k 市区+47 县;clean+upgrade 双路径;再 apply no-op | worker vitest(integration,含 pg_trgm) |
| B2 | trgm:"西宮北口"→西宮北口駅;阈值下不误吸 | worker vitest |
| B2' | 折叠:西宮→1;府中→2;東京(city+駅 两行)→1 且有效半径=10km;**corpus 抽查**:100 个高频地名的簇数分布审计(codex 终审) | worker vitest |
| B3 | C1/C2 翻转 + 8 都道府县 case 按裸名/后缀规则逐案落定 + 新 case + `clarify_after_nearby` stage + 多语言 fixture | eval dataset + agent unit |
| B4 | `nonempty_results`:≥15 标注;子采样不崩;gate 配对生效 | eval unit |
| B5 | MiMo 全量重跑:8 case 归零;完整产物附 PR | eval(证据) |

## 5. Ops / Security

- **零新增 secret、零出网依赖**(外部 geocoder 全部移出)。
- `docs/data-sources.md`(PR-B):MLIT N02(出典明记)+ GeoNames(CC-BY 4.0)+ 版本/URL/日期/SHA256。
- 迁移经 Atlas;`supabase/migrations/` 不动。

## 6. Risks

| 风险 | 缓解 |
|---|---|
| 无外部兜底 → gazetteer 外地名 miss | 12k 行覆盖论证(§2);miss=诚实 clarify;真实 miss 率观测(worker 记 `geocode_miss` 计数)作为 follow-up 外部兜底的触发数据 |
| 12km 折叠阈值边界 | B2' 以真实坐标(東京 city↔駅 10.56km)钉;阈值常量可调,测试为准 |
| 桥链过度折叠 | 仅同查询候选集内聚簇,同名跨域天然 >12km;shuffled 确定性测试 |
| nearby 零行语义变更波及 search_bangumi 家族 | scope 限 `_run_catalog_nearby`;`search_bangumi` 路径不动;A11 全量门禁回归 |
| 指令重写影响意图路由 | A10 + B5 全量重跑;C3/C4/H 族为回归 screen |
| DML 迁移 + 大生成文件 | apply-once 语义 + 双路径测试;generated-artifact 豁免声明/分块 |
| eval 大改基线漂移 | PR-B 重跑基线,gate 新语义重置(v1.1/v1.2 先例) |

## 7. Open Questions(带默认值)

- **OQ1(定案)**:本 spec 无外部 geocoder。follow-up 触发条件:`geocode_miss` 观测显示真实
  miss 率 >X%(阈值由观测定)→ 届时在「瞬态 Google(30 天 TTL 不落库)」vs「GSI+前端 CSIS 署名」
  间做带 spike 的独立决策(spike 清单:响应 schema fixtures、限流、多 backend provenance)。
- **OQ2** 候选 label 本地化 —— 默认 PR-A ja,PR-B 城市部分用 geo_names。
- **OQ3** `points` 地名并入 gazetteer(圣地名作搜索中心)—— 默认不做,follow-up。

## 8. Follow-ups

- 外部 geocoder 兜底(见 OQ1,spike 前置 + 许可决议)。
- 路线 origin 接入 `catalog.geocode`;E2/G4 eval 收紧;`sql_agent.py` 清理(含 Python Google gateway);
  检索质量量尺体系化;CI agent-eval 解禁。
- **gazetteer 刷新管道**(用户 2026-07-14 拍板:本轮维持数据骑迁移方案 + Sonar 生成物排除):
  下次数据刷新(N02-2024 年更或数据源扩张)时切独立数据管道——deploy workflow 加幂等 loader 步骤,
  CI/本地环境同步接入,新数据不再进迁移历史;既有 20260714000002 迁移作为化石保留不移除。
