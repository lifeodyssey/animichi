# L1 — 1-10-50 全 workspace oxlint 强制(#655)

**结论:把 10/50 行函数限 + 300/200 行文件限收进根 `.oxlintrc.json`(带 tests override),apps/web 的私有 override 删除;worker/ 与 packages/contract 补 lint 基建(两者今天事实上零 lint);存量 46 个破线文件用 `overrides` 按文件白名单豁免、逐文件销账,不放松规则本身。**

## 现状(全部实测,2026-08-03)
- 根 `.oxlintrc.json`:type-aware 严格,已有 `complexity:10`/`max-depth:2`/`max-lines-per-function:50`;**没有** `max-lines`(300 文件限)且函数限是 50 非 10。1-10-50 目前只在 apps/web 达标(它私有 override 到 10/50)。
- **执法空洞**:根 `lint:oxlint` = `pnpm --filter catalog --filter users --filter web` —— `worker/`(edge-worker,有 lint script 但无 oxlint devDep,`spawn ENOENT`)和 `packages/contract`(无 lint script)完全没人 lint;CI `_ts-ci.yml` 只跑 workers/{component}。
- 存量破线(方法:oxlint + 根规则改 prod 10/50 + max-lines 300/200-test,非 type-aware 跑 worker/ workers/ packages/):**46 文件**,违规按文件计:

| 文件(实测行数) | 违规 | 拆分思路(职责边界) |
|---|---|---|
| workers/catalog/src/lib/route.ts (295) ×6 | 函数 | TSP 求解/腿构建/格式化三段,按算法阶段抽纯函数 |
| workers/users/src/api/routes.ts (147) ×5 | 函数 | 每个 oRPC handler 的校验+DB 调用抽 service 函数 |
| worker/auth.ts (277) ×5 | 函数+文件 | Supabase 验证 / Neon-JWT 验证 / 匿名身份铸造三域分文件 |
| worker/app.ts (433) ×5 | 函数+文件 | → C2 卡,按信任域拆 |
| workers/catalog/src/lib/clustering.ts (186) ×3 | 函数 | 距离矩阵/合并循环/输出映射分层 |
| workers/catalog/src/ingest/orchestrator.ts (161) ×3 | 函数 | 每 pipeline 阶段一函数,主函数只剩编排 |
| workers/catalog/src/ingest/jobs.ts (144) ×3 | 函数 | job 状态机转移逐 case 抽函数 |
| workers/catalog/src/enrich/enrich.ts (154) ×3 | 函数 | 抓取/解析/合并三步早返回化 |
| workers/catalog/src/api/work-points.ts (121) ×3 | 函数 | 查询构建与响应组装分离 |
| workers/catalog/scripts/build-gazetteer.ts (357) ×3 | 函数+文件 | 下载/解析/emit 三模块(scripts,可考虑放宽而非拆) |
| worker/turnstile.ts (240) ×3 | 函数 | siteverify 客户端 vs gate 状态机两文件 |
| worker/tiles.ts (224) ×3 | 函数 | R2 读取/缓存头/路径校验分函数 |
| ×2 一批(11 文件):users/index.ts、catalog snapshots/img/series/geocode/index/parse/spots/search/resolve.ts (260)、worker/edgeGuard.ts | 函数 | 均为"一个胖 handler"型:抽 request-parse 与 domain 步骤 |
| ×1 长尾(20 文件,含 rateLimiter/containerEnv/geo/alias/preview/nearby…) | 函数 | 单函数超限,就地 extract-method 即可 |
| 测试文件 >200 行:worker 6 个(turnstile 331/entry 263/containerEnv 257/turnstileArm 229/anonymous 207/byok 205)+ catalog 3 个(catalog-api.spike 357/search.worker 314/spike-db-global 303) | 文件 | 按行为域切(见 C2);spike-db-global 是 helper,归 override 豁免 |

## 方案对比
| | A. 规则下沉根配置 + 存量文件白名单豁免(推荐) | B. 每包自带 .oxlintrc 各自为政 | C. 只加新代码门(CI diff-aware) |
|---|---|---|---|
| 一致性 | 单一事实源,apps/web 删私有 rules 段只留 react 插件+ignore | 漂移已发生(web=10,其余=50),会继续 | 规则名义全局、实际不可本地复现 |
| 存量处理 | `overrides:[{files:[46个],rules:{max-lines*:off}}]` 显式清单=技术债台账,删一个文件条目=销一笔账,**只出不进**(棘轮,同 coverage 慣例) | 各包自行放松,不可审计 | 无台账 |
| 成本 | 一次配置 PR + worker/contract 补 devDep/script/filter | 低 | 需自研 diff 工具 |
**推荐 A。** 落地顺序:①根配置加 `max-lines-per-function:10`(tests override 50)+ `max-lines:300`(tests 200)+ 46 文件豁免清单;②worker/ 加 `oxlint`+`oxlint-tsgolint` devDep(今天连二进制都解析不到);③packages/contract 加 lint script;④根 filter 改 `pnpm -r --if-present run lint:oxlint`;⑤`_ts-ci.yml`/新增 edge lane 跑 worker lint。scripts/(build-gazetteer 等离线 ETL)建议 override 放宽 max-lines 到 400 而非拆——一次性脚本拆碎是负收益,owner 裁决。

## 测试策略
- 配置本身:CI 上 `pnpm -r lint:oxlint` 全绿即验收;另加一条 node --test 断言豁免清单文件数只减不增(读 .oxlintrc.json 计数,防偷偷加白)。
- 每销账一个文件:该包既有单测全绿 + 该文件从豁免清单删除,同 PR 完成。

## 风险与回滚
- worker/ 首次接入 type-aware lint 可能爆出与行数无关的存量违规(no-unsafe-* 类)——先跑一次盘点,若>20 条则 worker 的 typescript 规则同样走豁免清单,不 eslint-disable(仓规禁止 suppression)。
- 豁免清单被滥用:靠棘轮测试 + review 把关。回滚 = revert 配置 PR,零运行时影响。
- 数字注意:46 文件是"函数/文件行数"维度实测;C2/C4 落地后 worker/ 侧会自然销掉 ~10 个。
