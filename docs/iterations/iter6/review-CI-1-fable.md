# CI-1 v2 评审 — Fable 席(独立)2026-08-03

依据实测:repo 已有 SHA-pin(全部 `uses:` 带 40 位 SHA+版本注释)、zizmor(`_security.yml:78`)、dependabot.yml、pnpm 缓存(`.github/actions/setup` 经 setup-node `cache: pnpm`)、uv 缓存(setup-uv v9);**全 repo 仅 2 个 cron workflow 有 `timeout-minutes`**,Playwright 每次 `install --with-deps`,actionlint 缺席。

## 1. 阶段模型

- [可接受] `lint→test→build(→e2e-web)` + `needs` 硬边界符合 GHA 成熟范式;`prepare/package` 独立 stage 在 7 包 3 依赖边规模下是过度仪式,不设是对的。`verify` 与 hermetic 的隔离(secrets 禁入 required)做对了,这正是 GitHub fork-PR hardening 的推荐切法。
- [建议] required 26 个逐 stage vs 业界主流的「每 pipeline 一个 `if: always()` 汇总 job 显式断言 `needs.*.result == 'success'`」:后者 ruleset 只挂 ~9 个 check、merge-queue 友好,且写对断言后对 skip 同样免疫。v2 因 #691 创伤选逐 stage + 脚本同步,soundness 论证成立,可接受;但请在文中承认汇总 job 是**被否决的标准解而非不存在的解**——否决理由应是「不再信任 needs 语义」而非「业界没有」。
- [必须修改] **merge queue(#671)与 26 个 required check 的交互未提**:一旦启用 merge queue,所有 required context 必须在 `merge_group` 事件上产生,否则队列永久阻塞。9 条 pipeline 都要加 `on: merge_group` 或明确 #671 与本设计互斥先后。这是已知裁决项的硬依赖,不能留白。
- [必须修改] 9 个新 workflow 各自需要 `concurrency: { group: pipeline-<pkg>-${{ github.ref }}, cancel-in-progress: <PR侧 true> }` 与每 job `timeout-minutes`(现状全仓几乎为零)。stage 表里已写目标耗时,直接落成 timeout(目标×2)。GitHub hardening 指南与 well-architected workflow 基线双双要求。
- [建议] 9 份 pipeline YAML 会复制同一 stage 骨架 → 用 `reusable-stage-*.yml` 承载 lint/test/build 逻辑、pipeline 文件只留触发+paths+参数,防 9 处漂移(v1 命名已预留 `reusable-*`,用起来)。

## 2. artifact 契约(SLSA 差距)

- [可接受] meta.json + sha256 + commit 绑定 + 缺失即红不回落:自建校验做得扎实,「回落开关会在最需要时失效」的判断正确。
- [必须修改] **缺 GitHub 原生 attestation**:`actions/attest-build-provenance` 对 bundle/镜像各加 1 step,deploy 侧 `gh attestation verify`,即达 **SLSA Build L2**(hosted runner + 平台签名,底层就是 sigstore)。自建 meta.json 的信任根是「写它的 workflow 自己」,attestation 的信任根是 GitHub 平台——这正是 owner 要的 best practice,且成本≈零。需要 `permissions: id-token: write, attestations: write`。
- [必须修改] **镜像按 digest 部署,不按 tag**:v2 只「记录」digest 进 deployment record,但 `wrangler.toml` 仍引用 tag——tag 可变,记录≠约束。build 后解析 `sha-<sha>` → digest,deploy 逐字引用 `@sha256:…`。prod/staging digest 一致性检查随之从「事后比对」变「构造性成立」。
- [建议] SBOM:镜像用 `docker buildx --sbom=true`(或 anchore/sbom-action)、attest 为 SBOM attestation;JS 侧 pnpm lockfile 已是事实 SBOM,不必另造。
- [可接受] 不上 slsa-github-generator 冲 L3:solo 项目、无多方信任需求,L2+digest 是本项目的合理停点——但把这句判断写进文档,别留「没考虑过」的观感。
- [建议] 保留期:PR 14d 偏长(排障窗口实际 ≤3d),PR 侧 7d 可省配额;Playwright 7d 合理。

## 3. 依赖图/触发

- [可接受,做对了] 三方案对比诚实;turbo 否决理由(3 条边、6/7 无 build、fork 拿不到远程缓存 token)+ 量化重开条件,是模范级 honest evaluation。dorny/paths-filter 因 #691 否决也成立——注意 **repo 现状 ci.yml:67 还在用它**,迁移步骤里应有「移除 dorny」的显式项。
- [可接受] codegen paths 提交进仓 + meta 双向断言:业界无此成品工具,但「生成静态配置+CI 断言不漂移」与 GitHub 官方对 `paths` 静态性的约束相容,比运行时 filter 更符合本仓库的失效历史。
- [建议] `derive-paths.mjs` 的全局项要断言完整:`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.github/actions/**`、`.github/scripts/**`、各包 `package.json` 必须进每条相关 pipeline 的 paths;extraPaths 表本身要有测试(改表忘 regen 也得红)。

## 4. 缓存策略(v2 整节缺失 → [必须修改])

拆 stage 后 install 次数 ×3~4,缓存从锦上添花变成时长预算的前提。文档必须补一节:
- pnpm store:已有(setup-node `cache: pnpm`,key=pnpm-lock.yaml)——写明沿用即可;
- uv:已有(setup-uv 内建,key=uv.lock)——沿用;
- **Playwright browsers:现状每次全量下载**。`actions/cache` path `~/.cache/ms-playwright`,key=`playwright-${{ runner.os }}-<@playwright/test 版本>`,miss 才 `install --with-deps`(Playwright 官方 CI 文档的标准做法),`e2e-web` 与 quality/e2e 两处受益;
- **Docker layer**:镜像改在 CI 构建后,`docker/build-push-action` + `cache-from/to: type=gha,mode=max`(或 registry cache)。失效边界=Dockerfile+uv.lock;
- lint stage 若只跑 oxlint/ruff+tsc,评估 `pnpm install --filter` 局部安装以守 90s 目标。

## 5. 安全与权限

- [可接受,做对了] SHA-pin 全覆盖、per-job permissions、zizmor 在库、`resolve-artifacts` 最小权限、deploy 只认 `push: main` 的 run + commit/repo 绑定——最后一条正好封死 GHSA 反复告警的 artifact-poisoning 面。
- [可接受] OIDC:Cloudflare API 不支持 GHA OIDC 联邦(无官方 audience),长期 token 是平台约束非设计缺陷——但 [必须修改] token 必须放 **environment secret**(production 环境带 reviewer 保护),不能是 repo secret;文档应写明这条边界与理由。
- [建议] registry 裁决(待裁决 3)安全维度倾向 **GHCR**:`GITHUB_TOKEN` 的 `packages: write` 即推即拉,零长期凭证;CF managed registry 则多一个 token 面。
- [建议] reusable workflow 用显式 `secrets:` 传递,禁 `secrets: inherit`(GitHub hardening 指南);hermetic pipeline 全部仅 `on: pull_request`(非 `pull_request_target`)——现状如此,新架构写成 meta 断言。
- [必须修改] workflow 级默认 `permissions: {}` 或 `contents: read`,job 级按需加——26 个 job 手写易漏,并入 zizmor 已查的项即可,但 pipeline-*.yml 模板要带默认块。

## 6. 可观测性

- [可接受,做对了] junit→job summary、`if: failure()` 传全量 trace、非空 testsuite 断言(直接治「rtk 伪绿」教训)——把今天 zero-artifact 的实测痛点全部覆盖。
- [建议] CI 指标:repo 已有 Logfire,用 OTel CI 导出(如 `otel-cicd-action`)或每周 scheduled job 拉 `gh api runs` 算时长/失败率/flake 率进 Logfire dashboard——比引入第三方 CI 分析 SaaS 更贴本仓库既有栈。flake 判定数据源=junit 里的 retry 记录,Playwright `retries` 配置需同步声明。
- [建议] oxlint/ruff 输出接 GitHub problem matcher / SARIF,红时 PR 内联 annotation,省一次点进日志。

## 7. 遗漏项清单

- [必须修改] `actionlint` 缺席:zizmor 管安全不管正确性(表达式拼写、shellcheck、needs 引用错)。加进 `pipeline-quality / static`,与 zizmor 并列。
- [必须修改] concurrency + timeout-minutes(见 §1)。
- [可接受] changelog/changesets 不做:持续部署、无版本化发布物、solo 仓,changesets 无消费者——理由成立,建议在文档写一句免得下轮评审再问。
- [可接受] dependabot 已有;确认 `github-actions` ecosystem 覆盖新增 action(attest/build-push/cache)即可。
- [建议] matrix:4 条无差别 Worker pipeline(users/edge/maintenance/catalog-hermetic 部分)可在 reusable-stage 内用 matrix 参数化,但 required check 名要稳定(`pipeline-users / build` 形态),msg:matrix 展开名含参数,验证 ruleset-sync 派生逻辑能处理再用。
- [做对了] meta-check 自覆盖面(ruleset-sync --check、paths-match-dependency-graph、needs-closure-subset-of-required、assert-tests-are-unfiltered)是本稿最强的部分,业界罕见有人把 CI 的不变量写成机检。

## 总评

**若全部采纳**:九条 per-package stage-DAG pipeline(lint/test/build/e2e,reusable-stage 骨架 + codegen paths + 机检不变量),build 产物经 GitHub 原生 attestation 签名、按 digest 单向流入 deploy,凭证收敛到 environment secrets,全链 concurrency/timeout/缓存齐备,指标进 Logfire——SLSA L2、GitHub hardening 清单全绿的单人仓 CI。

**落地顺序(投入产出比降序)**:
1. timeout-minutes + concurrency + workflow 默认 permissions(半天,模板级);
2. Playwright browser 缓存 + actionlint(半天,每 PR 都省);
3. 阶段拆分 spike(v2 步骤 1.5,原案);
4. artifact 契约 + attest-build-provenance 一起落(增量一个 step,别分两期);
5. digest 化镜像引用(并入 v2 步骤 5.5,同一个 PR);
6. merge-group 触发裁决(在 #671 拍板前完成,阻塞项);
7. Docker layer 缓存、SBOM、Logfire CI 指标(收尾)。
