# 实测 — CI-1 第 3 步:web pipeline 阶段拆分

立于 2026-08-03。这份文件回答设计稿 `design-CI-1-pipeline-refactor.md` 留下的实证问题:
**把单个 Web CI job 拆成多个阶段,到底快不快?**

数据源:`main` 上一次成功的 `ci.yml` run(`30808763707`)的 step 级时间戳,
经 `actions/runs/<id>/jobs` 取得,非本地估算。

## 基线:现在的单 job(`_webapp-ci.yml`)

`Web component CI / Web app CI`,11:22:23 → 11:26:04,**总计 221s**。

| step | 耗时 |
|---|---|
| Set up job + checkout | 4s |
| `./.github/actions/setup` | 17s |
| Build + output-layout integration test | 34s |
| Type check (tsc) | 3s |
| Oxlint(type-aware) | 5s |
| **Unit tests(vitest + coverage)** | **118s** |
| Upload coverage | 5s |
| Install Playwright browser | 23s |
| Browser test(branded 404) | 8s |
| Post steps | 2s |

两个事实决定了后面的结论:

1. **单 step 主导**:vitest 一个 step 占 118s,是整个 job 的 53%。任何不动它的拆分都只能在剩下 47% 里腾挪。
2. **固定开销 ≈23s/job**:Set up job + checkout + setup + post。每多一个 job 就多付一次。

## 三个阶段互相独立(实测,非推断)

拆分的前提是阶段之间没有隐藏依赖。`apps/web/src/routeTree.gen.ts` 是 gitignored 的生成物,
`_webapp-ci.yml` 的注释因此声明"build 必须先跑"。实测下来这个约束**不成立**:

- `pnpm --filter web typecheck` 本身就是 `pnpm run routes:generate && tsc --noEmit`,自己生成路由树。
  删掉生成物后从零跑,typecheck 与 oxlint 均 exit 0。
- `pnpm --filter web test` 在没有 `.output`、没有 `routeTree.gen.ts` 的状态下,
  215 个测试文件 / 1608 个测试全过,exit 0。

所以 lint / test / build 三者可以任意并发。

## 结论:串行拆分更慢,并行拆分才快

| 方案 | 墙钟 | 相对基线 | runner 分钟 |
|---|---|---|---|
| 基线(单 job) | 221s | — | 1.0× |
| **串行拆分**(`needs` 链) | **≈302s** | **慢 37%** | 1.3× |
| **并行拆分**(无 `needs`) | **≈146s** | **快 34%** | 1.4× |

串行方案(spike 最初的写法,lint → test → build 用 `needs` 串起来)之所以更慢,
是因为它把本来就串行的东西又串了一遍,同时多付两次 23s 固定开销、并新增一趟
artifact 往返(打包 + 上传 + 下载 + 校验),却完全没有碰 118s 的 vitest。

并行方案的墙钟由最慢的那个 job 决定:

- lint = 23(开销)+ 3(tsc)+ 5(oxlint) ≈ **31s**
- **test = 23 + 118(vitest)+ 5(coverage) ≈ 146s ← 关键路径**
- build = 23 + 34(build)+ ~15(artifact 往返)+ 23(playwright)+ 8(browser) ≈ **103s**

代价是 runner 分钟约 1.4×。快 34% 换多花 40% 机器时间,在这个规模上值得:
Web 是耗时最长的组件,PR 上的等待直接体现为人的等待。

## 下一步不该做的事

**不要指望继续拆能继续快。** 关键路径现在是 vitest 那 118s,再拆阶段无法触及它。
真要往下压,唯一有意义的方向是把 vitest 本身分片(`--shard`)并发,
那是独立的一张卡,收益与 runner 成本要重新测,不在本卡范围内。

## 落地方式

按设计稿的并存流程,不做原地替换:

1. **本 PR**:`pipeline-web.yml` 与现有的 `_webapp-ci.yml` **同时运行**,PR 上会看到两套 Web 检查。
2. 观察若干次 run,确认新 pipeline 的三个 job 稳定绿、耗时符合上表。
3. ruleset 用并集法改必需检查:先加 `Web / lint`、`Web / test`、`Web / build` 三个新名字,
   验证通过后再移除 `Web component CI / Web app CI` —— 绝不先删后加,
   因为 `bypass_actors: []` 会让 Pending 永久卡住。
4. 最后从 `ci.yml` 摘掉对 `_webapp-ci.yml` 的调用并删除该文件。
