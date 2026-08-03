# CI-1 — per-package pipeline 重构设计稿 v3 定稿(#679)

底稿:`docs/superpowers/specs/2026-07-29-cicd-rebuild-spec.md` §4/§5/§7;决议册 `docs/iterations/iter6/decisions-2026-08-03.md` §CI/CD。v3 = v2 + Fable 席评审 7 条 [必须修改] 全部落实。本稿数字全部 2026-08-03 实测(分支 `fix/zizmor-cache`,与 `main` 仅差 `_security.yml`)。

## 结论先行

1. **每条 pipeline = stage DAG**:`lint → test → build`(web 加 `e2e-web`;credentialed 另立 `verify`)。stage 间 `needs` 硬边界 + artifact 流动,不在一个 job 里 `&&` 串。
2. **build-once 是 artifact 契约**,不是约定。deploy 只**消费+校验**,缺失即红、不回落重建。
3. **artifact 信任根上移到 GitHub 平台**:`actions/attest-build-provenance`(SLSA Build L2)+ 自建 meta.json 并存;镜像**按 digest 部署**,tag 只做人类可读别名。
4. **依赖图只驱动 push 侧 paths 的 codegen**,不决定"跑不跑";turbo 不引入(量化论证见 §依赖图)。
5. **merge queue(#671)是本设计的硬前置**,不是并行议题:required context 必须在 `merge_group` 事件下产生,否则启用队列 = 永久阻塞。
6. **可机检的运维不变量再加三条**:每个 job 必须有 `timeout-minutes`、每个 workflow 必须有顶层 `permissions`、每条 pipeline 必须有 `concurrency` —— 无则 meta-check 红。

## v1/v2 保留项(不重复论证)

gate 层整层删除 · required checks 落在真 job 名上(方案 C)· deploy 独立 workflow 不挂 CI `needs` · `pipeline-quality` 无 filter 做不动点 · `reusable-*`/`pipeline-*`/`deploy-*` 命名 · ruleset 并集法换名零空窗 · #691/#692 的结构解 · hermetic vs credentialed 的 required 边界 · artifact 契约表 7 类产物 · deploy 只认 `push: main` 的 run · turbo 否决的量化论证 · meta-check 不变量族。

## 现状实测(2026-08-03)

| 项 | 实测值 |
|---|---|
| workflow 文件 / 带 `runs-on` 的 job | 15 / 40 |
| 有 `timeout-minutes` 的 job | **2**(仅 `purge-anonymous-sessions.yml`、`purge-anon-quota-counts.yml`)⇒ **38/40 = 95% 无超时** |
| 有 `concurrency` 的 workflow | 4/15(`ci`、`agent-eval-nightly`、两个 purge) |
| 有顶层 `permissions` 的 workflow | 13/15,缺 **`codeql.yml`、`dependabot-agent.yml`** |
| ruleset required contexts | **7 个**(`Web CI`/`Backend CI`/`Agent CI`/`Infra & DB CI`/`Cross-stack E2E`/`Repository Quality`/`Codecov Patch`)—— **v1/v2 写的 "11" 是错的** |
| ruleset 其它 | `strict_required_status_checks_policy: true`、`allowed_merge_methods: ["rebase"]`、`required_approving_review_count: 0`、`required_linear_history` |
| merge queue | GraphQL `repository.mergeQueue == null` ⇒ **今天未启用** |
| `actionlint` | **已存在**(`_security.yml:125`,v1.7.7,curl 下载 tar)—— 评审"缺席"判断有误,改为**归位 + 补 SHA 校验** |
| `actions/cache` 全仓用量 | **2 处**,均在 `_security.yml:105/120`(zizmor restore + main-only save) |
| pnpm / uv 缓存 | setup-node `cache: pnpm`(key=`pnpm-lock.yaml`)、setup-uv v9 `prune-cache: true` |
| Playwright | `@playwright/test ^1.61.1`;`install --with-deps chromium` 在 2 处**每次全量下载,零缓存** |
| 容器镜像 | `wrangler.toml:128 / 216 / 338`(default/production/staging **三处**)`image = "./Dockerfile"` ⇒ deploy 时构建(v2 写"两处 / :135,:222"已修正) |
| `CLOUDFLARE_API_TOKEN` | **repo secret 与 staging/production environment secret 同时存在** ⇒ 待办是**删 repo 级**,不是新建 env 级 |
| artifact retention | `GET /actions/permissions` 只回 `{enabled, allowed_actions, sha_pinning_required:false}`,**无 retention 字段、无 repo 级 REST 端点** ⇒ 只能 owner 去 Settings 看 |

## 阶段模型 · 超时 · concurrency

| stage | 内容 | 目标耗时 | `timeout-minutes` | required |
|---|---|---|---|---|
| `lint` | oxlint/ruff + tsc/ty(hermetic) | <90s | **5** | ✅ |
| `test` | 单测 + hermetic 集成 + coverage | <5min | **12** | ✅ |
| `build` | 产出可部署 artifact + attest | <4min | **15**(含镜像构建) | ✅ |
| `e2e-web` | 消费 build artifact 跑浏览器 AC | <6min | **20** | ✅ |
| `verify` | credentialed(Neon/pulumi/eval-smoke) | — | **30** | ❌ 禁入 |
| `deploy-*` | 部署 | — | **20** | n/a |

超时取值规则:**目标耗时 ×2,向上取整到 5 的倍数,下限 5**(留 runner 冷启动 + 缓存 miss 的余量;比目标紧会把缓存 miss 误判成故障)。

concurrency group 命名规则(全仓唯一,meta 可派生):

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.head_ref || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

- PR 侧 `cancel-in-progress: true`(连推即取消旧 run);`push: main` / `merge_group` / `deploy-*` 一律 **false**(取消队列内 run = 队列卡死;取消部署 = 半部署态)。
- `github.workflow` 天然按 pipeline 隔离,9 条 pipeline 互不抢占;`merge_group.head_ref` 保证同一 PR 的 PR-run 与队列 run **不同组**(同组会互相取消)。

新增 meta-check(`pipeline-quality / meta`,全部 fail-fast 红):

| 断言 | 规则 |
|---|---|
| `assert-every-job-has-timeout` | 解析全部 `.github/workflows/*.yml`,任一含 `runs-on` 的 job 缺 `timeout-minutes` ⇒ 红 |
| `assert-workflow-default-permissions` | 每个 workflow 必须有顶层 `permissions:` 块(最小 `contents: read`)⇒ 覆盖今天缺的 `codeql.yml`/`dependabot-agent.yml` |
| `assert-concurrency-present` | 每条 `pipeline-*.yml`/`deploy-*.yml` 必须声明 `concurrency`,且 group 表达式逐字等于上面的模板 |
| `assert-merge-group-trigger` | 每个产出 required context 的 workflow 必须含 `on: merge_group`(见下节) |

## merge queue(#671)× required check 的事件矩阵

**失效模式**:required context 若不能在 `merge_group` 事件下产生,PR 进队后队列等一个永不出现的 check ⇒ 永久阻塞、需人工解队。26 个 stage 级 context 把这个风险放大 26 倍。

| workflow 类 | `pull_request` | `merge_group` | `push: main` | `schedule` | 说明 |
|---|---|---|---|---|---|
| `pipeline-*`(9 条,hermetic) | ✅ 无 paths 过滤 | ✅ **必须**,`branches: [main]` | ✅ 带 codegen paths | — | PR 侧与队列侧行为必须逐字一致 |
| `pipeline-quality` | ✅ | ✅ | ✅ | — | 不动点,永远无过滤 |
| `verify`(credentialed) | ❌(fork 无 secret) | ❌ | ✅ | — | 非 required,不入队列语义 |
| `deploy-*` | ❌ | ❌ | ✅ | — | 队列合并落 main 后由 push 触发 |
| `agent-eval-nightly` / purge | ❌ | ❌ | ❌ | ✅ | 与 required set 无关 |

**关键平台约束**:`on: merge_group` **只支持 `branches` 过滤,不支持 `paths`**。这与 v1「PR 侧不做 paths 过滤」的决定天然相容 —— 队列侧同样全量跑,PR 绿 = 队列绿,无第二套语义。(此条列入下面的 pre-flight 逐项实测。)

**启用前检查清单(#671 拍板前逐条打勾,任一未过不得开队列)**:

1. `pipeline-*.yml` 9 条全部含 `on: merge_group: branches: [main]`,且 `merge_group` 与 `pull_request` 走同一 `reusable-stage-*.yml`(避免两套逻辑漂移)。
2. `ruleset-sync.sh --check` 在 merge_group 名义下派生的 context 名与 PR 名义下**逐字相同**(job name 不含事件相关表达式)。
3. 关闭 `strict_required_status_checks_policy`(现为 `true`):队列本身就在合并结果上跑 check,"require branches up to date" 与队列语义重复且会制造多余 rerun。
4. `allowed_merge_methods` 现为 `["rebase"]` —— 与 `required_linear_history` 一致,队列 merge method 必须同选 rebase。
5. **SHA 语义实测**:`merge_group` 下 `github.sha` = 队列临时合并提交,`github.event.merge_group.head_sha` = PR 头。artifact 命名与 deploy 侧 `gh run list --commit` 的绑定 SHA 必须取**最终落 main 的那个**;rebase 队列下二者是否相等**必须实测一次**(不等则 deploy 查不到 artifact run ⇒ 全红)。
6. 缓存 save 的 `github.event_name == 'push'` 守卫在 merge_group 下自动为假 —— 已是期望行为,无需改,但写进注释防后人"修复"。
7. 首次开队列先只挂 `pipeline-quality` 一个 context 跑 3 个 PR,确认不卡,再并集法加满 26 个。

## required set:逐 stage 26 个,以及被否决的标准解

**承认标准解存在**:业界主流是「每 pipeline 一个 `if: always()` 汇总 job,显式断言 `needs.*.result == 'success'`」,ruleset 只挂 ~9 个 context,merge-queue 友好,断言写对后对 skip 同样免疫。**这是被否决的标准解,不是不存在的解。**

**否决理由(诚实版)**:不是"业界没有",而是 ①#691 的病因正是"把判定藏进 job 内部表达式" —— 汇总 job 把 26 个 stage 的通过与否压缩成一条手写布尔表达式,漏写一个 `needs` 就静默放行,与 #691 同族;②该表达式无法被外部机检(ruleset 只看 context 名,看不到断言内容),而逐 stage 方案的正确性由 `needs-closure-subset-of-required` **可机检**;③本仓库刚吃过两次"表达式写错 = 静默绿"的亏,信任预算已用尽。代价是 ruleset 条目从 7 涨到 ≈26,由 `ruleset-sync.sh` 机器维护,人不手改。

## 缓存策略(v3 新增整节)

拆 stage 后 install 次数 ×3~4,缓存从优化变成时长预算的前提。

| 缓存 | 键 | 失效边界 | 读写模式 |
|---|---|---|---|
| pnpm store | 现有 setup-node `cache: pnpm`,key=`pnpm-lock.yaml` | lockfile 变更 | 读写(见下面安全边界) |
| uv | setup-uv v9 内建,key=`uv.lock` | lockfile 变更 | 读写 |
| **Playwright browsers**(新) | `playwright-${{ runner.os }}-1.61.1`(版本从 `e2e/package.json` 读出,不手写) | `@playwright/test` 版本号 | 读写;命中则跳过 `install --with-deps`,miss 才装 |
| **Docker layer**(新) | `docker/build-push-action` + `cache-from/to: type=gha,mode=max` | `Dockerfile` + `uv.lock` + `apps/agent/**` | **restore-only + main-only save** |
| zizmor 审计缓存 | 已落地:`zizmor-${{ runner.os }}-${{ hashFiles('.github/workflows/*.yml','.github/actions/**') }}` | 任一 workflow/action 变更 | restore-only + main-only save |

**通用规则(从 `fix/zizmor-cache` 的实测提炼,写进模板注释)**:

> 凡其产物能到达 release/deploy 路径的 workflow,**只允许 `actions/cache/restore`**;`actions/cache/save` 必须带 `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`。理由:zizmor 的 cache-poisoning 审计会拒绝这类 workflow 里的读写 cache —— fork PR 能写共享 cache 就能污染发布物。restore-only 保留全部提速,写权限只留给可信的 main 分支 run。

边界说明:zizmor 的启发式按"是否有 release/tag/publish 触发"判定。`pipeline-*.yml`(`pull_request`/`merge_group`/`push`)今天不触发该审计,故 pnpm/uv 的内建读写缓存可留;**一旦 build stage 挂上 attestation/镜像推送而被判为 release-reach,立刻按上述规则降级**,不得用 `# zizmor: ignore` 抑制(仓库禁 suppression)。`deploy-*.yml` 一律**零 cache**。

lint stage 若要守 90s,评估 `pnpm install --filter <pkg>...` 局部安装(实测项,不达标则放宽 lint 目标到 120s / timeout 5min 不变)。

## artifact 出处证明与镜像 digest

**attestation(新增,SLSA Build L2)**:每个 `build` stage 在上传前加一步 `actions/attest-build-provenance`(bundle 用 `subject-path`,镜像用 `subject-digest`),job 加 `permissions: { id-token: write, attestations: write, contents: read }`;deploy 侧 `gh attestation verify <artifact> --repo <owner>/<repo>` 通过才继续。

**信任根差异(必须写清)**:自建 `.artifact-meta.json` 的签发者是**写它的那个 workflow 自己** —— 能改 workflow 的人就能改 meta,防的是"手滑/漂移",不是"篡改"。attestation 的签发者是 **GitHub 的 OIDC + Sigstore 透明日志**,workflow 作者伪造不了,防的是"产物被替换"。**二者并存**:meta.json 继续承担 commit 绑定与文件级 sha256 的自检(缺失即红,不回落),attestation 承担外部可验证的出处。不上 slsa-github-generator 冲 **L3**:L3 要求隔离的、非作者可控的构建服务,收益是"防仓库管理员本人",本仓单人、无多方信任需求 ⇒ **L2 + digest 是本项目的合理停点(已考虑,主动放弃)**。

**镜像按 digest 部署(单向切换)**:v2 只把 digest 记进 deployment record —— 记录 ≠ 约束,tag 仍可变。v3 改为 `wrangler.toml` 的 `image` 逐字引用 digest,prod/staging 一致性从"事后比对"变成"构造性成立"。

平台事实(Cloudflare 官方文档实测):CF Containers 支持的镜像来源是 **`registry.cloudflare.com`、Docker Hub、Amazon ECR、Google Artifact Registry** —— **GHCR 不在列**,故评审"安全维度倾向 GHCR"对**容器镜像不可行**(GHCR 仍可用于非容器产物)。官方全部示例均为 `<ref>:<TAG>` 形式,**未见 `@sha256:` digest 示例**。

⇒ **spike(阻塞 5.5 步)**:①`image = "registry.cloudflare.com/<acct>/animichi-agent@sha256:<digest>"` 是否被 wrangler 接受并成功拉取;②不接受时的退路 = **不可变 tag 约定**(`sha-<40位>` 永不覆写)+ deploy 前 `wrangler containers images list` 解析 digest 并与 attestation subject 比对,不一致即红(弱一档,但仍构造性阻断)。③`wrangler containers build -p -t sha-<sha>` 在 CI 里推送、`wrangler deploy` 不重建 —— 与 `--no-bundle` spike(5.6)同一个 PR 验。

## 权限与凭证收敛

| 项 | v3 规则 |
|---|---|
| workflow 顶层默认 | 每个 workflow 必须写 `permissions: { contents: read }`(或更小),job 级按需加 —— 由 `assert-workflow-default-permissions` 机检,覆盖今天缺的 2 个文件 |
| `build` stage | `+ id-token: write, attestations: write` |
| `resolve-artifacts` | `actions: read, contents: read`(跨 run 下载的最小集) |
| CF token | **删除 repo 级 `CLOUDFLARE_API_TOKEN`**,只保留 staging/production environment secret(两者今天并存;job 已声明 `environment:`,env 级会覆盖,删 repo 级零风险且封死"忘写 environment 就拿到 prod token"的面) |
| reusable workflow | 显式 `secrets:` 传参,**禁 `secrets: inherit`** |
| OIDC | **Cloudflare API 不支持 GHA OIDC 联邦(无官方 audience)⇒ 长期 token 是平台约束,不是本设计的缺陷。**能做的收敛只有:environment 作用域 + production 环境的 reviewer 保护 + 定期轮换 |
| 触发面 | hermetic pipeline 一律 `pull_request`(禁 `pull_request_target`),写成 meta 断言 |
| 免费加固 | `actions/permissions` 实测 `sha_pinning_required: false`,而仓库已 100% SHA-pin ⇒ **打开该开关零成本**(顺手项) |

**actionlint 归位**:zizmor 管安全不管语法(表达式拼写、shellcheck、`needs` 引用错)。actionlint **已在 `_security.yml:125`**,v3 只做三件事:①随 `_security.yml` 整体迁入 `pipeline-quality / static`,与 zizmor 并列为两个独立 required context;②当前用 curl 下载 tar **未校验 checksum**,改为 pin 版本 + `sha256sum -c`;③新增 26 个 stage job 后,actionlint 是唯一能抓 `needs:` 拼写错的工具 —— 它红 = 阻塞,不得降级为 warning。

**changesets/changelog 明确不做**:持续部署、无版本化发布物、无外部消费者、单人仓 ⇒ changesets 的收益(变更聚合 + 版本协商)在此处无接收方。写在这里以免下轮评审重问。

## 落地顺序(ROI 降序,吸收评审 7 步)

| # | 内容 | 估时 | 备注 |
|---|---|---|---|
| 1 | `timeout-minutes` + `concurrency` + 顶层 `permissions` 三件套 + 三条 meta 断言 | 半天 | 模板级,立刻覆盖 38/40 个裸奔 job;**独立于其余全部改动,可先合** |
| 2 | Playwright browser 缓存 + actionlint 归位/校验和 + 删 repo 级 CF token + 打开 `sha_pinning_required` | 半天 | 每 PR 都省;无架构耦合 |
| 3 | 阶段拆分 spike(v2 步骤 1.5),同期移除 `ci.yml:67` 的 `dorny/paths-filter` | 2 天 | 先量真实 stage 耗时,校准第 1 步的 timeout |
| 4 | artifact 契约 + `attest-build-provenance` **同一个 PR 落地** | 2 天 | 分两期会让 meta.json 先固化成事实标准 |
| 5 | 镜像 digest 化(并入 5.5)+ `--no-bundle` spike(5.6) | 2 天 | 单向切换,先在 staging 真部署一次 |
| 6 | merge-group 触发 + 启用前 7 项检查清单 | 1 天 | **#671 拍板前必须完成**,阻塞项 |
| 7 | Docker layer 缓存(restore-only)、SBOM(`buildx --sbom`)、Logfire CI 指标 | 收尾 | flake 判定数据源 = junit retry 记录 |

## 待 owner 裁决

1. required set **7 → ≈26**(机器维护)—— 接受否?退化选项(每 pipeline 只留 `lint` + 终端 stage)会重开"skipped 判过"的缝。
2. **artifact retention 当前值:REST API 不暴露,需 owner 亲自去 Settings → Actions → Artifact and log retention 读数并回填**。若 <14 天,契约表的保留期不成立。(评审建议 PR 侧 14d→7d 省配额,一并定。)
3. 容器 registry:GHCR 已被平台事实排除 ⇒ 在 **CF managed registry**(零额外凭证,`wrangler containers push`)与 **GAR/ECR**(多一个凭证面)间选。默认建议 CF managed。
4. **`image` → digest 是单向切换**:改回 `./Dockerfile` 需重推镜像并重新部署,无平滑回滚。批准单独一个 PR、staging 先跑通再合?
5. 5.6 `--no-bundle` spike 失败时,是否接受降级到"重建 + bundle sha256 比对"。
6. #671 merge queue 与本设计**同车**(推荐:第 6 步与 #671 拍板绑定),还是先冻结 required set 再开队列?
7. v1 遗留 4 条(contract/quality 两条 delta、方案 C、`pipeline-maintenance` 依赖 #692)**未撤销**,仍待签核。

---
**v2→v3 变更说明**
① 落实评审 7 条 [必须修改]:新增 merge_group 事件矩阵 + 7 项启用前检查清单、每 stage `timeout-minutes`/`concurrency` 规则 + 三条 meta 断言、`attest-build-provenance`(L2,含与自建 meta.json 的信任根对比)、镜像按 digest 部署 + spike 与退路、**缓存策略整节**(含从 `fix/zizmor-cache` 提炼的 restore-only + main-only save 通用规则)、actionlint 归位、CF token 收敛到 environment secret + 顶层默认 `permissions`。
② 修正 v2 的三处事实错误:required contexts 是 **7 个非 11**;`wrangler.toml` 的 `image = "./Dockerfile"` 是 **三处(128/216/338)非两处**;actionlint **已存在**(评审"缺席"亦有误)。新增实测:95% 的 job 无超时、CF token repo+env 并存、merge queue 未启用、retention 无 REST 端点、**GHCR 不被 CF Containers 支持**(推翻评审的 GHCR 建议)。
③ 补齐评审要求的显式表态:承认"汇总 job"是**被否决的标准解**并给出否决理由(#691 同族 + 不可机检);写明 Cloudflare 不支持 GHA OIDC 联邦 ⇒ 长期 token 是平台约束;写明 SLSA L3 与 changesets 在单人仓不适用的理由。
