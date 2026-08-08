# Animichi 仓库全量重构方案 — 目标形态与分波迁移

- Status: PROPOSED(待双席评审)
- Date: 2026-08-06
- 取代: 同日保守版 `2026-08-06-repo-simplification-spec.md`(已删除;其 docs/ 重组内容全部并入本方案 W1)
- 证据: 2026-08-06 三路只读盘点(docs 全量 / 全仓引用地图 / 顶层迁移代价面)
- Owner 意图: **彻底重构,不留半吊子**。本方案给出整仓目标形态与到达它的分波安全路径。

## 0. 全改为什么可行

保守版把「146 个文件含路径字面量、11+ 个把配置当数据读的元测试、CI 静默变绿」当作不动源码布局的理由。这些是代价与风险,不是不可行性:

1. 仓库已有 4 层机器网(agnix 引用检查 / test-docs 内容断言 / worker 内容断言 / read-set 元检查),它们的存在意义就是「路径改动不许静默失效」。
2. 单人仓库,PR 队列已清空(2026-08-06),没有并行分支要撞。
3. 每一波都是「git mv + 确定性 sed」,由脚本执行(iter6 五日复盘轨道 2 的结论),模型只写脚本、跑门禁、盯 staging。
4. 静默变绿有已知解法:正向断言验收 + file-pin 变异探针(§2)。

**硬性前提**:执行期间不开并行卡(fleet orchestrator 已冻结,#827);14 个 live worktree 在 W2 开始前必须落地或放弃——路径改名会把它们全部变成冲突源。建议整体排在 #826(staging 部署链)修复之后,因 W2/W3 的验收依赖 staging 健康。

## 1. 目标形态

### 1.1 顶层:20 个可见目录 → 9 个;33 个根文件 → ~25 个

```
apps/            可部署应用:web(TanStack SSR) · agent(Python 容器;补 stub package.json,pnpm 不再静默跳过)
workers/         CF Workers 运行时:edge(补齐 src/、AGENTS.md、自持部署配置) · catalog · users · maintenance
packages/        共享库:contract
e2e/             Playwright 浏览器套件
db/              Neon/Atlas 数据面迁移(atlas.hcl、.sqlfluff 迁入)
supabase/        auth appliance(deno.lock 迁入,待核实)
infra/           Pulumi IaC(入 pnpm workspace,消灭第二份 lockfile)
scripts/         开发脚本(.github/scripts 归 CI,消费者不同,分工保留)
docs/            7 目录 + 7 散文件(1.2)
```

消失的顶层目录(10 个):`docker/`(1 文件 → apps/agent)、`fixtures/`(2 文件 → apps/agent 测试树)、`spikes/`(删,git 历史保留)、`agent/`(被 .gitignore 隐形的 107 文件垃圾)、`B3-supply-chain/`(worktree 泄漏)、`skills/`(48 个空目录)、`.kiro/ .roo/ .trae/ .augment/`(0 字节)。

迁走/删除的根文件:`wrangler.toml` → workers/edge、`Dockerfile` + `.dockerignore` → apps/agent、`atlas.hcl` → db、`.sqlfluff` → db(核实后)、`deno.lock` → supabase(核实后)、双份 Sonar 配置删一份、`.DS_Store` 清除。根 `package.json` 提纯为 workspace 编排——现在它就是 edge worker 的包定义(name=animichi-cloudflare-worker,带 hono/jose 运行时依赖),所有权分裂是根目录最大的结构谎言。

### 1.2 docs/:9 目录 + 8 散文件 → 7 + 7;`superpowers/` 与 `adr/` 消失

```
docs/
├── DOCS_POLICY.md            # 政策 + 新增 ~10 行目录地图(唯一导航;不建 README,避免第二张地图)
├── ARCHITECTURE.md · architecture-diagrams.md · testing-strategy.md
├── data-sources.md · deferred-decisions.md · typing-rules.md
├── ops/                      # 不动(3 个 CI 契约文件在此)
├── api-reference/            # 不动(apps/agent/AGENTS.md 目录级引用)
├── specs/                    # ← superpowers/specs 平层(8) + frontend-rebuild/(8) + cicd html + adr/0001 + 原 unified-spot-display.md
├── iterations/               # 不动(iter5/iter6,本就 2 层)
├── design/                   # 只留活的:animal-island-ref/ + 6 个散 md
├── mockups/                  # 只留活的:review-boards / landing-hero / mobile-fox-home-assets
└── archive/                  # 归档统一入口,只进不出(沿用 iter6 A6/#640,仅换路径)
    ├── specs/(67) ├── plans/(62) ├── reviews/(8)
    ├── design-sync/(~84,原 design/2026-07-06-design-sync 整包:docs 里的可编译源码 + docs 套 docs)
    └── mockups-demo/(41,停更 106 天) + 散档
```

### 1.3 保持不变的结构——这些是**目标态**,不是没改到

| 保持 | 为什么它就是目标态 |
|---|---|
| apps/ 与 workers/ 双命名空间 | 运行时边界即信息(容器/SSR vs Workers isolate);合并只是把 6 个包塞进一个屋,不减少任何东西 |
| db/ 与 supabase/ 分立 | 两个数据面(Neon 数据 vs Supabase auth)是架构决定(SD-31),不是目录事故 |
| e2e/ 顶层 | 显式 workspace 成员;塞进 packages/ 会误标成共享库 |
| scripts/ 与 .github/scripts/ 分立 | 消费者不同(人 vs CI 引用 ×14) |

## 2. 安全机制(每波强制,写进 PR 描述)

1. **三重对齐义务**:任何路径改动 = 配置(ci.yml filter / Makefile / wrangler)+ 断言(READS / meta-test)+ 断言的测试,同一 PR 内闭环。
2. **正向断言验收**:merge 判据 = required lanes 清单 − 成功集合 = ∅。缺席 ≠ 通过;不接受「没看到失败」。每波下方预列「必须出现的 lanes」。
3. **变异探针**:凡改 file-pin(ci.yml 里 `workers/edge/auth.ts` 这类非 glob 钉死),在分支上故意 touch 被 pin 文件,确认对应 lane 被触发后撤销。#647/#440/#483 的死法只有这一个解。
4. **staging 实证**:deploy-touching 波(W2/W3)合并后,staging `/healthz` git_commit 对上 + 对应 smoke 全绿,才开下一波。
5. **单 PR 单波**:全部 `git mv` 保历史,`git revert` 即回滚(W2a 回滚含 redeploy)。

## 3. 分波计划(串行,总量 ~6–7 个工作日)

### W0 — 根目录清扫(0.5d;多为本地 rm,3 个一行改动走小 PR)

| 目标 | 动作 |
|---|---|
| `B3-supply-chain/`、`skills/`、4 个 0 字节 IDE 目录 | rm(git 无感) |
| `agent/`(107 文件) | 核实无运行时消费后 rm(§4-5) |
| `.claude/worktrees/` 5 个陈旧 `*-control.git` + 2 空目录 + C11 两份 venv | `git worktree prune` + rm——「16 层深、6000 目录」的体感来源就地消灭 |
| `apps/agent/htmlcov/`、`coverage.xml`、`.coverage` | rm |
| `.DS_Store` ×2;`.gitignore` 补 `.DS_Store` 与 `.context/` | 小 PR |
| `.codacy.yml` 失效路径 `agent/tests/eval/**` → `apps/agent/agent/tests/eval/**` | 小 PR(上次目录迁移的漏改证据) |
| `skills-lock.json` 被 ignore 却被跟踪 | 删 `.gitignore:93`,保跟踪 |
| GitHub「Deployments」页 500+ 条历史记录 | 一次性脚本批删 inactive 部署记录(REST:先置 inactive 再 DELETE;纯审计流水,不影响任何运行实体)。**不删** workflow 的 `environment:` 声明——secrets 经 environment 上下文解析(#826 教训);记录以后还会产生,属正常审计噪音 |

### W1 — docs/ 重组(1d;单 PR;零运行时风险,练手波)

git mv 映射(脚本执行):

| 旧 | 新 | 文件数 |
|---|---|---|
| `superpowers/specs/*.md` + `2026-07-06-frontend-rebuild/` + `cicd-pipeline-visual.html` | `docs/specs/` | 17 |
| `superpowers/specs/archive/` | `docs/archive/specs/` | 67 |
| `superpowers/plans/archive/` | `docs/archive/plans/` | 62 |
| `superpowers/reviews/` | `docs/archive/reviews/` | 8 |
| `superpowers/sdd/ci-round2-fix-report.md` | `docs/archive/` | 1 |
| `adr/0001-map-stack-maplibre-protomaps.md` | `docs/specs/` | 1 |
| `design/2026-07-06-design-sync/` | `docs/archive/design-sync/` | ~84 |
| `mockups/demo/` | `docs/archive/mockups-demo/` | 41 |

引用改写(脚本 sed,已全量枚举):`AGENTS.md:62,64` · `.claude/agents/planner.md` 写入白名单 ×4 与 `.codex/agents/planner.toml` ×4(镜像,必须双改) · README ×3 语言各 2 行 · `workers/edge/migrationBoundary.test.ts:21-22` 路径常量 · byok 三个测试头注释 · `.github/ISSUE_TEMPLATE/story.md:23`、`debt-card.md:22` · sonar ×2 / `.semgrepignore` / `.gitignore` 的 design-sync 与 mockups 排除路径 · docs 内部互链按前缀映射批量改写(DOCS_POLICY 19 处、frontend-rebuild-spec/-inputs 各 ~20 处)。

DOCS_POLICY 改写:目录地图 ~10 行;「当前迭代」指针化(不再硬编码 iterN,改指 `docs/iterations/README.md`,消灭 R1/R2 类周期性过期);SSOT 表 1/2/19/20 行路径更新;新规则:`docs/specs/` 平层只放非 superseded 文档、**>1MB 截图走 R2 不入库**(防复发;存量历史由 W6 重写清除)。

存量断链修复(今天就是坏的):`persistence.py:145,249` · `alias.ts:11` · `series.ts:5` + 其测试 · `infra/index.ts:13` → 改指 archive 新路径;`0001-map-stack` 内链 → `docs/archive/specs/2026-07-11-map-stack-adr.md`;`.claude/settings.local.json:718` 的 `docs/todo.md` 权限残留删除。

必须出现的 lanes:agnix、agent(test-docs)、worker(migrationBoundary)、read-set 元检查。另加一次性链接检查(全 docs md 相对链接可解析,兜住 ~75 个仅靠文件名引用的盲区文件)+ `git grep -l 'docs/superpowers'` 与 `'docs/adr/'` 双零。

### W2a — edge worker 所有权归位(1d;deploy-touching,全战役最高危波)

| 动作 | 细节 |
|---|---|
| 根 package.json 提纯 | 运行时依赖(hono/jose/@cloudflare/containers/@animichi/contract)与 `test:worker` 迁入 `workers/edge/package.json`;根保留 private 编排,`"test:worker": "pnpm --filter edge-worker test"` 转发,AGENTS.md 命令面零变化 |
| `wrangler.toml` → `workers/edge/` | `[[containers]]` image 改指 `../../apps/agent/Dockerfile` + `image_build_context`(§4-1 是本波的 go/no-go 门) |
| `Dockerfile` + `.dockerignore` → `apps/agent/` | COPY 路径随 context 调整 |
| deploy 链更新 | `deploy.yml`(edge 的 working_directory)、`reusable-deploy-component.yml`、`resolve-worker-url.sh`、Makefile 中 wrangler 相关 target、`.github/dependabot.yml` |
| 文档 | 根 AGENTS.md「Monorepo layout」;**新建 `workers/edge/AGENTS.md`**(全仓唯一没有的包)+ 11 字节 CLAUDE.md;DOCS_POLICY canonical 表补行 |

必须出现的 lanes:worker、agent(containerEnv pin)、staging deploy 全链。staging 实证:`/healthz` git_commit + edge smoke + 容器路由。

### W2b — edge 内部 src/ 布局(0.5d;CI-filter-critical)

48 个平铺文件 → `src/` + `test/`(25 个 .test.ts)。四个 file-pin 逐个更新并各打一次变异探针:`auth.ts`(users filter)、`turnstile.ts`(web)、`containerEnv.ts`(agent)、`migrationBoundary.test.ts`(migrations);同步各 READS 声明 + read-set 元检查 + `testInventory.test.ts`。edge 的 `node --test` 在新布局 + hoisted linker 下先本地跑通(§4-8)。

必须出现的 lanes:worker、users、web、agent、migrations(全部经变异探针确认可触发)。

### W3 — infra 入 workspace(0.5d;deploy-touching)

`pnpm-workspace.yaml` 加 `infra`;删 `infra/pnpm-lock.yaml` + 自带 node_modules,根 lockfile 吸收;CI 的 infra install 流程(`reusable-deploy-component.yml` working-directory: infra ×2 处)改走根 workspace 安装,frozen-lockfile 语义核实。必须出现的 lanes:infra + staging deploy(Pulumi preview/up 路径)。

### W4 — 命名空间与配置归位(1d)

| 动作 | 核实点 |
|---|---|
| `docker/test-postgres/` → `apps/agent/docker/` | Makefile / 集成测试 compose 引用 |
| `fixtures/vision/` → `apps/agent/agent/tests/fixtures/vision/` | vision eval 消费者 |
| `spikes/` 与 `apps/agent/agent/spikes/` 删除 | 无 import(git 历史保留) |
| `atlas.hcl` → `db/` | Makefile 与 CI 的 atlas 调用补 `-c` 参数 |
| `.sqlfluff` → `db/`、`deno.lock` → `supabase/` | 工具配置发现机制(§4-2/3);不成立则留根并记录结论 |
| `apps/agent` 补 stub `package.json` | `{"name":"@animichi/agent","private":true}` + uv 转发脚本;pnpm 不再静默跳过 |
| `.gitignore` 全面重排 | 锚定所有规则(处死无锚定 `skills/`——它藏了 107 个文件);废除全局 `*.html` + force-add 模式,改显式 allowlist(R9/R10 类不一致就地消灭) |

必须出现的 lanes:agent、migrations(Makefile/atlas 在其 filter 内)。

### W4b — apps/agent 换 src-layout(0.5d;config-sweep)

`apps/agent/agent/` → `apps/agent/src/agent/`,消灭 agent/agent 结巴。取巧点:**包名仍是 `agent`、测试留在包内(`src/agent/tests/`)→ 全部 import 语句零变化**,这一步是纯目录插入 + 配置扫射:

- 改写面:`pyproject.toml`(packaging / coverage / pytest 路径)、Dockerfile COPY(W2a 后已随迁至 apps/agent 内)、Makefile 中含 `apps/agent/agent/...` 的路径(seed.sql 等)、ci.yml `agent_behavior` filter 3 条与 `neon-test-base.yml` 的 seed.sql 路径、READS 声明 + read-set 对齐、`.pre-commit-config.yaml`、sonar/codacy、`.gitignore` 的 `/apps/agent/agent/build_info.py`
- 测试外移(src-layout「完全体」)不做:要重写数百个测试 import,而 src/ 插入本身已消灭双名——外移只剩美学
- 必须出现的 lanes:agent、agent_behavior、neon_agent(变异探针:touch `settings.py` 确认 agent_behavior 触发)

### W5 — 防复发闸门(0.5d)

- **新 meta-check**:全仓 tracked 文件(含 .ts/.py 注释)里 `docs/` 前缀字符串必须可解析——把 agnix 的保护面从指令面扩到代码注释,本次抓到的 A-3 类断链从此进不来。~30 行,挂 agnix 同 job。
- DOCS_POLICY / AGENTS.md 终版对账:目录地图 = 实际树;`make check` + §5 全量清单终局重跑;双席评审收尾。

### W6 — git 历史重写(终局波,0.5–1d;与 W2a 并列的高危波)

目标:把 docs 二进制(mockups / design-sync 等,~85M)从**全部历史**中剥离,clone/checkout 回到轻量。与 W1 的 R2 政策配对:**重写清存量,R2 防复发**。顺序必须最后——所有结构波落地后只重写一次。

1. **备份先行(考古链解药)**:`git bundle create` 完整镜像归档 + 把重写前历史推到私有 archive 仓(如 `Seichijunrei-agent-pre-rewrite`)。issue/复盘/记忆里的旧 SHA 永远可在 archive 仓查到——考古链不是断,是搬家。
2. `git filter-repo --analyze` 出血量报告,据此定剥离清单:`docs/archive/mockups-demo` 与 `docs/archive/design-sync` 的**新旧两套路径**(历史里它们大多以旧路径存在)+ 报告点名的其他大 blob;仍被活跃引用的图先上 R2、docs 改链,再进剥离清单。
3. 清场复查:PR 队列空、worktree 零、只剩 main。
4. ruleset 临时放行 force-push → `git filter-repo` → `git push --force` → 所有本地环境重 clone。
5. 验收:CI 全绿 + staging 重部署实证。已知代价(接受):旧 commit SHA 作废(GitHub 上旧链接多数仍可渲染,只是标注「不属于任何分支」;本地考古走 archive 仓);Codecov/Sonar 历史基线断代;CI cache 全 miss 一轮。

## 4. 执行时核实清单(集中;每项给结论后才动对应波)

1. **wrangler `[[containers]]` 的 Dockerfile 相对路径与 `image_build_context` 语义**(cloudflare:wrangler skill 现场查文档)。不支持 → W2a 降级:wrangler.toml 留根、只做 package.json 提纯,记录原因。
2. deno.lock 与 supabase CLI / functions 的锁发现机制。
3. sqlfluff 配置向上发现是否覆盖 `supabase/migrations/`。
4. SonarCloud 实际读 `sonar-project.properties` 还是 `.sonarcloud.properties`(automatic analysis vs CI-based),删另一份。
5. 根 `agent/` 107 文件的来源与运行时消费(与 skills-lock.json、.claude/skills 的关系)。
6. `docs/specs/unified-spot-display.md` 与平层 3 个零引用 spec(neon-test-infra / s1.7-living-document / catalog-rpc)的存废:活跃保留,过期入 archive。
7. `make dev-local` / `make e2e-setup` 对根 wrangler.toml 的隐式依赖。
8. edge `node --test` 在 src/ 布局 + `node-linker=hoisted` 下的模块解析(W2b 前本地跑通)。
9. `git filter-repo --analyze` 血量报告:大 blob 都是谁、活图/死图怎么切(W6 剥离清单的唯一输入,不凭猜)。
10. docs 引用 R2 图的链接形态:直连公开 bucket,还是走 edge 已有的图片代理(infra 里 R2 与代理都已存在,选一种写进 DOCS_POLICY)。
11. GitHub deployments 批删的 API 前置(记录须先置 inactive 才能 DELETE;admin token)。

## 5. 总验证(每波跑其子集,W5 终局全跑)

1. `bash .github/scripts/check-agents-refs.sh`
2. `make test-docs`
3. `pnpm run test:worker`
4. read-set 元检查(uv 环境内 `test_config_read_sets.py`)
5. docs md 相对链接全解析(一次性脚本,不入库)
6. `git grep -l 'docs/superpowers'` / `'docs/adr/'` 双零(W1 后)
7. `make check`
8. required lanes 正向断言(清单 − 成功集合 = ∅)
9. staging `/healthz` + smoke(W2/W3 后)

## 6. 排期与评审

- 串行 W0→W6,~6–7 个工作日。两个高危波:**W2a(部署面)与 W6(历史重写)**,各自独占一天、当天不叠加其他改动;W6 是终局波,前置 = 其余全部落地 + 镜像备份完成。
- 顺序依赖:#826(staging 部署链)修复在前;worktree 清场在 W2 前完成、W6 前复查。
- **排除项:无。**原保守版的两条排除(history rewrite / src-layout)已分别以受控形态纳入 W6 / W4b。
- 评审:双席独立(Fable + Opus),重点审 W2a 部署面、W6 备份步骤与 §4 核实清单;回修后复核轮照旧。
