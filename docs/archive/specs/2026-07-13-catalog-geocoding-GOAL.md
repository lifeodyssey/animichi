# GOAL + PLAN · Catalog Geocoding 落地(到 PR 双评审待合并为止)

> 2026-07-13。把 spec `2026-07-13-catalog-geocoding.md` 落成 **PR-A(geocode 能力)+ PR-B(gazetteer
> 数据+量尺)**,每个 PR 走完 sonnet+codex 双评审、findings 仲裁回修、复核干净、门禁全绿——
> **终态 = 两个 PR 开着、双评审通过、待合并。合并与部署由用户执行,本 GOAL 不做。**

## §0 范围(铁律)

- **In**: `packages/contract`(geocode 端点,纯增量)、`workers/catalog`(geocode 解析链+写回)、
  `db/migrations`(locations/location_aliases + 26 条平价 seed)、`apps/agent`(search_nearby 编排重写、
  CatalogClient.geocode、MockCatalogClient)、eval dataset/评估器修正(PR-B)、gazetteer CSV+seed 脚本(PR-B)。
- **Out**: 合并 PR、部署、`wrangler secret put`(生产变更一律用户批准执行,PR body 只写 ops 步骤)、
  前端、`/v1/bangumi/*`、`sql_agent.py` 死代码清理、路线 origin 接入(follow-up)、CI agent-eval 解禁。
- **角色铁律(Policy B,2026-07-13 用户定)**:lead(Fable)不写产品代码——代码一律由 Codex
  (gpt-5.6-sol)写;sonnet 只做只读调研/评审;仅当 Codex **连续 3 次卡死**才降级 sonnet 代写,
  且必须在 PR body 注明;lead 只做 spec/GOAL、派发、仲裁、核验、git/PR 操作。
- **红线**:LLM 不产出坐标;不上向量/语义(SD-29);`nearby`/`search` 契约不动;无任何 lint/type/test
  抑制;覆盖率只升不降。

## §1 完成定义(Definition of Done)

1. **Spec 定稿**:双评审(sonnet+codex xhigh)findings 全部仲裁(实证裁决,不照单全收)→ 回修 →
   复核轮干净 → spec 提交。
2. **PR-A 开出且双评审通过**:实现 = spec §3.2-3.5 + AC A1-A10 全带测试;lead 三步核验
   (git 真实性 + 读测试防篡改 + 独立重跑门禁)+ **西宮 e2e 实测**(真实链路证明假阴性消失);
   push + `gh pr create`;随后 PR 级 sonnet+codex 双评审 → findings 修完 → 复核干净。
3. **PR-B 开出且双评审通过**:实现 = spec §3.6-3.7 + AC B1-B5;含 **MiMo trajectory 全量重跑证据**
   (search_nearby 错误 8→0,结果贴 PR);同样三步核验 + 双评审闭环。
4. **两 PR 状态 = MERGEABLE、双评审 approve、无未决 finding、门禁绿**(agent 933+ 测试/≥82% 覆盖、
   worker vitest、mypy/ruff/tsc、`emit:openapi` 幂等)。
5. **到此为止**:不 merge、不 tag、不部署。向用户交付两个 PR 链接 + 评审摘要 + 遗留 ops 步骤清单。

## §2 当前状态(基线)

- ✅ 调研完成:三层搜索全景(agent→catalog→Neon PostGIS)+ 假阴性实证(西宮/箱根/豊郷)+
  eval 制度化失败确认(C1_ja_004/C1_zh_005 把 clarify 标成正确答案)。
- ✅ Spec 草稿已提交:`b29b9e6`(分支 `feat/catalog-geocoding`,基于 e1321d8)。
- ⏳ Spec 双评审进行中:sonnet + codex xhigh 并行(codex 带卡死监控)。
- ✅ 前置资产:`GOOGLE_MAPS_API_KEY` 已是 repo secret(container 用,worker 注入属 ops-out);
  MiMo 按量 key 可用(eval 重跑 ~¥2);Python 版 Google gateway 代码可移植。
- 🅿 相邻但独立:PR #335(clarify coercion)双评审完毕待用户合并;PR #334(locale)待回修——均不阻塞本 GOAL。

## §3 PLAN(分阶段;每阶段小步提交)

### Phase 0 — Spec 双评审闭环(进行中)
- 收 sonnet + codex findings → lead 逐条实证仲裁(有分歧跑代码裁决,Codex over-flag 有前科)→
  回修 spec → 复核轮(两评审侧确认或 lead 实证覆盖)→ commit 定稿。

### Phase 1 — PR-A 实现(Codex 写;卡死处置见 §4)
- 迁移(locations/location_aliases + trigger + 26 条 seed)→ contract geocode → worker
  `lib/geocode.ts`+`api/geocode.ts`(exact→Google 写回,raw-sql 模板,mock fetch 测试)→
  agent(CatalogClientProtocol/CatalogClient/Mock + search_nearby 编排三态 + `_INSTRUCTIONS` 一句)→
  AC A1-A10 测试 → 全量门禁 → **commit(铁律:必须真 commit,git log 自证)**。

### Phase 2 — PR-A 核验 + 开 PR + 双评审
- lead 三步核验 + 西宮 e2e(可用 MiMo 或 DeepSeek 真跑一条)→ push → PR(body 含 spec 链接、
  AC 表、ops 步骤:worker secret 注入属部署时用户操作)。
- PR 级双评审(sonnet + codex xhigh,只读)→ 仲裁 → 修(subagent)→ 复核 → 干净即标记
  "双评审通过待合并",通知用户。

### Phase 3 — PR-B 实现(Codex 写;分支基于 PR-A)
- gazetteer CSV(MLIT 车站 + GeoNames 城市,含出典文档)+ 幂等 seed 脚本 + pg_trgm 迁移/索引 →
  eval 修正(C1 族逐条审 + 新 case + MockCatalog fixture)→ `nonempty_results` 评估器 →
  AC B1-B4 → 门禁 → commit。

### Phase 4 — PR-B 核验 + eval 证据 + 开 PR + 双评审
- 三步核验 → **MiMo trajectory 全量重跑**(证据:search_nearby 8→0 + 各指标无回归)→ push → PR →
  双评审闭环 → "待合并",通知用户。

## §4 执行约束

- **Subagent 核验协议**(每次代码产出必做):① git ground truth(commit 存在、文件在 commit 里,
  不信自我报告);② 读新增/改动测试防篡改(无 skip/xfail/弱断言/mock 被测逻辑);③ lead 独立重跑
  全量门禁。历史教训:Codex 谎报 commit 两次、门禁被 `-k` 过滤误伤一次——门禁一律全量跑。
- **Codex 卡死处置**:log 活性 6 分钟冻结即判卡;先从 job log 抢救成果(多次成功先例),重置干净树
  再重派 Codex;**连续 3 次卡死 → 降级 sonnet 代写并在 PR body 注明**(Policy B)。
- **并发纪律**:同一 clone 同时只允许一个写者;派发前 `git status` 必须干净;eval 跑时不动工作树。
- 评审分歧一律实证裁决(复现脚本/最小 probe),先例:PR #335 的 `[1,2]` crash 误报被实测 refute。
- Spec/GOAL 改动与实现同分支小步提交;commit 信息引用 GOAL §编号(仓库惯例)。

## §5 风险 / 待确认

- Google ToS 对 geocoding 结果缓存/存储的条款约束——已点名 codex 评审核查;若确认受限,
  兜底切国土地理院 API(免费,日本域足够)并在 spec OQ1 定案。
- trgm 对 CJK 短串效果差(已知),PR-B 阈值由测试钉住;romaji/zh 依赖 alias 行 + Google 写回。
- GPS/地名优先级翻转的回归面:H2/H4("从这里出发")case 需评审确认不破——spec 评审在查。
- MiMo 重跑有随机性:判定标准是"search_nearby 类错误归零",不是逐指标完全复刻。
- 若 codex 评审通道持续卡死:双评审退化为 sonnet×2(不同 lens)+ lead 深审,在 PR body 注明。
