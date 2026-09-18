# 集成测试剖析:时间实际花在哪

测量人:Claude Opus(Orca task_de4bed688aa7)。只出数字,没有修任何东西。
旧报告 `integration-perf.md`(测于 `046c5ae90`,Prisma 切换之前)的所有数字作废;下面每个数都是从当前树重新测出来的。

---

## 1. 测量条件

| 项 | 值 |
|---|---|
| SHA | `6f084975e4ee51aca12798db6b9d7e459c874a75`(origin/main,`ci(repo): stop the schema-gate clock and union the pre-push closures (#1775)`),detached HEAD,`pnpm install --frozen-lockfile` 后测 |
| 日期 | 2026-09-18 16:51–17:22 CST |
| 主机 | macOS Darwin 25.5,10 核,24 GiB |
| Docker | colima `default`:aarch64,4 CPU,6 GiB;未重启 |
| 测试镜像 | `animichi-test-postgres:18-3.6-pgvector-0.8.5`,**amd64,在 aarch64 VM 上经 binfmt 仿真运行** |
| 容器 | 复用 `zen_davinci`(testcontainers 12.1.0,container-hash `d1fae3bb…`,2026-09-16 起常驻);另有 `hungry_wilbur`(testcontainers 12.0.4 的旧 hash,空闲)和 5 个 `act-CI-*` 容器(0 % CPU,空闲) |
| 容器内既有库 | `native_host_5d4a9a703f11`、`native_host_ab93d5df4f73`、`verify_probe`、`postgres`——早于本次测量,是别的车道失败运行留下的;测完后库列表与测前完全一致 |
| 1 分钟 load(每次运行开始时) | 第 1 轮 2.07–3.04,第 2 轮 2.15–3.21,第 3 轮 2.27–4.70(第 3 轮 edge 前三个 suite 为 4.70/4.41/4.28,其 wall 与前两轮差 ≤ 0.11 s) |
| Node / pnpm | v24.18.0 / 12.4.2 |

**仿真说明(放在表头,不是脚注)。** Postgres 端的每一毫秒都是 qemu 仿真的 amd64;Node/pnpm/esbuild/workerd 是原生 arm64。我用一个一次性的原生 arm64 容器(`public.ecr.aws/supabase/postgres:17.6.1.106`,PG 17 + PostGIS 3.3.7)做了对照,在容器内用 psql `\timing`:

| 语句 | 原生 arm64 | 仿真 amd64(测试镜像,PG 18 + PostGIS 3.6.4) |
|---|---:|---:|
| `CREATE EXTENSION postgis` | 216 / 142 / 139 ms | 2018 / 2050 / 2040 ms |
| `CREATE DATABASE … TEMPLATE template1` | 23 / 15 / 14 ms | 94 / 95 / 99 ms |

版本不同,不能算严格的同条件对比;但量级差 10 倍以上。**本地 SQL 相关的数字会高估 CI 原生 runner 上的对应值**;本地 pre-push(`scripts/local-gates/pre-push-affected.sh`)跑在这台机器上,所以这些本地数字对 pre-push 是真实的。

**污染事件及处理。** 16:54:36 另一条车道(PID 70622,`pnpm -r --filter ...infra --filter ...edge-worker run test:integration`)启动,和我的 edge-host 第 1 轮最后 22 s、catalog 第 1 轮、migrator 第 1 轮重叠(共享同一容器和 `ChainApplyTurn` 的 1663 号 advisory lock)。这三组数据已隔离(`runs-contaminated.jsonl`,相关 phase 记录标为 `run: "x1"`),之后改用带"安静门"的 runner(`runner2.py`):每个 suite 开始前等外来测试进程清零,运行中每 2 s 按进程树区分我的和别人的进程并记录 load。重跑的 30 次运行中只有 edge-host 第 3 轮出现过一个外来形态的进程(`node --test-concurrency=0 --heap-prof-interval=524288 --test-timeout=0`,是 node 测试子进程的默认 execArgv 形态,很可能是本次运行中脱离进程树的子进程);这一轮 137.26 s,落在另两轮(135.55 / 139.51)之间,予以保留。

---

## 2. 修正后的清单

用例数取运行器自己报告的数字。"链 apply"指 `pnpm exec prisma db migrate` 对 `packages/pi-session-neon` 链的一次完整 apply。

| suite | 文件 | 用例(运行器) | `startTestPostgres` 调用/次运行 | `CREATE DATABASE`/次运行 | 链 apply/次运行 | 其中目标库**从未被读取** |
|---|---:|---:|---:|---:|---:|---:|
| `workers/edge` agent-db | 6 | 20 | 3 | 6 | 6 | 3 |
| `workers/edge` admission | 8 | 26 | 1 | 2 | 2 | 1 |
| `workers/edge` selection | 3 | 10 | 1 | 2 | 2 | 1 |
| `workers/edge` host-integration | 14 | 29 | 1 | 2 | 2 | 1 |
| `workers/catalog` | 25 | **139** | 1 | 2 | 1 | 1 |
| `workers/migrator` | 3 | 11 | 3 | **10** | 3 | 2 |
| `packages/agent` | 4 | 6 | **6** | 12 | 6 | 6 |
| `packages/test-postgres` | 2 | 7 | **8** | 8 | 8 | —(被测对象) |
| `packages/pi-session-neon` | **22**(16 db + 6 unit) | **155** | 1 | 2 + 测试内 | 2 + 测试内 | 1 |
| `packages/prisma-geography` | **10**(1 db + 9 unit) | **57** | 1 | 2 | 1 + 1 次 geography 自己的小链 | 1 |
| `apps/web` | 6 | **27** | 0 | 0 | 0 | — |

相对协调者那张表的更正:

- **catalog 用例** 130 → 139(运行器报 `Tests 139 passed`)。
- **agent `startTestPostgres`** 1 → 每次运行 6 次。调用点只有一个(`packages/agent/integration-test/catalog-postgres.ts:38`),但 `catalogPostgres(context)` 是每个测试各调一次,6 个测试就是 6 次。
- **test-postgres** 调用点确实是 6 个,但 `shared-container.test.ts:94` 在循环里调用,运行时是每次运行 8 次。
- **pi-session-neon / prisma-geography**:`test:integration` 把 `*.unit.test.ts` 也一起跑了(见各自 `package.json` 的 `test:integration`),文件和用例都要加上 unit 部分;pi-session-neon 的静态 grep 只数到 89 个 `test(`,运行器报 155,差额来自循环生成的测试。
- **web** 用例 25 → 27。
- **正则漏掉的**:链 apply 次数大约是 `startTestPostgres` 次数的两倍。edge 的每个 fixture、pi-session-neon、prisma-geography 在 `startTestPostgres`(给 plane 库 apply 一次)之后,都会**再建一个库、再 apply 一次**(`workers/edge/test/contract-database.ts:34-38`、`packages/pi-session-neon/test/postgres.ts:34-41`、`packages/prisma-geography/test/support/database.ts` 的 `openChainDatabase`),之后只用第二个库;plane 库只被当成"服务器句柄 + 管理 DSN"用。catalog 和 agent 在 plane 库上 apply 了完整 Prisma 链,测试却跑在另一个装 Drizzle 时代 schema 的库上。最后一列就是这些"apply 了但没人读"的次数:每次完整回归 17 次。

---

## 3. 各 suite 端到端(三次运行)

执行方式与 CI 一致:`pnpm --filter <pkg> run --if-present test:integration`(`.github/workflows/pr-verification.yml:241-243`)。edge 的 `test:integration` 是四个子脚本串联(`workers/edge/package.json`),我按子脚本分别跑,以便拿到分 suite 的数字;四者之和就是 edge 的 `test:integration`,另加三次 `pnpm run` 启动(`pnpm exec true` 实测约 45 ms/次)。

三轮全部通过,无失败、无跳过。edge-host、catalog、migrator 实际各跑了 4 次:第 1 次与外来车道重叠而作废(见第 1 节),统计只用其后的 3 次干净运行;其余 8 个 suite 各跑 3 次。

**口径:**
- **setup** = 一次性的准备:插桩测到的 `startTestPostgres` 全程、第二个库的建库与链 apply、扩展安装、Drizzle 时代 schema、种子数据、neon-proxy 容器、migrator 的 workerd 打包/启动、web 的生产构建。同一进程里并发的阶段按时间区间取并集(agent-db 的三个 fixture 是并发的)。migrator 在 `beforeEach` 里把 `Date` 换成假时钟(`prisma.integration.ts:25`),阶段的时间戳因此失真;该 suite 严格串行(`fileParallelism: false`),直接对阶段耗时求和。
- **assertion** = 运行器报告的测试耗时减去落在测试耗时里的 setup。node 运行器把顶层 `before` 钩子算进第一个测试(agent-db 第一个测试 16.8 s 就是这个原因),也把 `beforeEach` 算进各测试;vitest 的 `tests` 同样含 `beforeAll/beforeEach`,但 catalog/web 的 `globalSetup` 在 `tests` 之外。
- **其它** = wall − setup − assertion:pnpm、运行器启动、tsx/vitest 导入、agent 的两次 `tsc --noEmit`、pi-session-neon/prisma-geography 的覆盖率收集与报告。

| suite | wall 中位数 (s) | 三次范围 (s) | 用例 | setup (s) | assertion (s) | 其它 (s) | setup : assertion |
|---|---:|---|---:|---:|---:|---:|---:|
| edge agent-db | 20.48 | 20.37–21.65 | 20 | 15.45 | 2.88 | 2.2 | **5.4 : 1** |
| edge admission | 10.18 | 10.17–10.59 | 26 | 7.58 | 1.83 | 0.8 | 4.1 : 1 |
| edge selection | 10.19 | 10.18–10.33 | 10 | 7.50 | 1.26 | 1.4 | **6.0 : 1** |
| edge host-integration | 137.26 | 135.55–139.51 | 29 | 8.09 库 + 32.6 worker 启动 = **40.7** | 35.3(另 **60** s 真实时钟等待,见下) | 1.3 | 1.15 : 1 |
| catalog | 20.40 | 20.39–20.44 | 139 | 6.55 | 6.25 | 7.6 | 1.05 : 1 |
| migrator | 38.74 | 38.72–38.85 | 11 | 29.0 | 7.8 | 1.9 | 3.7 : 1 |
| agent | 61.27 | 61.16–65.27 | 6 | 41.26 | 13.93 | 6.1 | 3.0 : 1 |
| test-postgres | 32.64 | 32.62–32.74 | 7 | 30.43(即被测对象) | — | — | 不适用 |
| pi-session-neon | 61.11 | 59.12–61.22 | 155 | 7.72 | 45.24 | 8.2 | 0.17 : 1 |
| prisma-geography | 24.50 | 24.46–24.50 | 57 | 10.52 | 12.31 | 1.7 | 0.85 : 1 |
| web | 12.31 | 12.29–14.31 | 27 | 7.16(生产构建) | 5.94 | — | 1.2 : 1 |

**edge host-integration 的 137 s 拆开看**(worker 启动计时只在第 3 轮有,因为我在第 2 轮开跑后才加这个插桩;因此是单轮样本,共 29 个事件):

| 组成 | 秒 |
|---|---:|
| 数据库 setup(`startTestPostgres` + 第二个库) | 8.1 |
| 每个测试打包 worker:18 次 `pnpm exec wrangler deploy --dry-run`(中位数 0.86 s)+ 11 次 `bundleLikeWrangler`(中位数 0.92 s) | 25.6 |
| 每个测试启动 Miniflare(`worker.ready`,29 次,中位数 0.23–0.26 s) | 7.0 |
| 一个测试在等真实时钟:`recovery-endings.test.ts:49` 三轮分别 62.14 / 62.01 / 62.07 s。测试宿主把 SDK 重试写死为 `retry: { enabled: true, maxRetries: 1, baseDelayMs: 60_000 }`(`host-integration-test/business-host.worker.ts:131`),测试一直等到这个 60 s 的重试唤醒真正触发 | ≈ 60 |
| 其余断言 | ≈ 35 |

**合计**(11 个 suite 的中位数相加):wall **429.1 s**。
其中 setup **173.4 s**(不含 test-postgres),assertion **132.7 s**,真实时钟等待 **60 s**,test-postgres(被测对象本身就是 setup)32.6 s,运行器/其它约 30 s。
**总体 setup : assertion = 1.31 : 1。** 173 s 的 setup 里,133.7 s 跟数据库有关(减去 edge-host 的 worker 启动 32.6 s 和 web 构建 7.2 s);**光链 apply 就占 88.7 s**。

---

## 4. `startTestPostgres` 内部四个阶段

**插桩方式。** 临时在 `packages/test-postgres/src/` 加了 `phase-clock.ts`(`performance.now()` 计时,每个阶段往 `/private/tmp/animichi-research/phases.jsonl` 追加一行 JSONL;不写 stdout,避免被运行器吞掉),在 `test-postgres.ts` 里包住 `bootContainer`、两次 `awaitSessions`、`createCleanDatabase`、advisory lock 的等待、建角色、`applyPrismaChain`,并在同一包里导出 `timedPhase`,给第二个库的建库/apply(edge、pi-session-neon、prisma-geography)、Drizzle 时代 schema(catalog、agent)、neon-proxy 容器(agent)、扩展安装和 workerd(migrator)、web 构建、edge-host 的 worker 打包/Miniflare 启动都加了计时。完整 diff(14 个被改的已跟踪文件 + 1 个新文件,共 421 行)存于 `/private/tmp/animichi-research/instrumentation.diff`。

**已撤销:**

```
$ rm packages/test-postgres/src/phase-clock.ts && git checkout -- .
$ git status
HEAD detached at origin/main
nothing to commit, working tree clean
```

**每次调用的中位数(ms,本地,仿真 Postgres):**

| suite | ① 容器复用挂接 | ② 就绪探测(管理库 + 新库) | ③ `CREATE DATABASE` | 等锁 | 建服务角色 | ④ 链 apply | `startTestPostgres` 全程 | 每次运行付几次 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| edge agent-db | 296 | 73 + 51 | 157 | **3690** | 137 | 3600 | 8032 | 3 |
| edge admission | 130 | 41 + 49 | 130 | 35 | 128 | 3474 | 4006 | 1 |
| edge selection | 122 | 44 + 48 | 130 | 35 | 129 | 3434 | 3930 | 1 |
| edge host | 247 | 42 + 50 | 136 | 37 | 140 | 3672 | 4321 | 1 |
| catalog | 90 | 40 + 48 | 130 | 36 | 128 | 3520 | 3996 | 1 |
| migrator | 87 | 41 + 48 | 125 | 35 | 129 | 3440 | 3907 | 3 |
| agent | 91 | 41 + 48 | 128 | 35 | 129 | 3439 | 3917 | 6 |
| test-postgres | 99 | 39 + 49 | 134 | 36(并发用例里每次运行总等锁 21.6 s,这是有意测的并发) | 130 | 3452 | 4037 | 8 |
| pi-session-neon | 149 | 41 + 48 | 127 | 35 | 130 | 3457 | 4006 | 1 |
| prisma-geography | 95 | 41 + 48 | 128 | 35 | 128 | 3453 | 3935 | 1 |

`startTestPostgres` 之外的准备(中位数 ms):第二个库 `CREATE DATABASE` 125–138;第二次链 apply 3450–3634;Drizzle 时代 catalog 2436–2444;migrator 每个目标库装 4 个扩展 2206;geography 装 2 个扩展 2145、它自己的小链 753、种子 3553;agent 的 neon-proxy 容器 338。

结论:在**九次低争用调用**中,④ 链 apply 占 `startTestPostgres` 全程的 **85–88 %**(3 434–3 672 ms ÷ 3 907–4 321 ms;其余四项——容器复用挂接 + 就绪探测 + 建库 + 建角色——合计 378–405 ms)。第十次调用**不在这个区间内**:edge agent-db 是 3 600 ÷ 8 032 ms ≈ **45 %**,因为它的 3.7 s 等锁(三个 fixture 的 `before` 并发执行、在 `ChainApplyTurn` 上排队)占了这次调用的一半以上。报告先前的 86–90 % 既没有排除这次争用调用,两端也与上表任何一行都对不上。

本地测的是**复用挂接**(90–300 ms)。CI 每个 job 都是冷启动:先 `docker build` 镜像(`pr-verification.yml:222-229`),再跑容器的 initdb。这部分我在本地测不到,见第 7 节。

---

## 5. 链 apply 内部

在复用容器上单独做了微基准(`chainbench.py`):每次新建一个自己的库,只对这个库 `ALTER DATABASE … SET log_min_duration_statement = 0`(影响范围仅限我建的库,没有 `ALTER SYSTEM`,没有重启),在 `packages/pi-session-neon` 下执行和 fixture 完全相同的 `pnpm exec prisma db migrate --db <dsn> --json`,然后从 `docker logs` 读逐条语句耗时,最后删库。重复 3 次。

| 测量 | 3 次 (ms) |
|---|---|
| 完整 apply(空库) | 3634 / 3515 / 3457 |
| 同一库再 apply 一次(0 个待执行迁移:启动 + 加载配置/contract + 读 marker;其中服务器端 SQL 为 10 条、69 ms,所以纯启动 + 加载约 0.43 s) | 497 / 500 / 500 |
| `pnpm exec prisma --version` | 250 / 252 / 254 |
| 不经 pnpm 直接跑 `node_modules/.bin/prisma --version` | 215 / 209 / 211 |
| `pnpm exec true`(pnpm 本身) | 46 / 43 / 47 |
| `node -e 0` | 19 / 18 / 18 |
| 进程启动到第一条 SQL 到达服务器(主机时钟对 VM 时钟,误差约 ±50 ms) | 约 610 / 500 / 530 |
| 服务器端 SQL 时间合计(754 条日志项:parse/bind/execute/simple statement) | 2867 / 2902 / 2853 |

**进程启动 vs SQL:** 一次 3.5 s 的 apply ≈ 进程启动与配置加载 **约 0.5 s**(其中 pnpm 自身约 45 ms,纯 CLI 启动约 0.21 s,其余是加载 `prisma.config.ts`、contract 和 geography 扩展描述符)+ 服务器端 SQL **约 2.87 s** + 客户端往返间隙约 0.1 s。

**哪条语句占大头(3 次一致):**

| 语句 | 耗时 (ms) | 次数 | 占完整 apply |
|---|---:|---:|---:|
| `CREATE EXTENSION IF NOT EXISTS "postgis"` | 2002 / 2012 / 2007 | 1 | **≈ 57 %** |
| 18 条目录内省 `SELECT` | 133–140 | 18 | ≈ 4 % |
| `CREATE EXTENSION IF NOT EXISTS "vector"` | 65–68 | 1 | ≈ 2 % |
| information_schema 权限检查 `SELECT … array_agg(DISTINCT privilege_type …)` | 43–53 | 12 | ≈ 1 % |
| `information_schema.tables` 检查 | 41–42 | 9 | ≈ 1 % |
| `pg_constraint` 是否存在的 precheck | 35–36 | 108 | ≈ 1 % |
| 其余约 600 条 | 合计约 0.5 s | | |

和旧报告相比:postgis 仍然是最大的单条(约 2.0 s,旧值 2106 ms);apply 工具自身启动从约 900 ms 降到约 500 ms。**postgis 这 2.0 s 是仿真出来的**:原生 arm64 上约 140–216 ms(见第 1 节)。在 CI 原生 amd64 上,每次 apply 里 postgis 占的比例应该小得多,但 CI 上的数字我没有测。

---

## 6. 排名:每执行一个用例要付多少秒 setup

| 排名 | suite | setup (s) | 用例 | **setup 秒/用例** | 断言调用(静态) | setup 秒/断言调用 | 这些 setup 花在哪 |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | agent | 41.26 | 6 | **6.88** | 65 | 0.63 | 每个测试一套:`startTestPostgres`(3.9 s,其中链 apply 3.44 s 打在一个从不读的库上)+ Drizzle 时代库 2.44 s + neon-proxy 容器 0.34 s |
| 2 | test-postgres | 30.43 | 7 | 4.35 | 14 | 2.17 | 被测对象就是 setup;21.6 s 是有意的并发等锁 |
| 3 | migrator | 29.0 | 11 | 2.64 | 58 | 0.50 | 3 × `startTestPostgres`(其中 2 次 apply 打在不读的库上)+ 7 个目标库 × (建库 0.13 s + 4 个扩展 2.2 s) |
| 4 | edge host-integration | 40.7 | 29 | 1.40 | 303 | 0.134 | 29 次 worker 打包 + Miniflare 启动 32.6 s;数据库 8.1 s。**另有** 60 s 真实时钟等待,不计入 |
| 5 | edge agent-db | 15.45 | 20 | 0.77 | 84 | 0.18 | 6 次链 apply,其中 3 次在不读的库上,并在锁上排队 11.1 s |
| 6 | edge selection | 7.50 | 10 | 0.75 | 56 | 0.134 | 2 次链 apply,其中 1 次在不读的库上 |
| 7 | edge admission | 7.58 | 26 | 0.29 | 190 | 0.040 | 同上 |
| 8 | web | 7.16 | 27 | 0.27 | 50 | 0.143 | 生产构建(`pnpm run build`) |
| 9 | prisma-geography | 10.52 | 57 | 0.18 | 90 | 0.117 | 1 次主链 apply(不读)+ 扩展 + 小链 + 种子 |
| 10 | pi-session-neon | 7.72 | 155 | 0.050 | 208 | 0.037 | 2 次链 apply,其中 1 次在不读的库上 |
| 11 | catalog | 6.55 | 139 | 0.047 | 307 | 0.021 | 1 次链 apply(不读)+ Drizzle 时代库 |

"断言调用"是对该 suite 实际参与运行的文件(测试文件及其 harness/support 文件,edge-host 排除 `*.browser.ts`)静态统计的 `assert(`/`assert.x(`/`expect(` 调用数,不是运行时执行次数(循环内的断言只算一次)。按每个断言调用排序,前两名不变(agent 0.63、migrator 0.50;test-postgres 是被测对象,不参与排名),第三名从 edge-host 换成 edge agent-db(0.18);edge-host 因为每个测试断言多(303 次调用 / 29 个用例)降到 0.134。

最便宜的杠杆在排名顶端:agent 每个测试重新搭一整套数据面。

### 5 号问题:两个"每次建三个库"的调用点

**edge agent-db。** 脚本本来就是串行的:`node --import tsx --test --test-isolation=none --test-concurrency=1 "agent-db-test/*.test.ts"`(`workers/edge/package.json`)。三个 fixture 分别是 `settlement-fixture.ts`(被 4 个测试文件和 `settlement-harness.ts` 导入)、`recovery-fixture.ts`(被 `recovery-scan.test.ts` 导入)、`session-adoption-fixture.ts`(被 `session-adoption.test.ts` 导入),都在模块顶层注册 `before`/`beforeEach`。

我用两个最小文件探测了 `--test-isolation=none` 的语义(`/private/tmp/animichi-research/iso-probe/`),输出是:

```
A.before B.before A.beforeEach B.beforeEach a1 A.beforeEach B.beforeEach a2 A.beforeEach B.beforeEach b1 A.beforeEach B.beforeEach b2
```

也就是说,**三个 fixture 的 `before` 全部在一开始执行,三个 `beforeEach` 在 20 个测试里的每一个之前都会执行**,不管测试来自哪个文件。插桩数据与此一致:三次 `startTestPostgres` 同时启动,在 `ChainApplyTurn` 上排队(每次运行合计等锁 11.1 s),三次第二个库的 apply 并行进行。三个库每次运行合计:6 次建库、6 次链 apply(链时间 21.6 s),setup 窗口 15.45 s,而 20 个用例的 assertion 只有 2.88 s。

三个 fixture 写的表:

| fixture | 每个测试前重置的内容 | 写入 |
|---|---|---|
| settlement | `pi_sessions` 里 id 为 `settlement-session`、`other-session` 的行;`DELETE FROM daily_usage`;`DELETE FROM anon_daily_message_count`(`settlement-fixture.ts:20-23`) | `pi_sessions` 种子 |
| recovery | `pi_sessions` 里 id 为 `recovery-session`、`other-session` 的行(`recovery-fixture.ts:23`) | `pi_sessions`、`agent_admissions`(`:33-47`) |
| adoption | `DELETE FROM turn_reservations`;`DELETE FROM sessions`(`session-adoption-fixture.ts:100-101`) | `sessions`、`turn_reservations` |

重叠:settlement 和 recovery 都写 `pi_sessions`,还都删同一个 id `other-session`。整表读取:`recovery-scan.test.ts:14` 断言 `AgentOpenOperation.all()` 为 `[]`。

结论(有证据的部分):这三个库**不是为了并发隔离而必须的**——运行器已经串行,而且三份重置本来就在同一进程里、在每个测试之前全部执行,只是各打各的库。合并成一个库时要处理的具体约束有两条:`recovery-scan.test.ts:14` 这个整表断言,以及 adoption 的 `DELETE FROM sessions` 会在每个测试之前执行。另外,和怎么合并无关:6 次 apply 里有 3 次打在从来不读的 plane 库上。

**workers/migrator。** vitest 已经串行:`fileParallelism: false`(`workers/migrator/vitest.integration.config.ts`)。但每个文件跑在各自的 worker 里,模块级 `beforeAll` 无法跨文件共享;要共享得用 `globalSetup` + `provide`(catalog 就是这么做的,`workers/catalog/test/integration-db-global.ts`)。三个文件各自调 `startTestPostgres`:

| 文件 | plane 库怎么用 | 必要性 |
|---|---|---|
| `catalog-schema.integration.ts` | 直接读写 plane 库,而且是破坏性的:`ALTER TABLE public.points RENAME TO points_hidden`(`:55`)、`DROP TABLE public.ingest_jobs`(`:67`) | **必要**:需要一个已迁移、可以被破坏的库 |
| `prisma.integration.ts` | plane 只当管理 DSN(`:26`),每个用例另建一个**空**目标库并装 4 个扩展,由被测的 migrator 自己去迁 | plane 的链 apply **不必要**;每个用例一个空库是必要的(用例断言从 `markerHash: "empty"` 开始,`:44`) |
| `prisma.workerd.integration.ts` | plane 只当管理 DSN(`:23`) | plane 的链 apply **不必要** |

每次运行的开销:3 次 `startTestPostgres` 共 11.7 s(其中 2 次在不读的库上 apply,2 × 3.44 = 6.9 s)+ 7 个目标库 × 2.33 s = 16.3 s + workerd 打包/启动 0.8 s,共 29.0 s,而 11 个用例的 assertion 只有 7.8 s。

---

## 7. 没能测到的,以及原因

1. **CI 原生 amd64 上的数字。** 本地 Postgres 是仿真的;第 1 节的对照表明 postgis 在原生环境下约快 10 倍,但版本不同、不是严格的同条件对比。CI 上每次 apply 的实际耗时没有测。
2. **冷启动容器(initdb)和 CI 的 `docker build` 镜像步骤。** 要测就得删掉共享的复用容器,而它正被别的车道使用;任务要求不重启 colima,我也没有另起一个同 hash 的容器去测冷启动。本地只测到了复用挂接(90–300 ms)。
3. **edge-host 的 worker 启动拆分只有一轮样本**(第 3 轮,29 个事件),因为插桩是在第 2 轮开跑后才加的。
4. **node 运行器的 assertion 里包含 `beforeEach` 的种子写入**:node 把 `beforeEach` 计入测试耗时,不改运行器就没法单独拆出来。
5. **vitest 的 `tests` 是各文件耗时之和**,文件并行时(web)会超过它在 wall 里实际占的份额,所以 web 的 setup + assertion 大于 wall。
6. **pi-session-neon 的迁移验收测试**(`migration-target.db.test.ts`)在测试内部自己建库、apply 链,这是被测对象,计入 assertion,没有单独拆出来。
7. **覆盖率开销**:pi-session-neon 和 prisma-geography 在 `--experimental-test-coverage` 下运行(和 CI 一致),它们的"其它"(8.2 s / 1.7 s)包含覆盖率收集和报告,没有单独测。
8. **"进程启动到第一条 SQL"** 要对齐主机时钟和 colima VM 时钟,误差约 ±50 ms。

---

## 数字最支持的三处改动(未实施)

**1. 把 edge-host 那个 60 s 的真实时钟重试等待降下来。可省约 55–60 s/次运行**(edge-host 137 s 的约 43 %,全部集成测试 429 s 的约 14 %)。
证据:`recovery-endings.test.ts:49` 三轮分别 62.14 / 62.01 / 62.07 s;来源是 `business-host.worker.ts:131` 的 `baseDelayMs: 60_000`。这是真实时钟,**不受仿真影响,CI 上同样要付**。约束:测试要在唤醒触发之前观察到 pending 状态(`:57-71` 读 retry-report 和 `agent_admissions`),所以延迟必须大于到达这些断言所需的时间;下限需要实测,上面的 55–60 s 是按降到几秒估算的。

**2. 不再给没人读的 plane 库 apply 链。可省约 60 s/次完整回归(本地)。**
证据:每次回归有 17 次这样的 apply(第 2 节最后一列),每次中位数 3.43–3.67 s。按 suite:agent 6 × 3.44 = 20.6 s;edge agent-db 约 11 s(三次 plane apply 在锁上串行排队,每次运行的等锁 11.1 s 会随之消失,第二个库的三次 apply 本来就是并行的);migrator 2 × 3.44 = 6.9 s;edge admission / selection / host、catalog、pi-session-neon、prisma-geography 各 3.4–3.7 s。每次 apply 里 postgis 约 2.0 s,原生约 0.14–0.22 s,即约 1.8 s 是仿真带来的额外开销,所以**在 CI 上省的会少于本地**;本地 pre-push 能省满这 60 s。这些调用方需要的只是服务器、管理 DSN 和服务角色(`startTestPostgres` 在同一个锁回合里建角色,`test-postgres.ts:137-146`)。

**3. edge-host 的 worker 包按入口缓存,每个进程只打一次。可省约 21 s/次运行。**
证据(第 3 轮):29 次构建共 25.6 s(18 次 `wrangler deploy --dry-run`,中位数 0.86 s;11 次 `bundleLikeWrangler`,中位数 0.92 s),但只有 5 个不同入口:`business-host.worker.ts`、`interleaving.worker.ts`、`persistence-windows.worker.ts`、`reattach-contention.worker.ts` 走 `businessWorker`(`worker.ts:11-27`),`default-host.worker.ts` 走 `defaultWorker`/`reconnectWorker`。各测试之间只有绑定不同,而绑定是通过 Miniflare 选项传入的,不进包。25.6 − 5 × 0.88 ≈ 21 s。这部分是原生 CPU 开销,不受 Postgres 仿真影响。

(第 4 名,供参考:agent 的 6 个测试可以共用一个 Drizzle 时代库 + 一个 proxy。在第 2 条之外还能再省 5 × (2.44 + 0.13 + 0.34 + 约 0.45) ≈ 17 s。)

---

原始数据都在 `/private/tmp/animichi-research/`:`runs.jsonl`(每次运行的 wall、load、外来进程)、`phases.jsonl`(每个阶段一行)、`runs/*.log`(运行器完整输出)、`parsed2.json`、`chainbench.out`、`pglog_{1,2,3}.txt`(语句日志)、`instrumentation.diff`、`runner2.py`、`parse2.py`、`chainbench.py`。
