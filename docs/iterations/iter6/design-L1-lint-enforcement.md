# L1 — 1-10-50 全 workspace oxlint 强制(#655)

**结论:把 10/50 行函数限 + 300/200 行文件限收进根 `.oxlintrc.json`(带 tests override),apps/web 的私有 override 删除;worker/ 与 packages/contract 补 lint 基建(两者今天事实上零 lint);存量 46 个破线文件**一次拆完、零豁免**(owner 裁决 2026-08-03:不设任何 override 白名单/exception baseline),规则收编与拆分同一 campaign 落地。**

## 现状(全部实测,2026-08-03)

- 根 `.oxlintrc.json`:type-aware 严格,已有 `complexity:10`/`max-depth:2`/`max-lines-per-function:50`;**没有** `max-lines`(300 文件限)且函数限是 50 非 10。1-10-50 目前只在 apps/web 达标(它私有 override 到 10/50)。
- **执法空洞**:根 `lint:oxlint` = `pnpm --filter catalog --filter users --filter web` —— `worker/`(edge-worker,有 lint script 但无 oxlint devDep,`spawn ENOENT`)和 `packages/contract`(无 lint script)完全没人 lint;CI `_ts-ci.yml` 只跑 workers/{component}。

## 存量破线清单(精确实测,2026-08-03 复测)

**方法**:oxlint 单独跑 `max-lines-per-function:10`(tests override 50)+ `max-lines:300`(tests 200),两条规则均 `skipBlankLines:true, skipComments:true`(与根配置及 apps/web 现行 override 的既有选项**一致**——这是规则真正执法的口径),非 type-aware,范围 = worker/ workers/ packages/ apps/web(即全部 live TS;frontend 冻结包除外)。
**去重说明**:初稿表格按组相加得 52,与题头 46 矛盾——差异来源是初稿混用了裸 `wc -l` 行数:turnstileArm.test(229)/anonymous.test(207)/byok.test(205)/containerEnv.test(257) 等 4 个测试文件与 worker/users 两个 ×2 组条目在 skip 口径下**不超限**,不是违规文件;复测按执法口径逐文件去重后 = **46 个唯一文件**(生产 39 + 测试 7),清单如下,无重叠、无 shorthand:

**生产代码 39 文件**(违规数,f=函数限 m=文件限):

| 包 | 文件 | 拆分思路(职责边界) |
|---|---|---|
| worker/ (7) | app.ts ×5f · auth.ts ×5f · tiles.ts ×3f · turnstile.ts ×3f · edgeGuard.ts ×2f · containerEnv.ts ×1f · rateLimiter.ts ×1f | app.ts → C2 卡按信任域拆;auth.ts 按 Supabase 验证/Neon-JWT 验证/匿名铸造三域分文件;turnstile.ts 分 siteverify 客户端与 gate 状态机;tiles.ts 分 R2 读取/缓存头/路径校验;其余就地 extract-method |
| workers/catalog/src/lib (9) | route.ts ×6f · clustering.ts ×3f · geocode.ts ×2f · series.ts ×2f · alias.ts ×1f · geo-query.ts ×1f · geo.ts ×1f · transit/etl/build.ts ×1f + transit/etl/n02.ts ×1f | route.ts 按 TSP 求解/腿构建/格式化三段抽纯函数;clustering.ts 距离矩阵/合并循环/输出映射分层;长尾 extract-method |
| workers/catalog/src/api (9) | work-points.ts ×3f · resolve.ts ×2f · search.ts ×2f · spots.ts ×2f · anime-overview.ts ×1f · geocode.ts ×1f · nearby.ts ×1f · preview.ts ×1f · route.ts ×1f | 均为"一个胖 handler"型:抽 request-parse 与 domain 步骤(与 C5 用例化协同) |
| workers/catalog/src 其余 (7) | enrich/enrich.ts ×3f · enrich/parse.ts ×2f · ingest/jobs.ts ×3f · ingest/orchestrator.ts ×3f · ingest/raw-store.ts ×1f · index.ts ×2f · media/img.ts ×2f | enrich 抓取/解析/合并三步早返回化;orchestrator 每 pipeline 阶段一函数;jobs 状态机逐 case 抽函数 |
| workers/catalog 其它 (3) | publish/gc.ts ×1f · publish/snapshots.ts ×2f · scripts/build-gazetteer.ts ×3(f+m) | build-gazetteer **拆分**为下载/解析/emit 三模块(owner 裁决:不放宽,一律拆) |
| workers/users/src (3) | api/routes.ts ×5f · index.ts ×2f · auth/jwt.ts ×1f | routes.ts 每个 oRPC handler 的校验+DB 调用抽 service 函数(与 C5-T1 行映射抽取同 PR) |
| packages/contract (1) | scripts/emit-openapi.ts ×1f | extract-method |

**测试文件 7 个**(>200 行或函数 >50 行,执法口径):worker/turnstile.test.ts(m)· worker/entry.test.ts(m)· workers/catalog/test/catalog-api.spike.test.ts(m)· workers/catalog/test/search.worker.test.ts(m)· workers/catalog/test/spike-db-global.ts(m,helper)· packages/contract/test/share-contract.test.ts(f)· apps/web/tests/msw/chat-handlers.ts(m)。拆分原则:**按被测行为域切,不对半切**(细则见 C2 卡"破线测试文件拆分原则");共享 fixture 提到 test-helpers,消灭复制粘贴 stub。

## 方案对比

| | A. 规则下沉根配置 + 存量一次拆完(推荐,owner 裁决) | B. 每包自带 .oxlintrc 各自为政 | C. 只加新代码门(CI diff-aware) |
|---|---|---|---|
| 一致性 | 单一事实源,apps/web 删私有 rules 段只留 react 插件+ignore | 漂移已发生(web=10,其余=50),会继续 | 规则名义全局、实际不可本地复现 |
| 存量处理 | 46 文件在同 campaign 内全部拆完,配置零豁免条目——不留台账、不留 ratchet 债 | 各包自行放松,不可审计 | 无台账 |
| 成本 | 拆分 PR 若干 + 一次配置 PR + worker/contract 补 devDep/script/filter | 低 | 需自研 diff 工具 |

**推荐 A。** 落地顺序:①worker/ 加 `oxlint`+`oxlint-tsgolint` devDep(今天连二进制都解析不到)、packages/contract 加 lint script;②按包分批拆完 46 个文件(每批该包既有测试全绿);③根配置加 `max-lines-per-function:10`(tests override 50)+ `max-lines:300`(tests 200),**不带任何文件豁免条目**,apps/web 删私有 override;④根 filter 改 `pnpm -r run lint:oxlint`(**不用 `--if-present`**——它会把缺 script 的包静默跳过、fail-open;另加 preflight 断言每个 workspace 包都定义了 `lint:oxlint`,缺失即红);⑤`_ts-ci.yml`/新增 edge lane 跑 worker lint。

## 测试策略

- 配置本身:CI 上 `pnpm -r run lint:oxlint`(fail-closed,同上)全绿即验收;另加一条 node --test 断言:根与各包 .oxlintrc.json **不含任何 `max-lines*` 的文件级 override/豁免条目**(零豁免是不变量,防事后偷偷加白;比"清单只减不增"的计数 ratchet 更强——集合级断言,不存在换名/换 glob 钻空)。
- 每个拆分 PR:该包既有单测全绿 + 行为零变化(纯 extract,不改导出语义)。

## 风险与回滚

- worker/ 首次接入 type-aware lint 可能爆出与行数无关的存量违规(no-unsafe-* 类)——**单独盘点**:按"文件 × 规则"出一份独立于上述 46 行数清单的 no-unsafe-* 违规清单,先修完这批违规再开 type-aware 门;不设豁免清单、不 suppression(仓规禁止),行数豁免绝不可覆盖类型错误。
- 回滚 = revert 配置 PR,零运行时影响;拆分 commit 各自独立可 revert。
- 数字注意:46 文件是"函数/文件行数"维度、skip 空行/注释口径实测;C2/C4 落地后 worker/ 侧会自然销掉 ~10 个,拆分排期以 C2/C4 先行为准免得重复劳动。
