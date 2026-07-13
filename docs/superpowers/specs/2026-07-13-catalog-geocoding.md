# Catalog Geocoding — 真正实现"按地点搜圣地"

- **Status**: v2 — dual-review rework(v1 双评审均判 needs-rework;本版吸收全部 P0/P1)
- **Date**: 2026-07-13
- **Related**: SD-29 · `docs/ARCHITECTURE.md:215` · MiMo eval search_nearby 错误分析 · GOAL 同目录 `*-GOAL.md`
- **PRs**: PR-A (capability), PR-B (data + measurement)
- **v2 变更摘要**: ①外部兜底 Google→**国土地理院(GSI)**(Google ToS 禁止永久存储 lat/lng,30 天上限、仅 place_id 可存——双评审 P0,已一手核实);②候选折叠策略(西宮多站折 1、府中跨域=真歧义);③歧义管道精确化(failed-step + 无 tool_state + 武装 validator);④`_INSTRUCTIONS` 全段重写入 PR-A(原文明令禁止 bare-location 调 search_nearby);⑤27 别名/19 坐标对纠数 + 西宮补种;⑥eval 翻转面如实扩到 C1/C2 全族;⑦PR-B seed 改 Atlas 数据迁移(deploy 只跑 atlas apply);⑧契约 enum 化/类型导出/无错误码(优雅降级);⑨kind 感知半径 + 都道府县 carve-out。

## 1. Problem

"按地点搜圣地"由两半组成:**地名→坐标(geocoding)** 与 **坐标→附近点位(geo search)**。
后者是真的(PostGIS `ST_DWithin` + `<->` KNN + GiST,`workers/catalog/src/lib/geo-query.ts:37-51`);
前者从未实现:

- `_geocode_for_catalog`(`apps/agent/agent/agents/catalog_tools.py:126-138`;GPS 优先在 134-137)
  只查 session origin 坐标和一个 **27 键/19 坐标对** 的硬编码 dict(`sql_agent.py:71-100`)。
- 其 docstring 声称 "The catalog service owns richer geocoding"——catalog 契约里**没有** geocode 方法。
- Agent 指令**明令**bare-location 查询走 `web_search → clarify`、"Do NOT call search_nearby"
  (`pilgrimage_agent.py:73-82`,例句 108/112)——整条产品路径被禁用后用 clarify 兜底。

**实测假阴性(库里有数据,却"找不到"):**

| 查询 | 库内数据 | `_geocode_for_catalog` | eval 现状 |
|---|---|---|---|
| 西宮/西宫(凉宫,seed 动画) | `hit_sparse` | `None`(dict 无此键,已实测) | `C1_ja_004`/`C1_zh_005` 把 `clarify` 标为正确 → **假阴性被制度化** |
| 箱根(EVA) | miss | `None` | MiMo eval `B1_en_001` 重试耗尽报错 |
| 豊郷(K-On,seed 动画) | 有 | `None` | 无 case |

MiMo 全量 eval 残余 8 个错误全属此类(模型无关;v4-pro 同样撞墙,只是 eval 给它留了 clarify 逃生门)。

## 2. Goals / Non-goals

**Goals**
1. 任意常见日本地名(车站/市区,ja 为主 + zh/en 别名)可解析坐标并返回真实结果。
2. Geocoding 成为 catalog 数据平面能力:**可合法缓存、可生长**、契约化。
3. 真歧义(跨地域同名)走 clarify;真未知诚实报告;"查不到坐标"不再伪装成"需要澄清"。
4. 量尺同步修正:翻正被制度化的假阴性 + 第一个内容级 metric。

**Non-goals**
- ❌ LLM 参与 geocode 链 / 模型报坐标("Never fabricate coordinates" 红线不动)。
- ❌ 向量/语义检索(SD-29;DD-11/12/13/22 冻结)。
- ❌ **Google Geocoding**(ToS:lat/lng 仅可缓存 30 天、禁止预取/永久存储、仅 place_id 例外——
  与写回式 gazetteer 根本冲突。若未来 GSI miss 率证明需要,再按"瞬态、不落库、带 TTL"模式单独评估)。
- ❌ 反向 geocoding、路线 origin 接入(follow-up)、前端、`/v1/bangumi/*`、`sql_agent.py` 死代码清理、
  CI agent-eval 解禁。

## 3. Design

### 3.1 架构位置与数据流

Agent 保持 upstream-free(`test_agent_upstream_free.py` 不变;`CatalogClient` 是唯一 sanctioned seam,
加 `geocode()` 不违反——已核)。模式与番名搜索同构:本地表精确查 → miss 调外部 → **写回**(GSI 结果
无存储限制,出典明记即可)→ 下次本地命中。

```
search_nearby(location)                     [agent tool, 编排]
  → catalog.geocode(location)               [新 RPC]
      locations/location_aliases 精确查      ← PR-A: 19+1 坐标 · 30 别名 seed;PR-B: ~12k 行
      → (PR-B) pg_trgm 模糊
      → GSI 地名検索 API 兜底 + 写回          ← 免费、无 key、可存储(出典明记)
      → 候选折叠(§3.4b)
  → 1 候选 → catalog.nearby(lat,lng,kind 感知半径)   [契约不动]
  → ≥2 簇 → failed-step + ModelRetry 携候选 → clarify
  → 0 候选 → failed-step + 单次 ModelRetry → clarify(显式地名时**不**回退 GPS)
```

**取舍**:独立 `/catalog/geocode`,`nearby` 契约零改动。延迟事实(纠 v1):agent→catalog 是 HTTP
(`CatalogClient` 超时 30s,`catalog_client.py:128-137`);worker→DB 当前为直连 `DATABASE_URL`
(Hyperdrive 在 `wrangler.toml:6-19` 处于注释状态);GSI 兜底最多 +8s(超时 8s),仍远低于 30s。

### 3.2 Contract(`packages/contract/src/contract.ts`,纯增量)

```ts
export const GeocodeKind = z.enum(["station", "city", "ward", "landmark", "prefecture", "external"]);
export type GeocodeKind = z.infer<typeof GeocodeKind>;
export const GeocodeSource = z.enum(["seed", "mlit", "geonames", "gsi", "manual"]);
export type GeocodeSource = z.infer<typeof GeocodeSource>;

export const GeocodeInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});
export type GeocodeInput = z.infer<typeof GeocodeInput>;

export const GeocodeCandidate = z.object({
  id: z.string(),
  label: z.string(),          // 消歧展示: "西宮駅(兵庫県・station)"
  name: z.string(),
  lat: Latitude, lng: Longitude,
  kind: GeocodeKind,
  source: GeocodeSource,
});
export type GeocodeCandidate = z.infer<typeof GeocodeCandidate>;

export const GeocodeResult = z.object({ candidates: z.array(GeocodeCandidate) }); // 折叠后 0..limit
export type GeocodeResult = z.infer<typeof GeocodeResult>;

geocode: oc.route({ method: "POST", path: "/catalog/geocode",
                    summary: "Resolve a place name to coordinate candidates" })
  .input(GeocodeInput)
  .output(GeocodeResult),   // 无 .errors():GSI 失败=优雅降级返回本地结果;本地 DB 失败=自然 500
```

同步事项:`workers/catalog/src/types.ts` 加类型镜像(该文件 lockstep 注释所要求);`emit:openapi`
幂等检查随 PR-A;**不**扩 `UPSTREAM_UNAVAILABLE` 枚举(v1 的错误语义自相矛盾,已删)。

### 3.3 Schema(`db/migrations/`,Atlas;新迁移文件 + `atlas migrate hash` 更新)

```sql
CREATE TABLE locations (
  id         TEXT PRIMARY KEY,          -- 'seed:uji' / 'mlit:st-<code>' / 'gsi:<hash>'
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,             -- station|city|ward|landmark|prefecture|external
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  location   GEOGRAPHY(POINT, 4326),
  source     TEXT NOT NULL,             -- seed|mlit|geonames|gsi|manual
  pref       TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
-- sync_points_coordinates() 只引用 NEW.latitude/longitude/location(已核可直接复用):
CREATE TRIGGER trg_locations_sync_coordinates
  BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();

CREATE TABLE location_aliases (
  alias            TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,       -- normalizeAlias() 同款(lib/alias.ts:55)
  location_id      TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  lang             TEXT,                -- ja|zh|en|NULL
  priority         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (alias_normalized, location_id)
);
CREATE INDEX idx_location_aliases_norm ON location_aliases (alias_normalized);
GRANT SELECT, INSERT, UPDATE ON locations, location_aliases TO catalog_svc;  -- 对齐 init.sql:383-397
-- PR-B 独立迁移: CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX idx_location_aliases_trgm ON location_aliases USING GIN (alias_normalized gin_trgm_ops);
```

**PR-A seed(同迁移内 DML;deploy 只跑 `atlas migrate apply`,故数据必须随迁移走):**
- `KNOWN_LOCATIONS` 实为 **27 个别名键 → 19 个唯一坐标对**(已实测纠数;v1 写 26 为误)。
  迁移按 19 行 `locations` + 27 行 `location_aliases` 落库(zh 变体行 `lang='zh'`:东京/东京站/
  秋叶原/镰仓/涩谷/横滨;其余 `lang='ja'` 或共用 NULL)。
- **补种西宮**(dict 原本没有,而它是旗舰回归案例):`locations` +1(西宮駅,station,兵庫)+
  别名 3 行:西宮(ja)/西宫(zh)/nishinomiya(en)。共 **20 locations / 30 aliases**。
- Seed 数据为 migration-owned 一次性 bootstrap(现有迁移无 DML 先例,但 deploy 机制决定了这是
  唯一会被执行的通道;评审已认可)。

### 3.4 Worker 解析链(`workers/catalog/src/lib/geocode.ts` + `api/geocode.ts`)

**(a) 解析顺序**
1. `norm = normalizeAlias(query)`。
2. **Exact**:`CatalogDb.execute(sql\`SELECT ... FROM location_aliases a JOIN locations l ...
   WHERE a.alias_normalized=${norm} ORDER BY a.priority DESC\`)`(读写走 `CatalogDb` raw-sql 模板,
   与 `api/nearby.ts:45-55` 一致;禁 Drizzle fluent builder——workerd 挂起已文档化)。
3. **(PR-B) Fuzzy**:`similarity(alias_normalized, ${norm}) > 0.4`,按相似度降序;最高分 ≥0.6 且
   折叠后唯一 → 单候选;否则并入候选集。
4. **GSI 兜底**:`GET https://msearch.gsi.go.jp/address-search/AddressSearch?q=<query>`
   (无 key;8s 超时;经 `CatalogContext.fetchImpl` 注入以便测试 mock——该注入点已存在)。
   解析 GeoJSON 候选 ≤limit。**失败/超时/零结果 → logger.warning + 返回本地结果**(优雅降级)。
5. **写回**:GSI 候选 upsert `locations`(`id='gsi:'+sha1(title+coords)[:16]`,`source='gsi'`,
   `kind='external'`)+ `location_aliases`(原 query→各候选,`ON CONFLICT DO NOTHING`)。
   合法性:GSI 属政府標準利用規約(CC-BY 4.0 互換),存储/再配布允许,出典明记于
   `docs/data-sources.md`(PR-A 建档)。
6. 全链确定性,无 LLM,无 key,无 secret ops。

**(b) 候选折叠(新;v1 缺失,PR-B 规模下必需)**
Exact/fuzzy/GSI 合并后:按坐标聚簇(簇内任意两点 ≤10km);每簇取最高优先级代表
(kind 优先 station > city > ward > landmark > prefecture > external;同 kind 取 priority 高者)。
- 1 簇 → 返回单候选(西宮:JR西宮駅+阪神西宮駅+西宮市 → 折 1)。
- ≥2 簇 → 每簇一个代表作为歧义候选(府中:東京 vs 広島 → 2)。
测试钉住:`西宮→1`、`府中→2`(PR-B B2';PR-A 用 seed 内数据钉 `東京→1`)。

### 3.5 Agent 侧(`apps/agent`)

- `CatalogClientProtocol`/`CatalogClient`/`MockCatalogClient` 增 `geocode(query, limit=5)`。
  Mock fixture(PR-A 起即多语言):西宮/西宫/nishinomiya、宇治、東京/东京、府中×2(跨域)、
  未知名 → 空;PR-B 扩:镰仓/秋叶原/宫崎 + G4 `last_location` 形态(宇治市/東京都/神奈川県)。
- `search_nearby(location: str = "", radius: int = 0)` 编排(替换 `_geocode_for_catalog`):

| 输入情形 | 行为 |
|---|---|
| `location` 空 + 有 GPS | origin 坐标(现行"我附近"路径) |
| `location` 空 + 无 GPS | failed-step + `ModelRetry`:请用户给地点或分享位置(→clarify) |
| 非空,折叠后 1 候选 | `nearby(lat, lng, radius or kind 默认半径)`;**kind='prefecture' 例外**:不搜,failed-step + `ModelRetry` 引导 clarify 收窄到市/站 |
| 非空,≥2 簇 | **failed-step(success=False, error="ambiguous_location")+ 不写 tool_state** + `ModelRetry` 消息携候选 label,指示"call clarify with these options" |
| 非空,0 候选 | **不回退 GPS**(v1 的矛盾已删):failed-step + 单次 `ModelRetry`:"Could not locate '<X>'. Call clarify to ask for a nearby station or city." |

- **歧义/失败管道语义(关键,v1 未定义)**:失败路径记 `StepRecord(success=False)` →
  `ctx.deps.steps` 非空 → `output_validator` 保持武装(`pilgrimage_agent.py:386` 的空步跳过
  不触发);**不写 `tool_state["search_nearby"]`** → 模型若强行返回 `search_response`,
  validator 现有规则(`389-395`)直接拒绝——无需新增 validator 逻辑,也不会把歧义 payload
  渲染成 `NearbyMap`(`response_builder.py` `_UI_MAP` 已核)。SSE 沿用 `_store_catalog_result`
  失败分支的 "failed" 事件。clarify 的 options 走既有 `list[str]` 通道;anime 富化对地名字符串
  空结果即可(AC A6 覆盖)。
- **kind 感知默认半径**:station/ward/landmark 5000m、city 10000m、prefecture 不搜(上表)。
- **`_INSTRUCTIONS` 全段重写(PR-A 范围;v1 "同步一句"为严重低估)**:
  Location/nearby 工作流从 "web_search → clarify、Do NOT call search_nearby"(73-82)改为
  "有地名 → 直接 `search_nearby(location=地名原样)`;'我附近' → `location=''`";例句 108/112
  同步改写;AC 加 grep 断言旧禁令文案已移除。GPS 优先级修正:显式地名 > GPS(原 134-137 行为)。
- 删 `catalog_tools.py` 对 `KNOWN_LOCATIONS` 的 import。
- "单次 ModelRetry"的实现口径:消息设计为一次反馈即引导 clarify;agent `retries=2` 全局设置不动,
  以消息内容而非重试预算控制行为(v1 表述"恰好一次"不可强制,已纠)。

### 3.6 数据(PR-B)

- 车站:国土数値情報 N02(v2023,URL/取得日/SHA256 锁定于 `docs/data-sources.md`),~10.6k 站。
  原始记录含路线/事业者重复——按 **站名+坐标聚簇去重** 后落 `locations`(转换脚本文档化)。
- 城市/区:GeoNames JP cities500(CC-BY 4.0,同样锁版本),~1.9k 行,kind=city/ward。
- zh/en 城市别名:`geo_names.py` 数据导出(**655/662 条有非空 zh**——v1 的 662/747 表述已纠);
  车站 PR-B 仅 ja,长尾靠 GSI 写回生长。
- **落库方式 = Atlas 数据迁移**(生成的 SQL 迁移文件检入,deploy 的 `atlas migrate apply` 自动执行;
  v1 的独立 seed 脚本永远不会被 deploy 调用,已废)。生成器脚本 + 校验(行数/checksum)检入
  `workers/catalog/scripts/`,供再生成审计。
- pg_trgm:Neon 官方支持;独立迁移 + preview-branch 应用测试;B1 集成测试镜像需含 pg_trgm
  (postgis/postgis 镜像自带 contrib,测试内 `CREATE EXTENSION`)。

### 3.7 Eval 与量尺(PR-B)

1. **翻转面如实声明(v1 只列 2 个为严重低估)**:C1 全族 16 case + C2 全族 17 case 中,
   凡"具体真实地名"一律 `["clarify"]` → `["search_nearby"]`(含 hit_complete/hit_sparse/
   miss-but-geocodable——miss 的正确行为是诚实空结果,同属 search_nearby 轨迹);
   **carve-out**:C2 中 5 个都道府县级 case(埼玉/山梨/神奈川/岐阜/宮崎)按 §3.5 的 prefecture
   规则保留 clarify(经由"geocode 成功→引导收窄"的诚实路径)。`expected_data_keys` 同步由
   clarify 键改为 `["results"]`。C3(动画+地点)/C4(真模糊)/H2/H4(路线意图)不动——
   已核 H1/H2/H4 的 acceptable_stages 不含 search_nearby 翻转风险;H1(GPS 空地名路径)不变。
   E2/G4 的可选收紧记 follow-up,不入 PR-B。
2. **歧义轨迹计分**:`_STAGE_TOOL_CHAINS` 为歧义 case 增 `("search_nearby","clarify")` 链
   (否则正确的"搜→问"轨迹被 tool_precision/step_efficiency 双重扣分——评审已算出 0.5)。
   新增歧义 case:府中(ja/zh/en 各 1,期望 search_nearby→clarify)。
3. **新 case**:箱根(honest-empty)、豊郷(hit)、Nishinomiya(en)、西宫(zh)。
4. **`nonempty_results`(L1 内容级 metric,第一颗钉子)**:
   - dataset 字段 `expect_nonempty: true`,**标注 ≥10 个**翻转后的 hit_complete/hit_sparse case
     (满足 `gate.py:96` `min_paired=10`,否则 gate 静默跳过——评审已核)。
   - 评估器读 `tool_state["search_nearby"]["row_count"]`(权威来源,非模型文本)。
   - 未标注 case 返回 `{}`(pydantic-evals 按 key 出现的 case 求均值,已核安全);
     **`METRIC_NAMES` 条件收录**:`collect_scores` 对缺失 metric 抛 `ValueError`
     (`eval_report.py:14-19`),故 `EVAL_MAX_CASES` 子采样可能抽不到标注 case——
     实现为"标注 case 存在才纳入 METRIC_NAMES"或 presence-aware 收集(实现挑其一,测试钉住)。
   - харness 触点全列:`AgentExpected` 字段(`evaluators.py:53-59`)、`_expected()`
     (`eval_harness.py:118-121`)、评估器注册与 `METRIC_NAMES`(`eval_harness.py:69-79,146-156`)、
     gate 配对(`gate.py:201-215`)。
5. **B5 证据口径**:附**完整 run 产物**(results JSON 或其摘录)+ 修复前 8 个 case id 列表
   (B1_en_001, C1_ja_004, C1_zh_005, I1_zh_004, I3_en_002, J3_en_001, L3_en_001, A3_en_008)——
   v1 引用的 checked-in 旧产物不能作证,已纠。
6. 边界不变:trajectory tier 用 MockCatalog;CI agent-eval 仍禁用,PR-B 不动 CI。

## 4. Acceptance Criteria(Quality Ratchet:每条带测试)

**PR-A**
| # | AC | 测试 |
|---|---|---|
| A1 | `/catalog/geocode` exact:西宮(seed 补种)与 東京(折叠后 1 候选)返回正确坐标 | worker vitest |
| A2 | 本地 miss → GSI 调用(fetchImpl mock)→ 候选返回 + `locations`/`location_aliases` 写回;同 query 二次查询不再出网 | worker vitest |
| A3 | GSI 超时/非 200/零结果 → warning + 返回本地结果,无异常 | worker vitest |
| A4 | `nearby`/`search` 契约与行为零变化;`emit:openapi` 幂等;`types.ts` 镜像同步 | 既有测试 + drift check |
| A5 | agent `search_nearby("西宮")` → geocode→nearby→rows(FunctionModel e2e,MockCatalog) | agent unit (e2e) |
| A6 | 歧义("府中")→ failed-step + 无 tool_state + ModelRetry 携候选;模型转 clarify(options 为地名字符串)成功产出 ClarifyResponse | agent unit (e2e) |
| A6' | 歧义后模型强行返回 `search_response` → 被 output_validator 拒绝 | agent unit |
| A7 | 未知地名 → failed-step + ModelRetry(含 clarify 引导);**不**出现重试耗尽 UnexpectedModelBehavior(消息即引导) | agent unit |
| A8 | 三态优先级:显式地名>GPS;空地名→GPS;空地名无 GPS→ModelRetry | agent unit ×3 |
| A8' | kind='prefecture' → 不搜、引导收窄 | agent unit |
| A9 | 迁移 seed 平价:**30 条别名**(TS fixture 镜像迁移 SQL,来源=迁移文件)全部经 `/catalog/geocode` 解析到期望坐标 | worker vitest(测试 PG) |
| A10 | `_INSTRUCTIONS` 不再含 "Do NOT call search_nearby" 禁令;新 nearby 工作流 + 例句就位 | agent unit(grep 断言) |
| A11 | 全量门禁:agent pytest ≥933 passed / ≥82% cov;worker vitest;mypy/ruff/tsc;drift | ci |

**PR-B**
| # | AC | 测试 |
|---|---|---|
| B1 | Atlas 数据迁移应用后 ≥10k 站 + ≥1.5k 市区;迁移可重放(hash 校验) | worker vitest(integration,测试 PG 含 pg_trgm) |
| B2 | trgm:"西宮北口"→"西宮北口駅";阈值下不误吸 | worker vitest |
| B2' | 折叠:西宮→1 候选;府中→2 簇 | worker vitest |
| B3 | C1/C2 翻转(±carve-out)+ 新 case + 歧义链入 `_STAGE_TOOL_CHAINS` + 多语言 mock fixture | eval dataset + agent unit |
| B4 | `nonempty_results`:≥10 标注 case 正确计分;子采样无标注时不崩(`collect_scores`);gate 配对生效 | eval evaluator unit |
| B5 | MiMo trajectory 全量重跑:8 个既知 case id 归零;完整产物附 PR | eval(manual gate,PR 附证据) |

## 5. Ops / Security

- **零新增 secret**(GSI 无 key)——v1 的 GOOGLE_MAPS_API_KEY worker 注入整段作废;该 secret 维持
  container 现状不动。
- `docs/data-sources.md`(PR-A 建,PR-B 扩):GSI 出典(国土地理院・地名検索 API,政府標準利用規約
  2.0)、MLIT N02(版本/URL/取得日/SHA256)、GeoNames(CC-BY 4.0)。
- 迁移经 Atlas(`db/migrations/` + `atlas migrate hash`);`supabase/migrations/` 历史树不动。
- GSI 调用观测:worker 记 `gsi_geocode_called` 计数日志。

## 6. Risks

| 风险 | 缓解 |
|---|---|
| GSI 对 zh/en 查询弱 | gazetteer 别名(zh 655 城市 + seed zh 行)承担主力;miss → 诚实 clarify;若真实 miss 率高,再评估"瞬态 Google(30 天 TTL,不入 gazetteer)"为独立决策 |
| GSI 可用性/限流 | 优雅降级已内建(A3);观测计数;gazetteer 随写回生长,依赖度递减 |
| trgm 对 CJK 短串弱 | 阈值 0.6/0.4 + 折叠 + 歧义走 clarify;不指望 trgm 扛 romaji/zh |
| 折叠阈值 10km 误折/漏折 | B2' 钉双例;阈值为常量可调,测试为准 |
| 指令重写影响其他意图路由 | A10 + 全量 eval 重跑(B5)兜底;C3/C4/H 族不动作为回归screen |
| eval 大改基线漂移 | PR-B 重跑基线,gate 按新语义重置(v1.1/v1.2 勘误先例) |
| 迁移含 DML 无先例 | 深思后接受(deploy 只跑 atlas apply,别无通道);数据 migration-owned、一次性、可重放 |

## 7. Open Questions(带默认值)

- **OQ1(已定案)**:外部兜底 = GSI。Google 因 ToS 出局(存储违规);GSI 免费无 key 可存储。
- **OQ2** 候选 label 本地化(zh 用户见汉字简体标签)——默认 PR-A ja label,PR-B 城市部分用
  geo_names 本地化。
- **OQ3** `points` 表地名并入 gazetteer 查询(圣地名作为搜索中心)——默认不做,记 follow-up。

## 8. Follow-ups(不在本 spec)

- 路线 origin(`plan_route`/K-path)接入 `catalog.geocode`。
- E2/G4 族 eval 收紧(明确 `last_location` 注入 session 指令与否后再定)。
- `sql_agent.py` 死代码清理(含 Python 版 Google gateway 一并退役)。
- 检索质量量尺体系化(`nonempty_results` 之上的 recall/precision)。
- 瞬态 Google 兜底(30 天 TTL、不入 gazetteer)——仅当 GSI+gazetteer 实测 miss 率不可接受时。
