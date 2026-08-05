# S0-v2 Launch Spec — animichi.com 上线 + 全基座收口

- 状态:**DRAFT,待双席评审 + owner 签核**
- 日期:2026-08-05
- 上游:`2026-07-06-frontend-rebuild/iter-0.md`(旧 S0,8/10 卡实质完成)、`docs/iterations/iter6/GOAL.md`(iter6 契约)
- 验收契约:`docs/iterations/s0v2/GOAL.md`(与本 spec 同 PR,勾完即 S0-v2 关账)
- 执行方式:代码变更一律 opencode(`opencode-go/deepseek-v4-flash --variant max`,退 luna-max);
  调研 sub agent 默认 sonnet/haiku;spec 有争议项以本文件裁决为准

## 0. 一句话

**把 animichi.com 以「纯展示 landing + 像素级还原设计稿」的形态推上生产,同时把支撑 S1+ 功能开发的
八项能力底座(CI/CD、测试自动化、视觉闸、数据供给、agent 体系、命名、卫生、历史)全部收口。**

## 1. 范围与非目标

**范围**:Track 0/A/B/C/D/F/G(命名)/E,详见 §3-§10。
**非目标**(明确不做,防蔓延):
- chat/photo-search/Walk 在 **prod** 开放(staging 照常全功能,GOAL A 验证在 staging 完成)
- 新编排工具引入(自动接单只做接口格式与试点,见 §8.4)
- 战术 DDD 重构、`src/animichi` 布局迁移(#651)、Python 类型收敛(#654)——归 Track D(iter6 C 组),不进 S0-v2
- Supabase→Neon Auth 切换(#561 cutover)——独立线

## 2. 依赖顺序

```
Track 0(止血)──────────────┐
Track A(大扫除)────────────┼─ spec 审核期间即可跑
Phase S(本 spec 签核)──────┴─▶ Track B(CI)∥ Track C(landing→prod)∥ Track D(测试+数据)∥ Track F(agent 体系)∥ Track G(命名)
                                                    └─▶ Track E(历史大清洗,一切合并后最后执行)
```

Track 内部硬依赖:C5 域名簇依赖 C1-C4 齐活;D2 cron 依赖 #540;B 的 P3 依赖 P0;E 依赖全部。

## 3. Track 0 — 在场止血

| AC | 判据 | test-type |
|---|---|---|
| 0.1 staging 免挑战 | zone config-settings 规则(staging host:`bic=false`+`security_level=essentially_off`)由 **staging stack** 持有(gate ruleset 同款先例);main push 的 post-deploy smoke 全绿 | integration(topology.test)+ 部署实证 |
| 0.2 #541 step 6 | `stagingGateEnabled=true`、全组件 `workers_dev=false`;CI smoke/E2E 带 `STAGING_GATE_TOKEN` 通过;无凭证裸访 staging 得 403 | api + 部署实证 |

## 4. Track A — 大扫除

| AC | 判据 | test-type |
|---|---|---|
| A.1 死物清除 | `skills-lock.json`/`deno.lock`/`atlas.hcl`/`CHANGELOG.md`/`VERSION`/`supabase/neon/0001_init.sql`(cmp 验证后)/`scripts/local-login.test.sh`/`spikes/`(FINDINGS 归档 `docs/ops/`)不再被 git 跟踪;引用零残留(grep 断言) | unit(hygiene 脚本) |
| A.2 sonar 合一 | 仅存 `.sonarcloud.properties`;Sonar Quality Gate 在下一 PR 仍正常出结果 | 部署实证 |
| A.3 根目录目标态 | 根目录 tracked 条目 ≤ 25:9 个目录(apps/workers/packages/infra/db/docs/e2e/scripts/fixtures)+ supabase(冻结)+ 配置与 README 簇 | unit(hygiene 脚本锁清单) |
| A.4 分支/tag | 已合并远端分支全删(留 main/backend-survey);4 个旧 tag 删;repo 开 auto-delete-branch | api(gh 断言) |

## 5. Track B — CI/CD(#679 全套)

依 `docs/iterations/iter6/design-CI-1-pipeline-refactor.md` 七步,现状对照表见 plan;此处只列关账 AC:

| AC | 判据 | test-type |
|---|---|---|
| B.1 双车道消灭 | ruleset 并集法完成:必需检查含 `Web / lint|test|build`,`Web CI`/`web-ci-gate`/`reusable-webapp-ci.yml` 删除;同一 PR 上 web 测试只跑一遍 | api(check-runs 断言) |
| B.2 meta 断言 ×4 | `assert-every-job-has-timeout`/`assert-workflow-default-permissions`/`assert-concurrency-present`/`assert-merge-group-trigger` 落 `.github/scripts/` 且在 `pipeline-quality` 阻塞执行;各配自测 | unit |
| B.3 九包 pipeline | agent/catalog/users/edge/web/infra/contract/e2e/quality 各一条 `pipeline-*.yml`(≤80 行 caller);`changes` job 与 `dorny/paths-filter` 删除;gate 层 7 job 删除;ruleset 7→≈26 + `ruleset-sync.sh` | integration(actionlint+机检)|
| B.4 供应链 | `sha_pinning_required=true`;repo 级 CF token 删(仅 env 级);artifact 契约 + `attest-build-provenance` + deploy 侧 verify 同 PR | 部署实证 |
| B.5 merge queue | #671 七项检查逐条打勾后启用;`merge_group` 下 `github.sha` 语义实测记录 | 部署实证 |

风险:动 ruleset 每步先 `gh api .../rulesets/19974534 > before.json`;`bypass_actors:[]` 意味着错了没有后门——union 法严格三段。

## 6. Track C — landing 上生产

### C.1「开发中」机制(prod 纯展示定案)
- 新组件 `ComingSoonPopup`(动森设计语言:奶油底/teal/3D 按压影;三语文案;可关闭;`role=dialog`)
- 接入点:HeroSearch 提交、chips、登录按钮、LoginModal 触发路径、MobileFoxHome CTA——**由环境开关控制**
  (`VITE_` 不可用的现状下沿 `site.ts` 的 build-time 判据模式,spec 裁决:新增 `apps/web` 构建期常量
  `PROD_SHOWCASE_MODE`,staging=false、prod=true,来源 wrangler vars,SSR 与 client 同源判定)
- AC:prod 上每个交互点点击弹层可截图取证;staging 行为不变(chat 正常)→ browser

### C.2 设计差距修复
- `Hero.tsx:16` 搜索行为:showcase 模式弹层;非 showcase 恢复设计稿 `?q=` 跳 chat(修吞 query bug)→ unit+browser
- 移动端(≤640px)补齐:以 `docs/mockups/mobile-fox-home.html` 定稿为准——**定稿说了算,不臆改**;
  差异走 C.3 像素比对裁决 → browser
- 转场(Graduation):**S0-v2 不做**(设计稿存档,归 S1)——owner 可在签核时推翻

### C.3 像素级视觉回归(核心闸)
- **基线之源**:`docs/design/2026-07-06-design-sync/` 与 `docs/mockups/` 的 HTML 定稿 = 唯一正典。
  spec 附录 A 登记「mockup → 路由」映射表(初版:Landing 定稿→`/`、mobile-fox-home→`/`@640px、
  首页定稿→`/`(authenticated)、Splash 静态版→Splash 组件)
- **管线**:mockup 与实现在同一 `mcr.microsoft.com/playwright` 镜像、同 viewport(1280×800 / 390×844)、
  同字体栈下各自截图;`toHaveScreenshot` 比对,`maxDiffPixels ≤ 8`(容抗锯齿),动态区 mask
- **流程**:diff 热图 → opencode 修实现 → 归零 → 该帧升格为 `e2e/visual/` 回归基线(`@visual` 独立 job)
- **任务原子化**:`make visual-check PAGE=<landing|mobile|home>` 一条命令跑完「双截→diff→报告」,
  退出码即判定;为编排层自动派单预留(§8.4)
- AC:三页基线全绿入库;CI `@visual` job 阻塞;故意改一处颜色→CI 变红(变异验证)→ browser

### C.4 SEO/GEO 收口(#252)
- Lighthouse CI 门(LCP>2.5s 或 CLS>0.1 → fail)进 web pipeline → integration
- IndexNow key 文件、CF Web Analytics beacon、真 og-image(#549,基线管线顺产)→ unit(static-files 测试扩)
- `CANONICAL_ORIGIN` 裁决:**保持硬编码常量**(#506 的 VITE 空串风险实证过;单测锁值)→ unit
- manual-ops(owner):GSC/Bing 双属性 + IndexNow 提交 + CF AI Crawl Control 取证 → manual

### C.5 域名簇与发布
- #550:`api.animichi.com`/`chat.animichi.com` 拓扑 + apps/web base-URL fallback 修复 → integration
- prod 部署走生产审批(**醒目喊 owner**);发布后 `animichi.com` 200、www 301、旧域名(#545)301 → api
- AC:prod smoke 全绿;Google `site:animichi.com` 一周内收录(GOAL 跟踪项,不阻塞关账)

## 7. Track D — agent 测试 + 数据供给

### D.1 Playwright Test Agents 管线
- `npx playwright init-agents --loop=opencode`;**前置**:`e2e/playwright.config.ts` 加
  `testIgnore: ["generated/**", "agent-discovered/**"]`
- 三段闸门:planner 产 `e2e/agent-discovered/specs/*.md`(人审)→ generator 产 `e2e/generated/`
  → 晋升 `e2e/`:连跑两次绿 + **变异检验**(改坏被测代码必须红)+ locator 人读 + 无时序断言
- healer:只本地跑、产 diff、永不 CI 自动提交(结构性防「篡改测试保绿」)
- AC:首轮 planner 对 staging landing+chat 产出 ≥2 份 spec;≥1 条生成用例过全部晋升条件入正式套件 → e2e

### D.2 catalog 数据 cron
- 顺序:#540(ingest 收口 WorkerEntrypoint)→ `sources.ts` retry/指数退避(否则批量抓取撞 Anitabi
  限流→整批 1h 负缓存)→ `wrangler.toml` `[triggers]`×3 + `scheduled` handler(照 `workers/maintenance/`)
- 两类 job:预收录种子表(10-20 作品 work_id 清单,入库为 seed 配置)+ TTL 刷新(`raw_*.fetched_at`
  最旧 N 个重跑 `ingestWork`;`ingest_jobs.acquire` 已支持 done→running)
- AC:staging cron 真跑一轮,`SELECT count(*) FROM bangumi/points` 增长取证;上游 429 时退避生效(单测注入)→ integration+api
- 已知缺口挂账不做:delete-not-in-set、cluster 落库、城市回填(#285 漂移告警可顺带立卡)

### D.3 #684 MiMo-only 密钥收敛(独立小卡,现状文档化 + 死配置删除)

## 8. Track F — Agent 体系重梳

1. `.claude/skills/` 清洗:删 `vercel-*`×5 + `deploy-to-vercel`;`use-codex` 归档;
   `supabase-postgres-best-practices` 标注随 SD-31 退役;存留者逐一对源码复核自述 → unit(引用检查)
2. 4 角色重写(`.claude/agents/`):executor=opencode 派工纪律(模型优先级/验收/变异)、
   tester 接 Test Agents、reviewer 双席、planner 对齐本 spec 流程 → manual review
3. `.claude/rules/workflow.md`:现行事实流程单页化(spec→派卡→执行→双评审→变异→两路评论闸→合并),
   判据全部机器可执行 → manual review
4. 任务单格式:`docs/ops/task-card-schema.md` 定义(输入/验收/门禁命令/产物路径);
   `make visual-check` 为首个符合格式的任务原子;S0 内不引编排工具 → unit(schema 自校验)

## 9. Track G — 命名深度优化(owner 新增)

做法(防散弹式改名):
1. **公约先行**:`docs/naming-conventions.md` 一页——目录(kebab)、TS 文件(组件 PascalCase/其余 camel)、
   Python(snake)、变量/函数语义规则(布尔 is/has、handler on*、双词禁缩写)、路由/env/DB 命名域
2. **全仓审计**:sonnet 席按公约扫出违例清单(路径/文件/导出符号/env 键/Make 目标),按爆炸半径分级:
   L1 纯内部(LSP rename 零风险)/ L2 跨包导出 / L3 对外契约(URL、env、DB 列——**默认不改**,改需 owner 逐项批)
3. **执行**:L1 全量 opencode+LSP;L2 逐包一 PR;每 PR 测试数不变 + `make check` 全绿
4. AC:公约文档入库;违例清单归零(L1/L2);oxlint/ruff 命名规则开启防回潮 → unit+integration

## 10. Track E — 历史大清洗(终局)

1. 前置:其余 Track 全关账、0 open PR、全量备份(`git bundle` + GitHub archive fork)
2. `git filter-repo`:删 `Co-Authored-By`/`🤖 Generated with` 尾部;按里程碑压缩至 ~30-60 commit
   (方案:逐迭代 squash,message 带完整变更摘要与原 PR 号清单)
3. force-push main → 重建 ruleset → CI/Pulumi state/codecov 在新 SHA 全绿验证 → 本地/worktree 全部重置
4. settings `includeCoAuthoredBy: false`
5. AC:`git log --format=%B | grep -c Co-Authored` = 0;commit ~30-60;CI 全绿;bundle 备份可恢复实证 → manual+api

## 11. Integration 文档(与 spec 同 PR 交付)

`docs/ops/integration.md`:env/secrets 三级分布全景(repo/staging/production × 每键用途)、
域名/DNS/路由拓扑图、数据链路(ingest→enrich→publish→agent)、部署链(main→staging→approval→prod)、
本地开发(make dev-local / e2e)一页式。**单一事实来源,替代散落的 handoff。**

## 12. 签核流程

1. 本 PR:spec + GOAL + integration 文档
2. 双席评审:Fable + Opus 独立两席(按 `feedback_spec_dual_review`),回修后复核轮
3. owner 签核 → Track B/C/D/F/G 全面开工(0/A 已先行)

## 附录 A — mockup → 路由映射(初版,C.3 用)

| mockup(正典) | 实现 | viewport |
|---|---|---|
| `docs/design/2026-07-06-design-sync/Landing - Seichijunrei.html` | `/`(未登录) | 1280×800 |
| 同上(`body.night`) | `/`(夜间态) | 1280×800 |
| `docs/mockups/mobile-fox-home.html` | `/`(未登录) | 390×844 |
| `docs/design/2026-07-06-design-sync/首页 - Seichijunrei.html` | `/`(已登录,staging 验) | 1280×800 |
| `docs/design/2026-07-06-design-sync/Splash 静态版.html` | Splash 组件 | 390×844 |
