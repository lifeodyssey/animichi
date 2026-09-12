# Spec — Prisma 8 接管整个数据库层（Atlas 与 Drizzle 同时退役）

- Status: **Ready for sign-off** — 全部 14 个分叉与原 U10 已裁定（owner，2026-09-12 / 2026-09-13）；
  本稿供阅读与签核。**owner 明确说还不开工**：本稿不含启动章节，也没有为了让某一波看起来可开工而
  放宽任何验收条件。owner 已豁免本 spec 的双席评审。
- owner 定案（2026-09-12，四轮调研后）：**Prisma 8 拥有整个数据库层——schema 和查询层都归它。Atlas
  退役。Drizzle 退役。PostGIS 留着**（它是 Postgres 扩展，不是工具选择）。owner 原话的驱动价值：
  **不想同时拥有 Drizzle、Prisma、Atlas 三个东西**——一个工具，不是三个；PostGIS 是**没办法的办法**。
- 空间查询层走**私有 Prisma 8 扩展包**声明 `Geography(4326)`，作为已接受的债记在
  [#1620](https://github.com/lifeodyssey/animichi/issues/1620)（带删除形状的退出条件），并从
  [#1593](https://github.com/lifeodyssey/animichi/issues/1593)（ADR 0008 bucket-B 裁决簿）交叉引用。
- 生产的 artifact 级 baseline 闸门**按 owner 裁定删除而不是改嫁**，残余风险与三条重启触发器记在
  [#1621](https://github.com/lifeodyssey/animichi/issues/1621)。本 spec 不重开这条（§4.9、§九 R4）。
- 核对基线：`origin/main` = `3bb5621e4d4d7962a99dac83f6242c40a8941234`（2026-09-12 fetch）。
  下文每条事实带 `path:line` 或 URL。**本仓库的注释已知陈旧并误导过评审席**，所以除注释本身就是被讨论的
  产物之外，没有一条结论取自注释。已安装依赖的断言读的是 `node_modules` 里的发布产物
  （`.worktrees/card-1540/node_modules/@prisma/orm-postgres@8.0.0-rc.9`），不是文档。
- 取代：`docs/DOCS_POLICY.md:84`（"DB — catalog/user data … Drizzle raw-SQL query-only over
  neon-http；Atlas migrations in `migrations/neon/`"）、`migrations/AGENTS.md` 全文的 Atlas 前提、
  `.claude/rules/migrations.md` 全文、`workers/edge/test/migration-boundary.test.ts:21-27`
  （"Atlas files are the only Neon migration authority"）。本 spec 不取代
  `docs/adr/0006-platform-over-handwritten-ci.md`——它的决策 6 是本 spec 的**约束**，不是被改的东西。

## 〇、本 spec 受哪套方法论管（决定了什么算决策题）

owner 2026-08-03 的方法论授权：**TDD、DDD、SOLID、OOP、Clean Architecture 两侧统一，依赖规则由机器守卫；
战术 DDD 不在授权内，战略 DDD（限界上下文）在。** 逐目录规则在 `.claude/rules/`。

这套授权在本仓库有四个可引用的落点，下文的设计决定一律先对它们判：

| 落点 | 是什么 |
|---|---|
| `workers/catalog/test/dependency-rule.worker.test.ts:32-43` | 依赖规则的**机器守卫**：`LAYER_RULES` 声明 `src/domain/` 与 `src/application/` 各自不得 import 的目录与包；`:156-164` 自带一条变异用例 |
| `docs/specs/2026-08-06-catalog-clean-architecture-design.md` §3 / §12 | 上面那条守卫所强制的设计（catalog）；users 与 agent 各有同日的对应文档 |
| `docs/testing-strategy.md:707-721` | Clean Code 的 1-10-50 与 SOLID 五条的本仓表述 |
| `.claude/rules/naming-ownership.md` | 按归属命名；**SOLID 与 1-10-50 冲突时 SOLID 优先** |

**判据**：一个分叉如果被上面任何一条已承诺的原则决定，它是**设计决定**，写进 §四 并点名是哪条原则
决定的；只有授权管不到的才上升给 owner，并说明为什么管不到。初稿把八个授权已经回答的分叉当成决策题
上交，这一稿把它们移回 §四。

**一条方法论授权在本仓库尚未闭合的缺口**，本 spec 顺手关掉（§4.10）：`workers/users/src` 有
`domain/` / `application/` / `adapters/` 三层（`git ls-tree origin/main workers/users/src`），
但**没有**对应的 `dependency-rule` 守卫测试——只有 catalog 有。授权说依赖规则要机器守卫，
而本 spec 正好要重写 users 的整个 adapter 层。
---

## 一、动机

**三个工具解决一个问题，而且其中两个的边界已经把手写代码逼进了 Worker。**

Atlas 不能在 Worker 里跑——它是一个 Go 二进制，Worker 既不能 exec 子进程也不能装 CLI。ADR 0006 决策 6
又把另一条路封死：**「CI 永远不持有数据库凭据，短期的也不行；staging 与 production 都经 migrator」**
（`docs/adr/0006-platform-over-handwritten-ci.md:45`）。于是为了让 Atlas 的账本格式在一个 Atlas 跑不到的
地方保持真实，我们自己写了一个 Atlas：一个引号/dollar-quote/注释感知的 SQL 语句切分器
（`workers/migrator/src/sql-split.ts`，200 行）、一个 `atlas_schema_revisions` 的写入器
（`workers/migrator/src/http-apply.ts`，260 行，`:34-52` 是手抄的 Atlas v0.30 表定义与 upsert）、一个
`atlas.sum` 读取器（`workers/migrator/src/chain.ts`，64 行）、两个账本读取器
（`ledger.ts` 59 行、`preflight-ledger.ts` 11 行）。

它为什么写成这样，`docs/specs/2026-08-16-migrator-neon-connectivity-spec.md` 记着：从 migrator 容器出去的
`5432` 从来没对 Neon 完成过 TLS（那份 spec 明确拒绝断言「Cloudflare 做不了 Postgres TCP」），而它的决策 5
要求 Option 2 继续按 Atlas v0.30 的语义写 `atlas_schema_revisions`，好让笔记本上的
`atlas migrate status` 仍然说真话。**一旦 Atlas 不再拥有任何东西，那条约束就自己消失了**，
`ControlClient.migrate`（`workers/migrator/src/prisma-control.ts:39`）接手。

**这才是奖品，不是容器。** 容器已经死了而且没人用：`workers/migrator/src/create-app.ts:155-163` 的
`runContainerFor` 在 `deps.runContainer === undefined` 时直接返回 `httpApplyBound(...)`，不启动任何容器；
删容器是另一张卡 [#1589](https://github.com/lifeodyssey/animichi/issues/1589)。

**Drizzle 那半边的理由不是成本，是重复。** 它只被两个包依赖
（`workers/catalog/package.json:24`、`workers/users/package.json:20`，都是 `drizzle-orm@^0.45.2`，没有
`drizzle-kit`），而 Prisma 8 **已经在仓库里跑生产代码**：`workers/edge/src/agent/host/native-bootstrap.ts:28`
在 Durable Object 里 `postgres<Contract>({ contractJson, url })`，`packages/pi-session-neon/` 有完整的
Prisma 8 contract、迁移链与快照。留着 Drizzle 等于为同一个 Neon 维护两套类型映射、两套护栏、两套测试替身。

**迁移是 SQL，这不是妥协。** owner 的「不写裸 SQL」约束只管**应用代码**。触发器、生成列、非注册索引访问方法
（HNSW）是 DDL；DDL 就是 SQL；它们经 `rawSql` 进迁移，而这条路**已经证过**：
`packages/pi-session-neon/migrations/app/20260910T0407_native_agent_contract/access.ts:3-23` 就是一个带
`precheck` / `execute` / `postcheck` 的 `rawSql` GRANT 操作。下文不把它们写进风险清单。

---

## 二、现状（逐面核对）

### 2.1 Prisma 8 已经在仓库里，而且已经是生产迁移的一半

| 面 | 位置 | 状态 |
|---|---|---|
| contract + 链 | `packages/pi-session-neon/src/contract.prisma`、`migrations/app/`（两个迁移）、`migrations/snapshots/`（两个快照） | 已合入 |
| 运行时 | `workers/edge/src/agent/host/native-bootstrap.ts:2,28`（`@prisma/orm-postgres/runtime`，DO 内一个 Pool） | 已合入 |
| 迁移执行 | `workers/migrator/src/prisma-control.ts:19-44`（`executeMigrateShowPlan` 预览 + `ControlClient.migrate` 应用） | 已合入 |
| 发布标识 | `workers/migrator/src/prisma-target.ts:4` `PRISMA_TARGET = contract.storage.storageHash`，经 `create-app.ts:81` 在 `/healthz` 回显为 `prismaTarget` | 已合入 |
| pnpm patch | `packages/pi-session-neon/patches/@prisma__orm-target-postgres@8.0.0-rc.9.patch` | 已合入；`PRISMA-8-VALIDATION.md:78-81` 记了它的必要性与去掉后的红 |

版本钉法：`@prisma/orm-postgres@8.0.0-rc.9`（`packages/pi-session-neon/package.json:23`、
`workers/edge/package.json:30`、`workers/migrator/package.json:21`）+ CLI `prisma@8.0.0-rc.13`
（`packages/pi-session-neon/package.json:37`）。**Prisma 8 没有 stable**（npm `latest` = `8.0.0-rc.14`），
选它的理由不是版本成熟度，是 §一 那条：只有它有能在 Worker 里跑的程序化迁移入口。Prisma 7 另有独立的
否决理由——它**没有任何能承载发布握手的 schema 身份的产物**：`prisma generate` 的 client hash 对迁移链是瞎的
（改 `migration.sql` 正文、加一个未打包的迁移、删一个迁移，三种都不改变它），而那正是握手为防
[#1332](https://github.com/lifeodyssey/animichi/issues/1332) 而存在的失效（详见 #1620 正文）。

### 2.2 Atlas 退役具体删掉多少

`workers/migrator/src/` 里**整体只为 Atlas 账本存在**的模块（`for f in ...; do git show origin/main:$f | wc -l; done`）：

| 文件 | 行 | 它是什么 |
|---|---|---|
| `http-apply.ts` | 260 | 从 Worker 里写 `atlas_schema_revisions`（`:34-52` 手抄的 v0.30 表 + upsert；`:20` `OPERATOR_VERSION = "animichi-http-apply/0.30.0"`） |
| `sql-split.ts` | 200 | 引号/dollar-quote/注释感知的 SQL 语句切分器（`:18`、`:24` `needsTxNone`、`:29` `mixedTxMode`） |
| `chain.ts` | 64 | `atlas.sum` 解析 + 文件名→`version_description` head（`:38-40`） |
| `ledger.ts` | 59 | 只读 applied head（`:45` 的 `SELECT version, description FROM public.atlas_schema_revisions`） |
| `preflight-compatibility.ts` | 54 | 把账本快照与期望链前缀比对 |
| `requested-chain.ts` | 53 | 一次请求可应用的链段边界（#1365） |
| `selected-apply.ts` | 38 | DO 锁内的 Atlas 应用入口 |
| `bundled-chain.ts` | 26 | 把 9 个 `.sql` + `atlas.sum` 作为文本模块 import |
| `preflight-ledger.ts` | 11 | 只读账本快照（`readOnly` + `RepeatableRead`） |
| `text-modules.d.ts` | 9 | `*.sql` / `*.sum` 文本模块声明 |
| **合计** | **774** | |

**与本次 brief 给的数字的差**：brief 列了六个文件、644 行（`http-apply` 260 + `sql-split` 200 +
`chain` 64 + `ledger` 59 + `sql` 50 + `preflight-ledger` 11 = 644，算术对）。两处修正：
(a) `sql.ts` 不整体死——`dsnHost` / `assertDirectDsn`（`sql.ts:26-37`，12 行）被
`prisma-control.ts:6,20,33` 依赖（Neon DDL 必须走 direct host，不能走 `-pooler`），只有
`SqlClient` / `neonClient` / `bindQuery` / `bindTx`（约 38 行）随 `http-apply` 死；
(b) brief 漏了 `preflight-compatibility` / `requested-chain` / `selected-apply` / `bundled-chain` /
`text-modules.d.ts` 这 141 行，它们同样只为 Atlas 账本存在。净删除 ≈ **774 + 38 = 812 行**。

另有**部分删除**（不算进上表，因为 Prisma 那一半要留）：`preflight-metadata.ts`（87）里
`expectedHead` / `entries` / `stagingOnlyBaseline` / `canonicalHash` 死、`expectedPrismaRef` 活；
`selected-migration.ts`（84）里 `matchesBundle`（`:28-33`）、`applyAtlas`（`:56-63`）与
`checkSelected` 的 Atlas 三步（`:44-45`）死，`hasPrismaSnapshot` / `previewPrisma` / `migratePrisma` /
`:76` 的 marker 等值检查活；`apply-lock.ts:17-19` 的 `run`（Atlas 路径）死，`:21-27` 的
`preflight` / `migrate` 活。

**不在本 spec 范围内**：`container.ts`（30）、`runner.ts`（192）、`migration.ts`（105）与
`workers/migrator/wrangler.toml:56-60,113-114` 的 `[[containers]]` 是 **#1589** 的范围。
`wrangler.toml:5` 的注释「container binding stays until staging proof — do not delete `[[containers]]`」
仍然有效，本 spec 不动它。

### 2.3 Drizzle 的面

测法：`git grep -l drizzle origin/main -- <scope>`，行数 `git show origin/main:$f | wc -l`。

| 范围 | 数 | 说明 |
|---|---|---|
| `workers/catalog/src` 全部 `.ts` | **10,152 行 / 99 文件** | 其中 `drizzle-orm` importer **26 个文件**；这 26 个 + `src/application/README.md` 合计 3,034 行 |
| `workers/catalog/test` 提到 drizzle | 31 文件 / 3,315 行 | 含 spike（真 PostgreSQL）与 worker-pool（假替身）两类 |
| `workers/users/src` 全部 `.ts` | **1,237 行 / 15 文件** | `drizzle-orm` importer 5 个文件 + 2 个测试，合计 980 行 |
| `workers/edge` | 1 个测试 | `test/migration-boundary.test.ts:29-41`，守「Drizzle schema 不得成为迁移执行器」 |
| 其它 | `apps/web` **零** | `git grep -n drizzle origin/main -- apps/web` 无命中；`drizzle-orm` 只出现在两个 `package.json` |

brief 给的「10,166 行 / 31 文件 touching drizzle-orm」与「1,237 行」：后者精确等于
`workers/catalog` 的邻居 `workers/users/src`；前者与 `workers/catalog/src` 的 10,152 差 14 行，
文件数差（26 vs 31）应是把 `test/` 或 `.md` 计进去了。**下文一律用上表的实测数**。

两个包的接入形态相同、都只有一个 seam：
- `workers/catalog/src/db/client.ts:8-9,36-38` — `neon()` + `drizzle-orm/neon-http`；`:32-34`
  `statementBuilder()` 返回 `drizzle.mock()`，**只用来构造语句、从不执行**，语句经 `.getSQL()` 交给
  `db.execute` / `db.batch`。
- `workers/users/src/db/client.ts:14-16` — 同形状，`UsersDb`。
- 护栏是三条 semgrep 规则，**按 Drizzle 的形状写死的**：`.semgrep/ts-no-complete-sql-statement.yaml:30-31`
  （`sql\`select|insert|update|delete\``）、`.semgrep/ts-no-sql-raw.yaml:24`（`sql.raw(...)`）、
  `.semgrep/ts-no-direct-neon.yaml:28-31`（`neon(...)`）。三条都把
  `workers/catalog/src/db/expressions.ts` 列为唯一豁免路径。

**neon-http 没有客户端事务**，所以原子性靠 `db.batch`，全仓 4 处：
`workers/catalog/src/enrich/enrich.ts:52`、`src/import/switch.ts:51`、`src/publish/versioning.ts:31`、
`workers/users/src/adapters/neon-atomic-commit.ts:29`。`git grep -n '\.transaction(' -- workers/*/src` **零命中**。
`neon-atomic-commit.ts:13-21` 把这条限制写成了一段设计说明：因为 batch 里第二条语句看不到第一条的
`RETURNING`，适配器只好自己生成 UUIDv7 并绑进两条语句。

### 2.4 空间面很小，而且已经证过

**TypeScript 里唯一的空间消费者**是
`workers/catalog/src/adapters/outbound/nearby-points.ts:50,55,58,59`，经
`src/db/expressions.ts:23`（`geoPoint`）、`:28`（`withinMeters` → `ST_DWithin`）、
`:33`（`distanceMeters` → `ST_Distance`）、`:38`（`knnDistance` → `<->`）。
`MAX_RESULTS = 200`（`nearby-points.ts:35`）、`MAX_RADIUS_M = 50_000`
（`src/application/nearby-points.ts:21`）。

pg_trgm 的唯一消费者是 `src/adapters/outbound/neon/gazetteer.ts:45,60,61,64`，经
`expressions.ts:45`（`similarity()`）与 `:50`（`%`）。**pg_trgm 没有 first-party Prisma 8 扩展包**。

`src/application/nearby-points.ts:122` 先 `sortByDistance(...)`，`:133-143` 按 `distanceM` 再按 `id`
在 TypeScript 里重排。所以 SQL 的 `ORDER BY` **只是一个选择装置**：任何挑出同样 200 行的替代品行为等价。
但这句话有一个前提——**当 cap 咬住时，度量的选择改变的是成员集合，不只是顺序**（见 §2.5 的实测：
sphere 与 spheroid 排出的 top-200 在东京探针上 `set_diff = 2`）。

`points.embedding`（`vector(1024)`，`migrations/neon/20260826000003_catalog.sql:266`，HNSW 索引
`:278`）**零读零写**：`git grep -n embedding -- workers/ packages/ apps/` 只命中
`workers/catalog/src/db/schema.ts:19,86`（声明本身）与 `apps/agent/.../test_database_infra_contract.py:43,50`
（一个断言索引存在的 Python 集成测试，随 #1607 一起死）。

`locations.location`（`20260826000003_catalog.sql:136`）是一根**无索引、无生产读者、连写入都是 NULL**
的 geography 列。**列级核对**（这一稿补做的，初稿只核到表级）：

- 链里只有 `idx_points_location`（`:280`）一个 GiST 索引，`locations.location` 无索引。
- 唯一的 SQL 读者 `gazetteer.ts:31-40,50-53` 选的是 `locations.latitude/longitude` 标量。
- **种子 SQL 写的是 `NULL`**：`workers/catalog/scripts/gazetteer-render.ts:19` 的列清单里有
  `location`，但 `:29` 的 `locationTuple` 在那个位置传的是字面 `null`
  （`[row.id, row.name, row.kind, row.lat, row.lng, null, row.source, row.pref]`）。
  所以这根列的值**只由 `trg_locations_sync_coordinates`（`:145-147`）产生**，而没人读它。
- 全仓唯一读这根列的地方是 `apps/agent/src/animichi/tests/integration/test_coordinate_sync_trigger.py:45-47`
  （`ST_Y(location::geometry)` / `ST_X(...)`）——一个测试，而且它的文件头 `:12` 自己写明了为什么选
  `locations` 而不是 `points`：「`locations` is used over `points` because it carries the same trigger」。
  它随 #1607 一起死。
- **初稿被 brief 里的一处说法带偏过，这里记下更正**：`web_tools.py:75`、`domain/entities.py:169`、
  `packages/agent/src/native-configuration.ts:3` 三处出现的 `locations` **都是提示词与 docstring 里的
  英文散文**（"pilgrimage locations"、"between two locations"、"Never invent locations"），
  与这张表无关。表级的消费者只有上面三条。

所以 `locations` **表**是活的（gazetteer 读它），`locations.location` **列**是死的。这个区分是 §4.8.4 的依据。

### 2.5 必须以行为存活、而不是以 SQL 文本存活的东西

**(a) `sync_points_coordinates()` — 四分支优先级规则。**
`migrations/neon/20260829000000_fix_coordinate_sync_precedence.sql` 共 47 行 plpgsql，
`:18-47` 是函数体。它修的是 #1217：`20260826000002_functions.sql:4-21` 的基线版本在
`NEW.location IS NOT NULL` 时**无条件**用 geography 回写标量，于是一次只写 lat/lng 的 UPDATE 会被
BEFORE 触发器从陈旧的 geography **静默回退**。修正版在 `UPDATE` 时先算
`scalars_changed` / `location_changed`（`:26-28`），再按四条规则分派（规则写在 `:8-16` 的注释里）：
NULL location 永不终局（`:31-35`）、geography 写入赢（`:36-38`）、只写标量则 geography 跟随（`:39-43`）、
同一语句写了两者时规则 2 生效（`:13-14`，理由是 `idx_points_location` 从 geography 服务空间搜索）。
触发器挂在两张表上：`points`（`:281-283`）与 `locations`（`:145-147`）。

**今天的可空性是反的**：`points.location` 可空（`20260826000003_catalog.sql:261` 无 `NOT NULL`；
`workers/catalog/src/db/schema.ts:81` 同样没有 `.notNull()`），而 `latitude` / `longitude` 是
`NOT NULL`（`:259-260`、`schema.ts:79-80`）——与「geography 是权威」矛盾。处置见 §4.8.1。

**今天的写入路径靠触发器补值**：`workers/catalog/src/enrich/parse.ts:31` 的注释就是这个契约
（"A `points` row ready for UPSERT. The trigger derives `location` from lat/lng."）。§4.8.1 把方向反过来
之后，**这个写入点必须改成写 `location`**——这是那条设计决定唯一的实质代价，本 spec 不把它埋在注释里。

**(b) 推断会漏掉的东西。** `docs/iterations/production-readiness-2026-08/PRISMA-8-VALIDATION.md:51`
写着「The inferred Pi models omitted existing generated-column expressions」。**我核不实这句话**：
`git grep -iE 'GENERATED ALWAYS|STORED|IDENTITY' origin/main -- 'migrations/neon/*.sql'` **零命中**，
链里一个生成列都没有。链里真正的「非模型对象」实测如下（`for f in migrations/neon/*.sql; do
grep -cE '<pattern>' $f; done` 求和）：**71 条列 `DEFAULT`**（其中 11 条是 `uuidv7()`）、
**24 条 CHECK 约束**、一个 `bigserial` 序列及其 `GRANT ... ON SEQUENCE`
（`20260826000003_catalog.sql:185,197`）、**6 个 `CREATE TRIGGER`**、**2 个触发器函数**
（`20260826000002_functions.sql:4,23`，其中一个被 `20260829000000_…:18` 的
`CREATE OR REPLACE` 重定义）、**4 个 `CREATE EXTENSION`**、**5 个角色**、以及每张表 1–2 条 GRANT。
**那句话得重新建立而不是引用**，见 **U5**；但它的道理成立——**漏掉一个是静默的，不是响亮的**，
而上面每一类都必须在 §六 有一条自己的断言。

**(c) `geography` 不得在本 spec 下变成 `geometry`。** 实测（worktree `spike-spatial-perf`，
`.spike/post.log` "B. UNIT TRAP" 段，100k 行东京探针）：`geometry(Point,4326)` 上的
`ST_DWithin(loc_4326, pt, 5000)` 把半径读成 **5000 度**——`Seq Scan on pts_100000`，
`rows_matched_by_5000_degrees = 100000`，`Execution Time: 1477.306 ms`；同一探针 geography 按米
选出 `rows_matched_by_5000_metres_geography = 1910`。**52 倍过选**（100000 / 1910 = 52.4）。
同一段还记了另一件事：`ST_DistanceSphere` 打在投影坐标（6691）上直接报
`ERROR: Only lon/lat coordinate systems are supported in geography.`

Web Mercator（3857）另有独立否决：`.spike/post.log` "C. ORDERING / SET AGREEMENT" 段里
`merc_fn` 在 rural r=10000 探针上 `n_truth = 17`、`n_arm = 14`、`set_diff = 3`——
**返回了一个错的结果集**，不只是错的顺序。任何未来的坐标系转换是它自己的卡。

**(d) 今天就存在的 sphere / spheroid 不一致。** `nearby-points.ts:59` 用 `<->` 排序
（KNN 操作符，**球面**），`:55` 用 `ST_Distance(geography)` 报告并在应用层重排（**椭球**）。
实测二者不一致：`.spike/post.log` "C" 段以 `geog_knn`（`<->` 排序）为真相，
`geog_fn`（`ST_Distance` 排序）的 `first_differs_at` 在 tokyo 四个半径上都是 **52**、kyoto 四个都是 **59**、
rural r=50000 是 **48**；rural 的 2000（空结果）/5000（14 行）/10000（17 行）三个探针一致。
**11 个非空探针里 9 个不一致 = 82%**。而且 tokyo 四个探针 `set_diff = 2`——top-200 连集合都不同。
"D. NEAREST-POINT DISAGREEMENT" 段：300 个探针里**最近点从未分歧**（`nearest_disagree = 0`）。
所以分歧只发生在**列表尾部与 cap 边界**。报告哪一种米是一个**有意的决定**，不是顺手的清理——定案见 §4.11。

顺带一条实测、但**不在本 spec 范围**的发现：同一 sweep（`.spike/sweep2.tsv`）里投影系
JGD2011 / EPSG:6691 的 `utm_knn` 在 100k 行 / 东京 / 50 km 上是 **39.07 ms**，geography `geog_knn` 是
**47.21 ms**，`geog_fn` 是 **728.20 ms**；GiST 索引体积 geography 7672 kB vs 6691 的 4016 kB
（"E. INDEX / HEAP SIZES"）。owner 已定 geography 留任，本 spec 不重开；记在这里只是为了让未来那张卡
不必重跑 sweep。

### 2.6 数据库是空的，所以这是重建，不是数据迁移

- **production（`br-cold-term-aor1v6gl`，`infra/database-access/Pulumi.prod.yaml:28`）从来没被迁移过**，
  而且是被设计挡住的：`migrations/neon/STAGING_ONLY_BASELINE` 仍在 `origin/main` 上，
  `infra/database-access/production-baseline-guard.sh:15-18` 在遇到这个 marker 时 exit 1，
  `.github/workflows/cd.yml` 在生产迁移步之前跑它（`workers/edge/test/migration-boundary.test.ts:75`
  钉住 `release/migrations/STAGING_ONLY_BASELINE` 出现在 `cd.yml` 里）。owner 记录的实测：
  `public` schema **0 张表**，无 PostGIS 扩展。
- **staging（`br-gentle-king-aowjem8v`，`Pulumi.staging.yaml:3`）零业务行**。owner 记录：只有 PostGIS 自己的
  `spatial_ref_sys` 与 9 行 `atlas_schema_revisions`（9 = 链里 9 个 `.sql`）。它被
  `infra/database-access/reset-staging-baseline.sql:1-3`（`DROP SCHEMA IF EXISTS public CASCADE`）
  重置过，所以现存对象是重置后由 `migrator` 角色重建的。
- owner 已于 2026-09-10 裁定生产**没有用户**、允许直接删除重写
  （`docs/specs/2026-09-09-agent-on-pi-harness-spec.md` 第 7 行）。

所以本 spec **不设计任何数据迁移路径**。它设计的是一次重建。需要一条查询定的余项见 **U7**。

### 2.7 发布握手今天由两半组成

`scripts/delivery/migrate-through-worker.sh` 的两半：
- **Atlas 半**：`:40-43` `sealed_head()` 从 `release/migrations/*.sql` 的**文件名**取 head；
  `:130` 要求 `atlas.sum` 非空；`:132-134` 把 `{expectedHead, atlasSum, stagingOnlyBaseline}` 拼进请求体。
- **Prisma 半**：`:119` `PRISMA_REF="$(jq -er '.storage.storageHash | select(...test("^[a-f0-9]{64}$"))' "$CONTRACT_FILE")"`，
  `CONTRACT_FILE` 默认 `release/migrator/bundle/contract.json`（`:22`）。`-er` 意味着**契约缺失即失败**。

四个发布脚本已经把 Prisma 契约当强制项：
| 位置 | 干什么 |
|---|---|
| `scripts/delivery/migrate-through-worker.sh:119` | 从 `contract.json` 取 `storage.storageHash`，失败即退 |
| `.github/scripts/release/verify-receipt.rb:21` | 同一路径取 `prisma_ref`，传给 `ReleaseReceipt.validate` |
| `.github/lib/release/snapshot.rb:9` | `migrator/bundle/contract.json` 在 `REQUIRED_FILES` 里；`:10` 同时要求 `migrations/atlas.sum` |
| `.github/lib/release/source_closure.rb:10,26` | `NATIVE_CONTRACT = 'packages/pi-session-neon/src/contract.json'`，`:26` 「selected source has no native agent contract」；`:11-12` `MIGRATION_DIRECTORIES` 同时映射 `migrations/neon` 与 `packages/pi-session-neon/migrations` |

Worker 侧两半在**同一把锁内**复检（`workers/migrator/src/selected-migration.ts:80-84` 的注释
「Recheck both owners after acquiring the lock; a prior preview is no authority」）：
`checkSelected`（`:40-48`）做 `matchesBundle` → `hasPrismaSnapshot` → `compareMigrationPrefix`（Atlas 账本）
→ `previewPrisma`；`applySelected`（`:69-78`）先 `applyAtlas`（`:72`）再 `migratePrisma`（`:74`），
最后 `:76` `native.value.markerHash !== metadata.expectedPrismaRef` → `prisma_marker_mismatch`。

CD 的调用顺序（`.github/workflows/cd.yml`，staging `stage` job）：
`:114` `schema-preflight.sh staging --atlas-only`（**在发布新 migrator 之前**，所以 Prisma 半必然陈旧）
→ `:117` `wrangler deploy ... release/migrator/wrangler.json`
→ `:121` `schema-preflight.sh staging`（native 模式，`schema-preflight.sh:23` 的
`await_migrator_bundle` 等新 bundle）
→ `:141` `migrate-through-worker.sh staging`
→ `:154` 再跑一次 native preflight → `:155` `record-receipt.mjs staging`。
生产同形（`:246` 是 `--atlas-only` 那一步）。

`record-receipt.mjs` 的 Atlas 断言在 `:35-37`（`pendingCount == 0`、`appliedHead == expectedHead`），
Prisma 断言在 `:38-42`（`targetHash` / `markerHash` 等于契约、`usedLiveMarker === true`、
`migrations` 为空数组）。`.github/lib/release/receipt.rb:19-24` 的 `validate_schema` 同形。

**平台自带一个 marker 检查，但它只 warn。** `@prisma/orm-family-sql` 的
`VerifyMarkerOption`（`dist/prepared-statement-9QpkE6JG-ti591XdQ.d.mts:235-251`）默认
`'onFirstUse'`：第一次 execute 读一次 marker，**任何 hash 不匹配或 marker 缺失都只发一条 warn 级结构化日志，
查询照常进行**。所以它是诊断，不是门；发布握手必须保留自己 fail-closed 的那一条。

### 2.8 测试数据面：每个 DB 测试都靠 Atlas 链建库

`packages/test-postgres/src/test-postgres.ts:100-109` 的 `startTestPostgres` 无条件在
`:95` 调 `applyAtlasChain(dsn)`，后者（`src/atlas-chain.ts:18-27`）execFile 一个 `atlas migrate apply
--dir migrations/neon --revisions-schema public`。9 个消费点：
`packages/agent/integration-test/catalog-postgres.ts:14`、`packages/pi-session-neon/test/postgres.ts:21`、
`workers/catalog/test/spike-db-global.ts:18`、`workers/edge/admission-test/postgres.ts:20`、
`workers/edge/agent-db-test/recovery-fixture.ts:17`、`.../settlement-fixture.ts:16`、
`workers/edge/host-integration-test/postgres.ts:15`、`workers/edge/selection-test/postgres.ts:18`、
`workers/migrator/test/integration/preflight.postgres.ts:40` 与 `prisma.integration.ts:17`。

**geo-spike 就是靠这条链拿到 PostGIS 扩展的**：它的迁移
（`.worktrees/spike-prisma-geography/packages/geo-spike/migrations/app/20260912T1315_create_geo_points/migration.ts:13-32`）
只有 `createSchema` / `createTable` / `createIndex`，**没有 `CREATE EXTENSION`**，而
`test/geography.db.test.ts:25-26` 先 `startTestPostgres`（跑 Atlas 链、含
`20260826000000_extensions.sql:4` 的 `CREATE EXTENSION IF NOT EXISTS postgis`）再
`prisma db migrate`。Atlas 走了以后，扩展 DDL 必须有新主人——定案见 §4.8.2。

镜像是 Postgres 18 + PostGIS 3.6 + pgvector 0.8.5（`packages/test-postgres/postgres-image.env`
`TEST_POSTGRES_IMAGE=animichi-test-postgres:18-3.6-pgvector-0.8.5`），所以 `uuidv7()` 是 PG18 内建，
不依赖扩展。

### 2.9 契约测试与工作流里的 Atlas 形状

`.github/test/` 有 **39 个 `*.test.rb`、207 个 `def test_`**
（`for f in $(git ls-tree -r --name-only origin/main .github/test/ | grep '\.test\.rb$'); do
git show origin/main:$f | grep -c 'def test_'; done` 求和）。**brief 给的「55 个契约用例」我核不出来**——
最接近的是「11 个文件带 Atlas 形状字面量，这 11 个文件里共 84 个用例」：

| 文件 | Atlas 形状行 | 用例数 |
|---|---|---|
| `release-schema-gate.test.rb` | 11 | 19 |
| `pr-verification-schema.test.rb` | 9 | 4 |
| `release-migration-request.test.rb` | 6 | 4 |
| `pr-verification-affected.test.rb` | 5 | 5 |
| `release-source-closure.test.rb` | 5 | 10 |
| `pr-verification-browser.test.rb` | 3 | 4 |
| `release-consumer-cli.test.rb` | 3 | 4 |
| `release-receipt.test.rb` | 2 | 9 |
| `release-snapshot.test.rb` | 2 | 8 |
| `cd-migrations.test.rb` | 1 | 6 |
| `release-receipt-cli.test.rb` | 1 | 11 |

（判据：`grep -cE 'atlas|atlasSum|migrations/neon|expectedHead|appliedHead|stagingOnlyBaseline|bundleHead|[0-9]{14}_'`。）
逐用例的 Atlas 依赖判定要读每个 `def test_` 的正文，属于 stage 3 的分卡工作；本 spec 只给文件级范围。
已逐行读过并确认**必改**的两处：
- `.github/test/pr-verification-schema.test.rb` — `SCHEMA_SEGMENTS`（`:10-14`，三条 Atlas 命令按序）、
  `ATLAS_ACTION` / `ATLAS_VERSION`（`:16-17`）、`SCHEMA_FORBIDDEN`（`:15`，`atlas migrate apply`）。
  4 个用例里 3 个直接 Atlas 形状。
- `workers/edge/test/migration-boundary.test.ts` — 6 个用例里 4 个必改：`:21-27`（Atlas 是唯一权威）、
  `:29-41`（Drizzle schema 不得成为迁移执行器）、`:71-76`（`ariga/setup-atlas` 不得出现在 `cd.yml`、
  `STAGING_ONLY_BASELINE` 必须出现）、`:81-86`（`bundleHead` 握手）。

工作流侧：`.github/workflows/pr-verification.yml:168,424,476`（三处 `ariga/setup-atlas@… v0.30.0`）、
`:480`（`atlas migrate validate --dir file://migrations/neon`）、`:486` 的
`db-fresh-schema.sh`、`:488` 的 `pnpm --filter migrator test`；
`.github/workflows/release-build.yml:54,58`（`setup-atlas` + `atlas migrate validate --dir file://release/migrations`）。

本地门禁侧：`scripts/local-gates/pre-push-affected.sh:48,57,67`、`scripts/local-gates/db-fresh-schema.sh`、
`scripts/migration-head.sh:12-13`（head = `ls migrations/neon/*.sql | sort | tail -1`）、
`Makefile:7`（`ATLAS_VERSION ?= 0.30.0`）、`:159-181`（`db-new` / `db-list` / `db-hash` / `db-validate` /
`db-push-dry` / `db-push` 六个目标）。

Python 侧 `apps/agent/src/animichi/tests/atlas_helper.py` 及四个 `test_atlas_*.py` 随 **#1607** 死，
不是本 spec 的范围（排序见 §八）。

---

### 2.10 会「永久变绿」的两道守卫

Atlas / Drizzle 退役会让两道现有守卫**在不报错的情况下失去内容**。这是最糟的失效形状，所以单列一节。

1. **依赖规则的机器守卫**（方法论授权的落点本身）。
   `workers/catalog/test/dependency-rule.worker.test.ts:36` 把 `drizzle-orm` 与 `@neondatabase`
   列为 `src/domain/` 的禁止包前缀，`:41` 把 `drizzle-orm` 列为 `src/application/` 的禁止包前缀。
   Drizzle 走了以后这两个条目在仓库里零命中，规则对新的框架依赖**不再设防**。
   好消息是这个文件自带变异用例（`:118-126` 用 `drizzle-orm` 当反例、`:156-164` 注入一个违例副本），
   所以重指向之后有现成的红绿证明形状。
2. **三条 semgrep 规则**（§2.3）。同理，`sql\`...\`` / `sql.raw(...)` / `neon(...)` 三个模式在
   `workers/*/src` 里会变成零命中。

两道守卫的替换在 §4.10，验收在 §6.2。

### 2.11 `STAGING_ONLY_BASELINE` 的完整面（删除范围，不是设计题）

owner 已裁定删除而不是改嫁（#1621）。这里只记**面有多大**，因为它比 #1621 表格里列的宽，
而发送端与接收端必须同一次改动（理由见 §4.9）。

**发送端**（从 marker 推出 `baseline` 并转发 `stagingOnlyBaseline`）：
`.github/scripts/release/schema-preflight.sh:10,18`、`scripts/delivery/migrate-through-worker.sh:131,133,134`。

**接收端**——**两条拒绝路径，而且这个字段是必填的**：
- `workers/migrator/src/preflight.ts:25` 与 `workers/migrator/src/create-app.ts:187`：
  `stagingOnlyBaseline && MIGRATOR_OIDC_POLICY === "production"` → 拒。
- `workers/migrator/src/preflight-metadata.ts:57`：
  `keys.sort().join(",") !== "atlasSum,expectedHead,stagingOnlyBaseline"` → **整个请求非法**。
  所以「只删发送端」不是留下死代码，而是**让每一次迁移请求直接失败**。这比 #1621 的措辞更强，
  记在这里好让执行卡不低估它。
- 另一条**起因不同**的拒绝：`preflight-compatibility.ts:10,31` 的 `baseline_cutover_required`
  由 Atlas revision 行的 `type === "1"` 触发，与 marker 无关；它随 Atlas 账本死，不属于 #1621。

**闸门本体与接线**：`infra/database-access/production-baseline-guard.sh` 整个文件、
`.github/workflows/cd.yml:193`。

**断言点实测 14 处、分布在 9 个测试文件**
（`git grep -n 'STAGING_ONLY_BASELINE\|stagingOnlyBaseline' origin/main`，去掉 3 个只是携带该字段的
fixture：`workers/migrator/test/{prisma-fixture.ts:17,migrate.worker.helpers.ts:95,preflight-fixtures.ts:14}`）：
`.github/test/cd-migrations.test.rb:11-12`、`release-migration-request.test.rb:70,75,78`、
`release-schema-gate.test.rb:67,69`、`release-source-closure.test.rb:35,98`、
`workers/edge/test/migration-boundary.test.ts:75`、`workers/edge/test/staging-baseline-reset.test.ts:102-103`、
`workers/migrator/test/migrate.worker.prisma.test.ts:35`、`migrate.worker.selected.test.ts:40`、
`preflight.worker.metadata.test.ts:17,76`、`selected-request.workerd.test.ts:35`、
`preflight.cases.ts:24`、`integration/preflight.integration.ts:110`。

**与 #1621 的差**：#1621 的表只列了 `.github/test/` 里的 4 处（它的 AC 也只承诺
「`.github/test/` 的用例数正好降这么多」），Worker 侧的 10 处属于本 spec 的 W4。两边都要改，
范围不重叠。

**文档面**：`docs/ops/deployment.md:366,370,409`、`workers/migrator/AGENTS.md:54,95`、
`workers/edge/AGENTS.md:104`、`.github/workflows/pr-verification.yml:115`（注释）。

## 三、目标 / 非目标

**目标**：让 Neon 数据平面的 **DDL 权威**与**查询层**都只有一个工具——Prisma 8。
Atlas 从仓库消失；`drizzle-orm` 从两个 `package.json` 消失；PostGIS / pg_trgm / pgvector 作为
**Postgres 扩展**留任，通过 Prisma 8 的扩展包机制或迁移里的 `rawSql` 表达。
ADR 0006 决策 6（CI 永不持有数据库凭据）与 migrator Worker 作为唯一迁移入口的形态**不变**。

**非目标**：
- 不改 `packages/contract` 的 oRPC/zod 契约，不改任何对外 HTTP surface。
- 不改 `geography` 的存储类型或距离语义（§2.5(c)）；坐标系转换是别的卡。
- 不动 `workers/migrator` 的容器（**#1589**）、不动 `apps/agent`（**#1607**）。
  `packages/pi-session-neon` 的 contract 与写入语义不动；**动的是它那条链的范围**——
  §4.1 把数据平面的 19 张表并进同一条链，§4.7 让它的 Atlas 共存 fixture 退役。
- 不删 agent 域那 12 张表：本 spec 只是**不声明**它们，删除属于 #1607（§4.12）。
- 不改嫁生产 baseline 闸门（§4.9，owner 裁定）。
- 不引入 Hyperdrive，不给 catalog / users 引入 Durable Object（§4.2）。
- 不设计数据迁移或后向兼容（§2.6）。
- 不引入第二条授权边界（Neon Data API 已在 #1620 里被否）。
- 不给 Prisma 上游提 PR。

---

## 四、设计

### 4.1 一个工具，一条链

一次 **baseline 重建**：`migrations/neon/` 的 9 个 `.sql` 不再是权威，数据平面的 schema 由 Prisma
contract 声明，第一条 Prisma 迁移把它整体建出来。因为两个环境都是空的（§2.6），这条迁移就是
**唯一**的数据平面迁移；不需要 `contract infer`、不需要 baseline/sign、不需要
`PRISMA-8-VALIDATION.md:37-57` 那条「对既有库推断」的路。**这消掉了那份验证记录里唯一未解决的技术风险**
（两条 geography 诊断、一条 vector 诊断，`:42-48`）：我们不推断，我们声明。

迁移操作的形状照 `packages/pi-session-neon` 已经证过的三类：
- **表 / 约束 / 索引** → `Migration.operations` 里的 `createTable` / `addUnique` / `createIndex` /
  `addForeignKey`（`migrations/app/20260910T0407_native_agent_contract/migration.ts:13-20`）。
- **GRANT / 角色断言** → `rawSql({ id, label, operationClass, precheck, execute, postcheck })`
  （`.../access.ts:3-23`）。
- **触发器 / 函数 / HNSW 索引 / 扩展** → 同一个 `rawSql` 形状。HNSW 必须走 `rawSql` 是因为
  `USING HNSW (embedding vector_cosine_ops)` 的访问方法不是 Prisma 注册的索引类型；#1620 引的
  Prisma `framework-gaps.md` 条目 **G2** 也说扩展不能可靠地发 `CREATE INDEX … USING gist (geom)`，
  而 geo-spike 的 `@@index([location], type: "gist")`（`src/contract.prisma:10`）**实测成立**
  （`test/geography.db.test.ts:57-62` 断言 `indexdef` 匹配 `USING gist (location)`）——
  这是 G2 与实测的一处冲突，记在 §九 风险里。

**定案：一条链——改写现有的那条**（`packages/pi-session-neon/migrations`），不新开第二条。
一个 `prisma.config.ts` = 一个 contract = 一个 `migrations/` 目录 = 一个 `storage.storageHash`
（`packages/pi-session-neon/prisma.config.ts:4-6`；`prisma-control.ts:26` 的
`renderMarkerHashBySpace.get("app")` 取的是单一 space 的 marker）。一条链的直接后果，
逐条写明而不是含糊过去：

- **`/healthz` 的 `prismaTarget` 保持单值**（`create-app.ts:81` ← `prisma-target.ts:4`），
  发布握手的四个断言点（`schema-preflight.sh:66-69`、`record-receipt.mjs:38-42`、
  `receipt.rb:23`、`verify-receipt.rb:21`）**一处都不用改成两组**。这是选一条链的主要收益。
- **`source_closure.rb:11-12` 的 `MIGRATION_DIRECTORIES` 从两条目录变成一条**
  （删 `'migrations/neon' => 'migrations'`），`:32-37` 的目录完整性断言照原样适用。
- **`packages/pi-session-neon/.../access.ts:8-11` 的 precheck 从跨链假设变成同链内的排序约束**，
  这正是一条链比两条链强的地方（初稿把它写成两条链的代价，方向是对的，结论反了）。
- **爆炸半径**：`packages/pi-session-neon` 已跑通上游 conformance 的 18 个 `*.db.test.ts` 进入本次
  改动范围。其中真正受影响的是**共享 fixture**，不是 18 个文件——见 §4.7。

### 4.2 查询层：per-request `db.connect()` + `await using`，不上 Hyperdrive，不上 Durable Object

**定案**：`workers/catalog` 与 `workers/users` 用 `@prisma/orm-postgres/serverless`，每请求
`await using runtime = await db.connect({ url })`，作用域退出即释放。Hyperdrive **不引入**，
Durable Object **不引入**。

`@prisma/orm-postgres@8.0.0-rc.9` 的两个运行时入口：

| | `./runtime`（`dist/runtime.mjs`） | `./serverless`（`dist/serverless.mjs`） |
|---|---|---|
| 驱动 | `pg` 的 **`Pool`**（`dist/runtime.mjs:14`，`connectionTimeoutMillis` 默认 20000） | `pg` 的 **`Client`**，一次 `connect()` 一条（`dist/serverless.mjs:11,55`） |
| 客户端 surface | `orm` / `sql` / `runtime()` / `transaction(fn)` / `connect()` | `sql` / `context` / `stack` / `contract` / `connect()`（`dist/serverless.d.mts:10-18`） |
| 查询构造器 | 有 | **有**——`sql: Db<TContract>`（`dist/serverless.d.mts:11`），入口自己的示例就是 `db.sql.from(t).select(...)`（`:52`） |
| 事务 | `db.transaction(fn)` | `connect()` 返回的 `Runtime` 有 `connection()`（`@prisma/orm-family-sql/dist/prepared-statement-…d.mts:352`），`RuntimeConnection.transaction()` 在 `:363`，公开的 `withTransaction(runtime, fn)` 在 `:488` |

**为什么 per-request 是被认可的形状而不是降级的形状。** 入口的 doc comment 省略的是
**闭包缓存的便利 surface**，不是 ORM 能力，而且它把理由写出来了（`dist/serverless.d.mts:39-43`）：
「Closure-cached convenience surfaces are unsafe across `fetch` invocations: stale connections after
isolate idle, concurrent-query races on a shared `pg.Client`, no clean shutdown. Per-request callers
acquire a fresh `Runtime` via `db.connect({ url })` and dispose it via `await using` on scope exit.」
三个具名故障——isolate 空闲后的陈旧连接、共享 `pg.Client` 上的并发竞态、没有干净关闭——正是无状态
Worker 里会发生的三件事。**初稿把这句读成「没有 ORM」，是读错了；这一稿按整段读。**

**为什么不上 Hyperdrive。** `.claude/rules/infra.md:8-9` 的 Pulumi scope 写着 **No Hyperdrive**，
`docs/DOCS_POLICY.md:84` 同调。这条规则不需要重开：`./serverless` 的 `connect({ url })` 只要一个
连接串，Neon 的 direct host 就能满足（DDL 侧的 `-pooler` 禁令由 `assertDirectDsn` 管，见 §2.2）。
入口文档里的 `env.HYPERDRIVE.connectionString`（`dist/serverless.d.mts:51`）是**示例**，不是要求。
既有脚手架（`workers/catalog/wrangler.toml:38-40` 注释掉的 `[[hyperdrive]]`、
`src/db/connections.ts:16-18` 的优先级回落）随本波一起删——留着一个永不启用的绑定是
§2.10 那类「读起来像政策的死代码」。

**为什么不给 catalog / users 上 Durable Object。** owner 的理由值得记下来，因为它容易被误读成
「反对 DO」：**反对的是容器，理由是冷启动**；DO 在**身份与串行化本身就是需求**的地方是正确的
（agent tier 就是那样用的——`native-bootstrap.ts:24`「One DO incarnation owns these direct native
resources」）。把 DO 纯当连接池用，是用「池化」换来「单线程」外加**每次 catalog 读多一跳**。
SOLID 的单一职责同向：DO 的职责是身份与串行化，不是连接复用。

**不变的两件事**：
- **语句与执行分离的形状保住了。** 今天 `statementBuilder()`（`client.ts:32-34`）用
  `drizzle.mock()` 构造语句、`.getSQL()` 交给执行器；Prisma 8 是 `db.sql.<schema>.<table>…build()`
  产出 plan、`runtime.query(plan)` 执行（geo-spike `test/geography.db.test.ts:75-81`）。
  一一对应，`DbExecutor` 那层结构化接口按依赖倒置继续存在，只换实现。
- **§2.3 那 4 处 `db.batch` 变成真事务**（`withTransaction`）。顺带消掉
  `neon-atomic-commit.ts:13-21` 那段「worker 自己生成 UUIDv7，因为 batch 看不到 RETURNING」的设计债：
  真事务里第二条语句能读第一条的 `RETURNING`，id 的所有权可以还给数据库的 `uuidv7()` 默认值。
  这不是顺手清理，它是 `workers/users/src/db/schema.ts:13-15` 明写「`defaultRandom()` … is banned here」
  所要的那个形状。

**要付的代价，明说**：每请求一次 TCP+TLS 建连。**这个数字没测过**（§十一 U6），
它现在是一条**测量义务**而不是决策输入——§6.2 有一条对照计时的 AC，超出预期就立优化卡。

### 4.3 私有 geography 扩展包

来源：worktree `spike-prisma-geography` 的 `packages/geo-spike/`，**10/10 对真 PostGIS 通过**
（`test/geography.db.test.ts` 6 个 + `test/evidence.db.test.ts` 3 个 + `test/contract-types.test.ts` 1 个）。
它是 spike，不是可上线代码；下面是要从它抄的**设计**。

包由两个 descriptor 组成，因为 Prisma 的 authoring/控制面与运行时是两条路：
- `src/geography/control.ts:19-29` — `ControlExtensionDescriptor`，给 CLI / 迁移用；核心是
  `:11-15` 的 `expandNativeType` 钩子把 `geography` + `{srid}` 展开成 `geography(Point,<srid>)`
  （注释指出这与 first-party postgis 包把 `geometry` 展宽的是同一个钩子）。
- `src/geography/runtime.ts:6-18` — `SqlRuntimeExtensionDescriptor<"postgres">`，给查询用；
  `:13` 供 codec、`:14` 供 `queryOperations`。
- `src/geography/pack-meta.ts:8-20` — PSL 侧的命名空间构造器 `geo.Geography(4326)`，
  `:12` 声明参数 `srid` 为非负整数。

三个操作（`src/geography/operations.ts`），全部用公开的
`buildOperation` / `codecOf` / `toExpr`（`@prisma/orm-postgres/relational-core/expression`）：
`dwithinMeters` → `ST_DWithin({{self}}, {{arg0}}, {{arg1}})`（`:22`）、
`distanceMeters` → `ST_Distance({{self}}, {{arg0}})`（`:34`）、
`knnOrder` → `({{self}} <-> {{arg0}})`（`:46`）。**在 geography 列上距离参数与返回值本来就是米**
（`:8-10` 的注释），不需要 `::geography` cast，也不需要 `ST_DistanceSphere` 近似。

编解码：写进去 EWKT、读出来 hex EWKB（`src/geography/codec.ts:29` 的注释 +
`src/geography/ewkb.ts`），对外是 GeoJSON 形状
`{type:'Point',coordinates:[lng,lat],srid:4326}`（`src/geography/geojson.ts:2-6`；
`test/geography.db.test.ts:92` 断言这个形状）。

实测证据（`test/geography.db.test.ts`）：`format_type` 是 `geography(Point,4326)`（`:48-55`）、
GiST 索引由迁移创建（`:57-62`）、`prisma db verify` 报告 no drift（`:64-72`）、
typed 查询按 `dwithinMeters` 过滤 / 选 `distanceMeters` / 按 `knnOrder` 排（`:74-88`）、
读出 GeoJSON（`:90-93`）、`EXPLAIN (ANALYZE, BUFFERS)` 命中
`Index Scan using geo_points_location_gist` 且**不**出现 `Seq Scan`（`:95-104`）。
变异证明（`test/evidence.db.test.ts`）：DROP 索引 → `Seq Scan`（`:64-76`）；
把列类型改成 `geography(Point,4269)` → `db verify` 非零退出（`:78-90`）。

包的实测规模：`src/geography/*.ts` + `src/contract.prisma` **372 行**
（`wc -l`：codec 86、ewkb 60、operations 51、pack-meta 43、operation-types 43、control 31、
runtime 20、geojson 14、column-types 10、codec-types 7、constants 4、index 3、contract.prisma 12）。
与 #1620 正文的「~380 行」一致。

**校验器定案：zod@4.4.3，不是 arktype。** 决定它的原则是 owner 明示的价值「依赖最小化」。
spike 的 `package.json:21-23` 声明了 `arktype` 与 `@standard-schema/spec`，而 `arktype` 在本仓库
**不是依赖**——`pnpm-lock.yaml:1364` 里它只是 `@hookform/resolvers` 的一个 **optional peer**
（`:1396-1397` 的 `peerDependenciesMeta` 标 `optional: true`），没有任何 importer 装它。
它出现在 spike 里只是因为 codec 的 `paramsSchema` 类型是 `StandardSchemaV1<P>`
（`src/geography/codec.ts:6,15-22`），而 **zod 4 实现 Standard Schema v1**，且 `zod@4.4.3` 已经是
四个 workspace 包的直接依赖（`pnpm-lock.yaml:112-114,237-239,306-308,447-449`）。
spike 里的两段校验（`codec.ts:15-22` 的「整数且非负」）在 zod 是
`z.number().int().nonnegative()`。**换成 zod 之后 #1620 正文的「no new dependency」才是事实**，
这一点要在 #1620 上记一笔。

**包的位置定案：独立的私有 workspace 包**（`packages/prisma-geography`），子路径导出照 geo-spike
`package.json:6-15` 的七个出口。决定它的原则是单一职责 + 依赖方向：这个包必须同时被
`prisma.config.ts`（Node / CLI 侧，authoring + control，geo-spike `prisma.config.ts:8`）和
Worker bundle（运行时侧，`test/geography.db.test.ts:32`）加载；塞进 `workers/catalog` 会让 CLI 侧
import 一个 Worker 包，把依赖方向拧反。另外 #1620 的退出条件是**删掉这个包**——
独立包让那次删除是一次 `rm -r`，而不是一次考古。

**#1620 的 AC2 与本设计的冲突，记在这里**：AC2 要求「No file imports
`@prisma/orm-postgres/components/*`, `/target/codec-descriptor` or `/relational-core/*`」，
而这个包**正是靠这三类 import 实现的**（`codec.ts:1,3,4,5`、`control.ts:1`、`pack-meta.ts:1`、
`operations.ts:1`）。AC2 只在**删除之后**成立（#1620 自己的标题就是「for the eventual removal,
not for keeping it」），所以它不是保留期的约束。这个读法要在 #1620 上写明，否则它会在本 spec
落地当天变红。

### 4.4 pg_trgm 没有一等公民包

`similarity()` 与 `%` 是函数和操作符，不是类型，所以它们**不需要 codec**——只需要两个
`buildOperation` 描述符，形状与 §4.3 的三个完全一样（`template: "similarity({{self}}, {{arg0}})"` /
`"({{self}} %% {{arg0}})"`）。它们挂在 `text` 列（`pg/text@1`）上，不引入新类型。
所以 pg_trgm 的表达能力问题比 geography 小一个量级；真正不确定的是
`gazetteer.ts:47-65` 那条 `DISTINCT ON` + 子查询的**查询形状**能不能用 Prisma 8 的 `sql` builder
写出来（**U1**），以及 GIN trigram 索引（`20260826000003_catalog.sql:225`
`USING GIN (alias_normalized public.gin_trgm_ops)`）是否要走 `rawSql`（同 §4.1 的 HNSW，**U8**）。

### 4.5 「SQL 只在迁移里」这条护栏怎么换

三条 semgrep 规则（§2.3）按 Drizzle 的形状写死：`sql\`...\``、`sql.raw(...)`、`neon(...)`。
Prisma 8 之后这三个模式在 `workers/*/src` 里**零命中**，规则变成永真——
**这是最糟的失效模式：绿灯而无内容**。替换必须命名 Prisma 8 自己的逃生舱，至少包括
`db.raw.sql`（#1620 正文提到「A database function called from Prisma needs one line of
`db.raw.sql` in application code」）与在应用代码里直接构造 `rawSql`。具体换法见 §4.10；
**规则必须先对一个故意的违例变红，才算换好**（变异验证，见 §6.2）。
同一节还要处理**依赖规则守卫**（§2.10 第 1 条）——它是方法论授权自己的落点，
所以它变空比 semgrep 变空更严重。

### 4.6 发布握手去掉 Atlas 一半之后是什么

**它变成 Prisma 那一半，而那一半今天就已经是强制的、fail-closed 的。**

| 今天 | Atlas 退役后 |
|---|---|
| `migrate-through-worker.sh:40-43` 从文件名取 head | 删。Prisma 的链没有「文件名 head」这个概念，身份是 `contract.json` 的 `storage.storageHash` |
| `:130` 要求 `atlas.sum` 非空；`:132-134` 请求体 `{expectedHead, atlasSum, stagingOnlyBaseline}` | 请求体收缩成 `{expectedPrismaRef}`（`preflight-metadata.ts` 只保留这一个字段的解析） |
| `:119` 取 `PRISMA_REF` | **不变** |
| `schema-preflight.sh:7-8` head、`:17-19` 请求体、`:62-64` 对 `appliedHead`/`expectedHead`/`pendingCount` 的 jq 断言 | 删。`:20-24` 的 `await_migrator_bundle` 与 `:65-69` 的 prisma 断言（`targetHash == markerHash == $prisma`、`usedLiveMarker == true`）成为**全部**的门 |
| `schema-preflight.sh:12-16` 的 `--atlas-only` / `native` 两个模式 | 只剩一个模式；**`cd.yml:114` / `:246` 那一步整步删除**（见本节末） |
| `selected-migration.ts:42` `matchesBundle`、`:44-45` `compareMigrationPrefix`、`:56-63` `applyAtlas`、`:61` `atlas_head_mismatch` | 删 |
| `selected-migration.ts:43` `hasPrismaSnapshot`、`:46` `previewPrisma`、`:74` `migratePrisma`、`:76` `prisma_marker_mismatch` | **不变，且成为唯一的身份门** |
| `selected-migration.ts:80-84` 「锁内复检、先前的预览不是权威」 | **不变，这条性质必须存活** |
| `create-app.ts:81` `/healthz` 回显 `prismaTarget`；`:80` 回显 `bundleHead` | `bundleHead` 删；`prismaTarget` 成为 bundle 身份的唯一凭证，`migrator-bundle.sh:7` 的等待条件收缩到它 |
| `snapshot.rb:10` `migrations/atlas.sum` ∈ `REQUIRED_FILES` | 换成 Prisma 链的必需文件（`source_closure.rb:11-12` 已经把 `packages/pi-session-neon/migrations` 映射到 `migrator/bundle/migrations`，并在 `:32-37` 断言「selected migration chain is not the complete source chain」——这套机制原封不动地适用） |
| `source_closure.rb:11` 的 `'migrations/neon' => 'migrations'` 条目 | 删；`packages/pi-session-neon/migrations` 那一条保留为唯一映射（§4.1 定案一条链） |
| `record-receipt.mjs:35-37` Atlas 断言 | 删；`:38-42` Prisma 断言保留 |
| `receipt.rb:19-24` 的 Atlas 半 | 删；`:23` 的 prisma 三元等值保留 |
| `verify-receipt.rb:21` | **完全不变**——它今天就只读 Prisma 契约 |
| `release-build.yml:54,58` `atlas migrate validate` | 换成 Prisma 的链完整性校验（`prisma db verify` 需要一个库；纯静态的等价物是 **U9**） |

**`cd.yml:114` / `:246` 整步删除。** 它存在的理由是「在推新 migrator 之前，先读一次已部署 migrator
报告的 Atlas 兼容性」。Atlas 不再拥有任何东西，这个理由就没有剩余内容：剩下的 Prisma 半在旧 bundle 上
必然答 `stale_prisma_bundle`（`selected-migration.ts:43`），而 `schema-preflight.sh:54-60` 已经把这个
409 当作「等新 bundle」的信号在重试——放在发布之前跑它，只会消耗 3 次重试再失败。
**这是死代码，不是保守措施**，按 YAGNI 删。`:121` 那一步仍在，且仍在 `:141` 的 apply 之前，
所以「迁移之前先看一眼数据库」这件事没有丢，只是位置从「发布前」移到「发布后、迁移前」。

**结论一句话**：握手不需要被重新发明，它需要被**减半**。Prisma 半今天已经是强制的
（`migrate-through-worker.sh:119` 的 `jq -er`、`source_closure.rb:26`、`snapshot.rb:9`），
Atlas 半是那个要删的。

### 4.7 测试数据面

`packages/test-postgres/src/atlas-chain.ts` 整体替换成一次 Prisma 迁移应用；
`src/test-postgres.ts:95` 的调用点改口，`:86-97` 的「从 pristine `template1` 建库再迁移」的形状不变
（那条理由——postgis 镜像预置 tiger/topology 会被 clean-check 拒——与工具无关，
`packages/test-postgres/AGENTS.md:101-103`）。9 个消费点（§2.8）因此零改动。
`startTestPostgres` 的 API 不变；`SetupBudget` / `SetupDeadline` 的数字要重测（Prisma 迁移的
应用时间与 Atlas 不同；`AGENTS.md:41-70` 那套「一个墙钟 deadline、两个上限」的结构不动）。

扩展 DDL 归到链的第一条迁移（§4.8.2），所以这里不会静默坏掉——geo-spike 今天**是靠 Atlas 链拿到
postgis 的**（§2.8），那条依赖被迁移自己吸收。

**服务角色在测试数据面失去了创建者，这一节必须接住它。** §4.8.5 把角色 DDL 归给 Pulumi，
而测试容器里没有 Pulumi。今天这五个角色是 `migrations/neon/20260826000001_roles.sql:9-14`
经 `applyAtlasChain` 建出来的，`git grep 'agent_svc' -- packages/test-postgres/ 'packages/pi-session-neon/test/*'`
证实**没有任何测试自己建角色**。而它们是被断言的：
`packages/pi-session-neon/test/acl.db.test.ts:9-10` 断言全部五个角色的可读表数，
`runtime-acl.db.test.ts:11` 断言 `current_user = agent_svc`，
`test/postgres.ts:27,29-30` 用 `-c role=agent_svc` 开第二个连接池。
**所以 `packages/test-postgres` 要自己拥有测试容器的角色创建**（它是一次性容器，与生产的
Pulumi 归属不冲突），链里的 GRANT 迁移保留它的 `precheck`（`access.ts:8-11` 的形状）。
这是 §4.8.5 的直接后果，不是额外范围。

**`packages/pi-session-neon` 的共享 fixture 是 Atlas 共存期的脚手架，随 W4 退役。**
`test/postgres.ts:21,23` 在 `migrate()` **之前**从 Atlas 链建好的库里快照 `oldTables`，
`:24` 插一行 `daily_usage` 供重放对照；`test/migration.db.test.ts:7-12` 断言
「the expansion preserves every old table…」并点名 `runs` / `messages` / `run_steps`，
`:14-18` 断言重放保留那行数据。这套断言的被测对象是**「Prisma 扩展没有破坏 Atlas 建的表」**——
Atlas 走了以后它没有被测对象了。**受影响的是这个 fixture 与这一个测试文件，不是 18 个
`*.db.test.ts`**（`git grep -l oldTables -- packages/pi-session-neon` 只有两个文件）。

### 4.8 由方法论授权决定的六件事（不是决策题）

下面每条都被 §〇 的某条已承诺原则决定。初稿把它们当成决策题上交，这一稿把它们写成设计决定，
并点名是哪条原则决定的。

#### 4.8.1 `points.latitude` / `longitude` 变成生成列，`location` 变成唯一真相

**决定它的原则**：让非法状态不可表示（OOP / 领域建模）——不是事后纠正。

`location` 声明为 `NOT NULL`，标量声明为 `GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED` /
`ST_X(...)`。今天的可空性因此**反过来**（§2.5(a)：现在是 `location` 可空、标量 `NOT NULL`）。

这消灭的是 #1217 那**一整类** bug，而不是它的一个实例：
`20260829000000_fix_coordinate_sync_precedence.sql:31-44` 的四分支优先级规则是一段**事后纠正**
逻辑，它的存在本身就说明「两个表示可以不一致」这个状态是可表示的。生成列让它不可表示。
`:8-16` 的注释里那条「规则 4：同一语句写了两者时 geography 赢，因为 `idx_points_location`
从 geography 服务搜索」——正是「geography 本来就该是真相」的自述。

**代价一处，已在 §2.5(a) 点名**：`workers/catalog/src/enrich/parse.ts:31` 的写入契约要从
「写标量、让触发器补 `location`」改成「写 `location`」。它本来就在本 spec 的重写范围内。

**`sync_points_coordinates()` 与两个 `CREATE TRIGGER` 因此不进新链**——不是「照搬进 `rawSql`」，
是**不再需要**。§六 仍然保留一条直接针对 #1217 症状的集成断言，因为要证的是行为等价，不是实现等价。

#### 4.8.2 扩展 DDL 进链的第一条迁移

**决定它的原则**：一条迁移链必须能从零重建，所以不能假设扩展已存在。

`postgis` / `pgcrypto` / `pg_trgm` / `vector` 四条 `CREATE EXTENSION`（今天在
`20260826000000_extensions.sql:4-7`）进第一条 Prisma 迁移，形状照
`packages/pi-session-neon/.../access.ts:3-23` 的 `rawSql` + `precheck` + `postcheck`
（postcheck 断言 `pg_extension.extversion` 非空）。

**经验上的反例已经有了**：geo-spike 的迁移里没有 `CREATE EXTENSION`，它靠
`startTestPostgres` 先跑 Atlas 链才拿到 postgis（§2.8）。Prisma 7 的 spike 在没有这一步时
以 `type "geography" does not exist` 在 shadow database 上失败。**这是这条决定的实证依据，
不是推理。**

`uuidv7()` 不需要扩展：镜像是 Postgres 18（`packages/test-postgres/postgres-image.env`），
它是内建函数。

#### 4.8.3 删掉 `points.embedding` 与 `idx_points_embedding`

**决定它的原则**：YAGNI。

全仓唯一的出现是它自己的声明：`workers/catalog/src/db/schema.ts:19,86`
（以及 `migrations/neon/20260826000003_catalog.sql:266,278` 的 DDL）。
**这一次把 Python 纳入了检索范围**——初稿的检索漏了 Python，是同一类范围错误；
重检之后仍然没有任何读写点，只有 `apps/agent/.../test_database_infra_contract.py:43,50`
断言索引存在，而它随 #1607 死。

数据库是空的（§2.6），所以删除的成本是零，将来需要时一条迁移就回来。
留着它反而要为一根没人用的列做 `pgvector.Vector(length: 1024)` 的 authoring
（`PRISMA-8-VALIDATION.md:46-47` 记了这条路可行）外加一条 `rawSql` 建 HNSW 索引。

#### 4.8.4 删掉 `locations.location` 列，保留 `locations` 表

**决定它的原则**：YAGNI，按列而不是按表施用。

§2.4 的列级核对结论：表是活的（`gazetteer.ts` 读它的标量），列是死的（种子写 `NULL`，
`gazetteer-render.ts:29`；唯一的读者是一个随 #1607 死的测试）。所以删列、留表。
`trg_locations_sync_coordinates`（`20260826000003_catalog.sql:145-147`）随列一起走——
它是这根列唯一的赋值者。

**这一条我按要求做了列级复核才写**（初稿只核到表级，而 brief 给的三个「表级消费者」
经核对全是提示词散文，见 §2.4）。没有任何消费者读这根列，因此不需要上升。

#### 4.8.5 角色与 GRANT 归 Pulumi

**决定它的原则**：单一职责——角色与授权是访问控制，即基础设施；`docs/adr/0003-secrets-architecture.md`
已经把它放在 Pulumi。

今天是**两个主人**：Pulumi 经 Neon API 建 LOGIN 角色（`infra/database-access/index.ts:86,91,96,129`
的 `catalog_svc` / `users_svc` / `agent_svc` / `migrator`），而
`migrations/neon/20260826000001_roles.sql:5-15` 又用 `DO $$ … CREATE ROLE %I NOLOGIN` 兜底。
定案取 Pulumi 一侧，链里只保留 `precheck` 断言角色存在——
`packages/pi-session-neon/.../access.ts:8-11` 已经是这个形状。
CD 的顺序本来就支持它：`cd.yml:126-131` 的 Pulumi `Apply database access` 在 `:141` 的
`migrate-through-worker.sh` **之前**。

两处余数：`readonly` 与 `jobs_svc` 今天只由链创建、Pulumi 没建（`index.ts` 只有四个角色），
搬家时要一起补进 Pulumi；测试容器的角色创建归 `packages/test-postgres`（§4.7）。
`migrations/AGENTS.md:78-86` 的角色矩阵与 `:55-76` 的表所有权表随之重写。

#### 4.8.6 semgrep 与依赖规则的重指向是实现任务

**决定它的原则**：这不是分叉——护栏必须继续守着同一条不变量（「应用代码里没有 SQL」、
「domain / application 不 import 框架」），只是被守的字符串换了。

具体做法与验收在 §4.10 与 §6.2。它在这里出现只是为了说明它**不占用 §五 的位置**。

### 4.9 生产 baseline 闸门：删除，不改嫁

**owner 裁定（2026-09-13，#1621）**，而且是**驳回了改嫁的建议**之后裁定的。本 spec 不重开。

删除范围就是 §2.11 那一整节。执行上只有一条硬约束，因为它决定改动能不能拆：

**发送端与接收端必须在同一次改动里走。** `workers/migrator/src/preflight-metadata.ts:57` 把
`stagingOnlyBaseline` 列进**必填**的请求键集合（`keys.sort().join(",") !==
"atlasSum,expectedHead,stagingOnlyBaseline"` → 整个请求非法）。所以先删发送端会让**每一次迁移
请求直接失败**；先删接收端会让一个字段无人消费。#1621 的 AC2 用的理由是「a receiver that still
branches on a field nobody sends is dead code that reads as live policy」——那条理由成立，
而实测的约束比它更硬。

**残余风险按 owner 的裁定记录而不是争论**（#1621 正文）：Atlas → Prisma 的切换**本身就是一次
破坏性硬切**，它对生产安全只因为生产是空的；剩下的控制是 GitHub `production` 环境的
`required_reviewers` 加 `branch_policy`，那是 operator 级而不是 artifact 级的。
三条重启触发器在 #1621。本 spec 在 §九 R4 引它，不复制它。

### 4.10 两道守卫怎么换（含 users 的依赖规则缺口）

**依赖规则守卫**（§2.10 第 1 条）：`workers/catalog/test/dependency-rule.worker.test.ts:36,41`
的禁止包前缀从 `drizzle-orm` / `@neondatabase` 换成 `@prisma/orm-postgres` 与 geography 包的
specifier。`src/domain/` 与 `src/application/` 都不得 import 它们——
`docs/specs/2026-08-06-catalog-clean-architecture-design.md` §12 的「domain 无框架 import」
原样成立，换的只是框架的名字。这个文件自带变异形状（`:118-126` 的反例、`:156-164` 的注入副本），
重指向必须连变异一起改，否则守卫会像 §2.10 说的那样静默变绿。

**`workers/users` 补上同一道守卫**：它有三层目录却没有守卫测试（§〇 末）。方法论授权说依赖规则
要机器守卫，而本 spec 正在重写它的整个 adapter 层——**这是关掉这个缺口成本最低的时刻**，
而不是一项新范围。守卫内容照 catalog 的 `LAYER_RULES` 形状，禁止包同上。

**semgrep 三条规则**（§2.10 第 2 条）合成一条：禁 Prisma 的逃生舱
（`db.raw` / 应用代码里直接构造 `rawSql`）出现在两个 Worker 的 `src/` 与 geography 包的 `src/`
之外；迁移目录按**路径**排除，而不是像今天那样按单文件豁免
（`.semgrep/ts-no-complete-sql-statement.yaml:26-28` 那种 `exclude` 一个具体文件的形状，
会随文件改名失效）。`.semgrep/tests/fixtures/forbidden/` 下的三个 TS fixture 换成新的违例。

两道守卫的共同验收条款：**先对一个故意的违例变红，才算换好**（§6.2）。

---

### 4.11 报告哪一种米：椭球，一种而不是两种

**定案：`ST_Distance(geography)` 的椭球米，排序与报告同源。**

今天的成对是**两个默认值的意外**，不是一个选择：`<->` 是球面，`ST_Distance(geography)` 默认
`use_spheroid = true` 是椭球。`nearby-points.ts:59` 按前者选 200 行、`:55` 按后者报告。
实测 11 个非空探针里 9 个（82%）两者的 top-200 顺序不同，东京四个探针连集合都差 2 行
（`.spike/post.log` "C" 段；300 探针里最近点从未分歧，"D" 段）。

**这条为什么代价小，必须说清楚**：`application/nearby-points.ts:122` 已经在 TypeScript 里
`sortByDistance(...)`，`:133-143` 按 `distanceM` 再按 `id` 重排。所以 **SQL 的 `ORDER BY` 只决定
哪 200 行返回，不决定用户看到的顺序**。换成椭球排序，改变的只是 cap 咬住时的成员集合——
而那个集合本来就应该由「用户看到的那个度量」决定。

**要付的性能代价，明说**：`geog_fn`（椭球排序）在 100k 行 / 东京 / 50 km 上是 **728.20 ms**，
`geog_knn`（球面 KNN）是 **47.21 ms**（`.spike/sweep2.tsv`）——15×。计划差异在
`.spike/post.log`：KNN 走 `Order By: (loc_geog <-> …)` 索引有序扫出 201 行；
`ST_Distance` 排序要 `Index Scan … rows=32103` 再 top-N heapsort。
**这个数字进 §6.2 的对照 AC，超出预算就立优化卡**——不在本 spec 里预先优化。

### 4.12 数据平面 contract 不声明 agent 域的表

**定案：catalog 域 16 张 + users 域 3 张 = 19 张进 contract；agent 域那 12 张不进，它们归 #1607。**

链今天建 32 张表（`git grep -oE 'CREATE TABLE public\.[a-z_]+' -- 'migrations/neon/*.sql'`）。
agent 域的 12 张（`20260826000004_agent.sql` 的 10 张 + `20260902000000_agent_runs.sql` 的
`runs` / `run_steps`）**唯一的消费者是 Python**：

- **初稿这里犯的是范围错误，不是事实错误。** 它说「零引用」时只检索了 `.ts`，那是真的但有误导性。
  纳入 Python 后重检：`request_log` 出现在 20 个文件里，含 `domain/ports.py` 与
  `domain/repo_types.py`；`turn_reservations` 13 个，含 `application/adopt_sessions.py`；
  `agent_memory` 6 个。
- 所以这不是「删除提案」。#1607 删掉 `apps/agent` 的时候，这些表就没有消费者了。
  **本 spec 只是不声明它们**——一条从零重建的链不声明的东西就不存在，不需要一条 DROP。

**`run_steps` 的去向（这一稿定掉的余数）：跟 `apps/agent` 一起走。** 它在两个存活的 TS 包里
各出现一次，两处都不是消费者：

- `packages/contract/test/session-history-steps.test.ts:36` —— **只在一句注释里**
  （"One published step, as the edge projects a settled `run_steps` row."）。
  测试本身验的是 zod 契约 `GetSessionHistoryResponse` 的 `steps` 字段，那是**线上契约**，
  与表是否存在无关；`:54-55` 还明写它记录的是「the explicit null the Python route sends」。
- `packages/pi-session-neon/test/migration.db.test.ts:10` —— 它断言的是
  **「Prisma 扩展没有破坏 Atlas 建的表」**，点名 `runs` / `messages` / `run_steps` 只是为了让
  `oldTables` 非空。`oldTables` 来自 `test/postgres.ts:21,23`，即 Atlas 链建好的库。
  Atlas 退役之后这条断言**没有被测对象**，它随 fixture 一起退役（§4.7）。

`sessions` 是 agent 域里唯一确定还活着的表（`workers/edge/src/agent/admission/session-owner.ts:5,14,25`
读写它），它已经属于 `packages/pi-session-neon` 那条链的范围，不属于数据平面 contract——
这也是 §4.1 选一条链之后自然落位的。

---

## 五、裁定记录

初稿在这里挂了 14 个决策题。**全部已裁定，本节现在是记录而不是提问。**
其中 6 条本来就不该上升——方法论授权（§〇）已经回答了它们，是我漏读了授权才当成分叉上交的；
它们已移入 §四 并点名决定它们的原则。

| # | 分叉 | 裁定 | 谁决定的 | 写在哪 |
|---|---|---|---|---|
| 1 | `points` 标量：生成列还是触发器 | **生成列**，`location` 变唯一真相并 `NOT NULL` | 授权：让非法状态不可表示 | §4.8.1 |
| 2 | 报告哪一种米 | **椭球（spheroid），排序与报告同源** | owner | §4.11 |
| 3 | 无状态 Worker 的连接形态 | **`./serverless` per-request `connect()` + `await using`；不上 Hyperdrive；不上 DO** | owner | §4.2 |
| 4 | 一条链还是两条 | **一条——改写现有那条** | owner | §4.1 |
| 5 | 角色 DDL 归谁 | **Pulumi**；链里只 `precheck` | 授权：单一职责 + ADR 0003 | §4.8.5 |
| 6 | 扩展 DDL 归谁 | **链的第一条迁移** | 授权：链必须能从零重建 | §4.8.2 |
| 7 | `points.embedding` + HNSW | **删** | 授权：YAGNI | §4.8.3 |
| 8 | `locations.location` | **删列、留表** | 授权：YAGNI（按列施用） | §4.8.4 |
| 9 | 校验器 arktype / zod | **zod@4.4.3** | owner 明示的价值：依赖最小化 | §4.3 |
| 10 | geography 包放哪 | **独立私有 workspace 包** | 授权：单一职责 + 依赖方向 | §4.3 |
| 11 | 发布前的 `--atlas-only` 那步 | **整步删除** | 授权：YAGNI（死代码） | §4.6 |
| 12 | semgrep 三条规则怎么换 | **实现任务，不是分叉** | 授权：护栏守同一条不变量 | §4.10 |
| 13 | 数据平面 contract 声明哪些表 | **不声明 agent 域那 12 张；它们归 #1607** | owner | §4.12 |
| 14 | 与 #1589 的排序 | **#1589 先，不并发** | owner | §八 |
| — | 原 U10：生产 baseline 闸门 | **删除，不改嫁**（驳回了改嫁建议） | owner，#1621 | §4.9 |

**留给 owner 的还剩几条：零。** 我没有再造一条来填这张表。两处曾经看起来像候选、经核对后都不是：

- **`locations.location` 是否真的没有生产读者**——我按要求做了列级复核（§2.4），
  结论是没有，所以不需要上升。如果复核结果相反我会把它留在这里。
- **`run_steps` 在两个存活的 TS 包里的去向**——已由核对定掉（§4.12），不是判断题。

**§十一 的 11 条未知不在这张表里，而且不该在。** 它们是待查的事实，不是待拍的板；
每条都带着能定它的那一条查询或探针。把未知当决策题上交，是让 owner 替我做调研。

---

## 六、验收计划

每条 AC 带测试类型（`unit`|`integration`|`eval`|`browser`|`api`）。**Quality Ratchet：
review 时 `ac_total == ac_with_test`。**下面按面组织；具体挂到哪张卡是 stage 3。

### 6.1 迁移层

- [ ] **(integration)** 空库 → 一次 Prisma 迁移应用 → `prisma db verify` 报 no drift；
      **变异**：把任意一列的类型改掉，`db verify` 非零退出（照 geo-spike
      `test/evidence.db.test.ts:78-90` 的形状）。
- [ ] **(integration)** 重放：同一 ref 再应用一次，应用 0 条迁移、marker 与数据不变
      （`PRISMA-8-VALIDATION.md:31` 已在 starter 图上证过，这里要在真链上证）。
- [ ] **(integration)** 四个扩展在迁移后 `extversion` 非空（§4.8.2）；**变异**：把
      `CREATE EXTENSION` 从迁移里去掉，这条断言变红。
- [ ] **(integration)** `points.latitude` / `longitude` 是 `GENERATED … STORED` 且
      `points.location` 是 `NOT NULL`（查 `pg_attribute.attgenerated` 与 `attnotnull`，
      不查 DDL 文本）；写一次 `location`，两个标量读回来与之一致。
- [ ] **(integration)** #1217 的症状在新形状下**不可表示**：尝试单独 UPDATE `latitude`
      直接被 Postgres 拒（生成列不可写）。这一条证的是行为等价，不是实现等价——
      §4.8.1 删掉了那两个触发器，所以这里不能只断言「触发器存在」。
- [ ] **(integration)** `update_updated_at()` 与它的四个触发器（`bangumi` / `points` /
      `sessions` / `saved_routes`）行为存活：UPDATE 一行，`updated_at` 前进。
      它与坐标同步无关，不随 §4.8.1 消失。
- [ ] **(unit)** 新链里没有 `sync_points_coordinates`：`git grep` 在
      `packages/pi-session-neon/migrations` 下零命中。**变异**：把它加回去，这条断言变红。
- [ ] **(integration)** GRANT 矩阵：`packages/pi-session-neon/.../access.ts:19-22` 那种
      `has_table_privilege` 形状的 postcheck，覆盖数据平面每张表 × 每个服务角色；
      **变异**：去掉一条 GRANT，断言变红。
- [ ] **(integration)** `bigserial` 序列的 `GRANT ... ON SEQUENCE`（`20260826000003_catalog.sql:197`）
      存活。
- [ ] **(unit)** 仓库里零 `atlas` 字样（`Makefile` / `scripts/` / `.github/` / `packages/` /
      `workers/`，`docs/archive/` 与本 spec 除外）；`migrations/neon/` 不存在。
- [ ] **(unit)** `workers/migrator/src/` 不再 import 任何 `*.sql` / `*.sum` 文本模块。

### 6.2 查询层

- [ ] **(integration)** `nearby-points` 对一个已知点集返回**同样的行、同样的顺序**
      （对照今天的 `workers/catalog/test/nearby-points.spike.test.ts`），且 `EXPLAIN` 仍显示
      GiST 索引同时服务谓词与排序；**变异**：DROP 索引 → `Seq Scan`（geo-spike
      `test/evidence.db.test.ts:64-76`）。
- [ ] **(integration)** `MAX_RADIUS_M` 钳位与 `MAX_RESULTS` 上限行为不变
      （今天由 `nearby-points.worker.test.ts:67-80,183-189` 覆盖）。
- [ ] **(integration)** geography 读出来是 `{type:'Point',coordinates:[lng,lat],srid:4326}`，
      **经 `db.sql` 选 `location` 列本身**。§4.2 定案之后 `db.orm` 在这两个 Worker 里不存在，
      所以这不再是「顺便也证一下」——它是唯一的读路径，而 geo-spike 只证过 `db.orm`（§十一 U4）。
- [ ] **(integration)** gazetteer 的 exact 与 fuzzy 两条路径返回同样的行与顺序，
      GIN trigram 索引被用上（`EXPLAIN`）。
- [ ] **(integration)** 排序与报告同源（§4.11）：`EXPLAIN` 里的 `Sort Key` 是
      `st_distance(...)` 而**不是** `<->`；同一个已知点集上，返回的 200 行集合与按椭球米排序的
      真相集合相同。**变异**：把排序换回 `<->`，这条断言在东京形状的 fixture 上变红
      （`.spike/post.log` "C" 段实测 `set_diff = 2`，所以这个 fixture 必须复现那个形状，
      否则变异不会被抓到——§十一 U11）。
- [ ] **(integration)** 4 处原 `db.batch`（§2.3）变成 `withTransaction` 之后的原子性：
      中途失败时前半不落库。
- [ ] **(integration)** `saved_routes.id` 的所有权还给数据库：INSERT 不带 `id`，
      `uuidv7()` 默认值生效，且同一事务的第二条语句能读到第一条的 `RETURNING`
      （这是 §4.2 消掉 `neon-atomic-commit.ts:13-21` 那段设计债的证据）。
- [ ] **(integration)** `saved_route_idempotency` 的 reclaim 语义：staleness 谓词落在
      `DO UPDATE` 自己的 `WHERE`，不落在冲突目标的 index-predicate 槽
      （今天由 `workers/users/test/reclaim-sql-shape.worker.test.ts:9-16` 以捕获 SQL 的方式钉住；
      Prisma 8 下的等价断言形状是 **U2**）。
- [ ] **(unit)** `drizzle-orm` 不在任何 `package.json` 里；`workers/*/src` 无 `drizzle` import。
- [ ] **(unit)** 新 semgrep 规则对一个故意的违例 fixture **变红**（§4.10）。
      规则改完之后**旧 fixture 必须删除而不是留着**——一条对着已消失模式的 fixture 会一直绿。
- [ ] **(unit)** `workers/catalog/test/dependency-rule.worker.test.ts` 的 `LAYER_RULES` 禁止的是
      `@prisma/orm-postgres` 与 geography 包，且 `:118-126` / `:156-164` 的变异用例跟着换：
      注入一个 import 新框架的 domain 文件 → 变红（§4.10）。
- [ ] **(unit)** `workers/users` 有它自己的 `dependency-rule` 守卫测试，带同样的注入变异
      （§4.10 关掉的授权缺口）。
- [ ] **(unit)** 两个 Worker 的 `src/` 里没有 `HYPERDRIVE`：`wrangler.toml` 的注释绑定与
      `src/db/connections.ts:16-18` 的回落一起删（§4.2）。
- [ ] **(api)** staging 上 `/catalog/public/anime-overview/{id}` 与 nearby 读路径的实测延迟，
      与切换前的对照数字一起记进卡（§4.2 的建连代价、§4.11 的排序代价，两笔分别计）。

### 6.3 发布握手

- [ ] **(unit)** `migrate-through-worker.sh` 的请求体只含 `expectedPrismaRef`；
      契约文件缺失时脚本非零退出（今天由 `:119` 的 `jq -er` 保证，换后要保留）。
- [ ] **(unit)** `schema-preflight.sh` 的 jq 断言集合：三条 prisma 断言在、
      `appliedHead`/`pendingCount` 断言不在。
- [ ] **(integration)** 官方 Wrangler workerd runtime 下，migrator 的 `/preflight` 与 `/migrate` 在
      `expectedPrismaRef` 不在 bundle 内时返回 409 `stale_prisma_bundle`；marker 与期望不等时
      返回 `prisma_marker_mismatch`（扩 `workers/migrator/test/integration/prisma.workerd.integration.ts`）。
- [ ] **(integration)** 同一 workerd runtime 下，锁内复检性质存活：一次通过的 preflight 之后数据库被改动，
      `migrate` 仍然拒绝（`selected-migration.ts:80-84` 的注释所声明的性质，今天**没有**直接测试）。
- [ ] **(unit)** `snapshot.rb` 的 `REQUIRED_FILES` 不含 `migrations/atlas.sum`，含 Prisma 链的必需文件；
      `source_closure.rb` 的 `MIGRATION_DIRECTORIES` 不含 `migrations/neon`。
- [ ] **(unit)** `.github/test/` 的 11 个 Atlas 形状文件（§2.9）改完后仍为 207 个用例或有记录的增减，
      且无一条断言引用 Atlas 产物。
- [ ] **(unit)** `stagingOnlyBaseline` 在**发送端与接收端同一次改动里**消失
      （§2.11 的发送端 2 处、接收端 `preflight-metadata.ts:57` 的必填键集合、
      两条 `MIGRATOR_OIDC_POLICY === "production"` 拒绝路径）；
      `STAGING_ONLY_BASELINE` 与 `production-baseline-guard.sh` 在
      `.github/` / `infra/` / `scripts/` / `migrations/` 下零命中。
- [ ] **(unit)** §2.11 实测的 14 个断言点被**删除而不是 skip**；`.github/test/` 的用例数
      正好降 #1621 承诺的那几条，Worker 侧的 10 处随本 spec 的 W4 降。
- [ ] **(unit)** `docs/ops/deployment.md` 改成「生产 promotion 只由环境审批保护」并链到 #1621
      （#1621 的 AC5；放在这里是因为 §2.11 的文档面属于本 spec 的删除范围）。
- [ ] **(api)** 一次 staging CD 全程绿，receipt 里 `schema.prisma` 三元等值成立；
      生产人工批准与同产物 promotion 形态不变。**类型取 `(api)`**：它是对一个部署好的源站的断言。
      备选写法记在这里而不留作悬案——`docs/specs/2026-09-05-cicd-redesign-spec.md` 对同形条目
      用的是 `(ci)`，那不在 Quality Ratchet 的五类里；若将来要对齐，拆成「一条仓库内契约测试 +
      一条 §六 之外的发布证据」，而不是新增第六个类型。

### 6.4 测试数据面与本地门禁

- [ ] **(integration)** `startTestPostgres` 的 API 不变，9 个消费点零改动地通过。
- [ ] **(integration)** 测试容器里五个服务角色由 `packages/test-postgres` 自己建（§4.7）：
      `packages/pi-session-neon/test/acl.db.test.ts:9-10` 的五角色断言与
      `runtime-acl.db.test.ts:11` 的 `current_user = agent_svc` 不改一行就过。
      **变异**：去掉角色创建，这两条变红——而不是因为找不到角色而报一个别的错。
- [ ] **(unit)** `packages/pi-session-neon/test/postgres.ts` 不再导出 `oldTables`，
      `test/migration.db.test.ts` 的两条 Atlas 共存断言随之删除而不是 skip（§4.7）。
- [ ] **(unit)** `packages/test-postgres` 不依赖 `atlas` 二进制；`ATLAS_BIN` 环境变量不再被读。
- [ ] **(unit)** `pre-push-affected.sh` 对 `migrations/` 改动路由到新的校验命令；
      `db-fresh-schema.sh` 在无 Docker 时仍 fail-closed（`db-fresh-schema.sh:26-36` 的性质不变）。
- [ ] **(unit)** `Makefile` 的六个 `db-*` 目标换成 Prisma CLI 等价物，且 `db-push` / `db-push-dry`
      **不再存在**（它们要求 `NEON_DATABASE_URL`，与 ADR 0006 决策 6 的方向相反——
      本地 apply 到共享 Neon 这条路应随 Atlas 一起消失）。

---

## 七、工作范围与替换清单（波次；分卡是 stage 3）

波次描述的是**范围与顺序**，不是开工许可。owner 明确说还不开工，所以这里没有入口条件、
没有第一张卡、没有 owner 之外的任何触发条款。

**W0 · 前置**：#1589 落地（§八）。不与本 spec 并发。

**W1 · geography / trgm 扩展包**：把 geo-spike 抄成一个独立私有 workspace 包，校验器用 zod
（§4.3），加 pg_trgm 的两个操作（§4.4），跑 §6.2 的空间断言与两条变异。
**没有任何消费者切换**——这一波结束时 `workers/catalog` 仍在 Drizzle 上。

**W2 · contract 与第一条迁移**：改写 `packages/pi-session-neon` 那条链（§4.1），
contract 声明 catalog 16 + users 3 张表（§4.12），内容按 §4.8.1–4.8.5；
迁移用 `createTable` 族 + `rawSql`（§4.1）。`packages/test-postgres` 的链应用换口并接下角色创建
（§4.7）。这一波结束时**两条链并存**：Atlas 链仍是权威，Prisma 数据平面部分只在测试库上证过。

**W3 · 查询层切换**：`workers/catalog`（26 个 importer 文件）与 `workers/users`（5 个）按 §4.2
改口，两道守卫按 §4.10 重指向并补上 users 的缺口，Drizzle 从两个 `package.json` 消失。

**W4 · 迁移权威切换**：migrator 删 §2.2 的 774+38 行，握手按 §4.6 减半，
`stagingOnlyBaseline` 的收发两端同批删除（§4.9），`migrations/neon/` 删除，
`packages/pi-session-neon` 的 Atlas 共存 fixture 退役（§4.7），工作流与本地门禁按 §2.9 改，
`.github/test/` 的 11 个文件改断言。**这一波的最后一步是一次 staging CD 全绿 + receipt 证据。**

**W5 · 生产 baseline**：production 第一次迁移。它今天被
`production-baseline-guard.sh` 与 `migrations/neon/STAGING_ONLY_BASELINE` 挡着，而 §4.9 把这道闸门
按 owner 裁定**删除**。所以 W5 不再有「先设计替代闸门」的前置——**剩下的控制是 GitHub
`production` 环境的人工审批**，残余风险与三条重启触发器在 #1621。这一波之所以仍然单列在最后，
是因为它是唯一一次对生产数据面的破坏性动作，且它的安全性依赖「生产是空的」这个会过期的前提。

逐项替换表（文件级；每一行的执行卡在 stage 3 分）：

| 今天 | 之后 |
|---|---|
| `migrations/neon/*.sql`（9 个）+ `atlas.sum` | 删；替代品是 Prisma contract + 一条 baseline 迁移 |
| `migrations/neon/STAGING_ONLY_BASELINE` + `infra/database-access/production-baseline-guard.sh` + `cd.yml:193` | 删，不改嫁（§4.9 / #1621） |
| `stagingOnlyBaseline` 的收发两端（§2.11） | 同一次改动里删除 |
| `workers/migrator/src/` 的 10 个 Atlas 模块（§2.2） | 删 |
| `workers/migrator/src/sql.ts` | 收缩到 `dsnHost` + `assertDirectDsn` |
| `workers/migrator/src/{preflight-metadata,selected-migration,apply-lock,preflight,create-app}.ts` | 部分删除（§2.2） |
| `workers/catalog/src/db/{client,schema,expressions}.ts` | 重写为 Prisma contract + 扩展包引用 + per-request runtime |
| `workers/catalog/src/db/connections.ts` + `wrangler.toml:38-40` | 删 Hyperdrive 回落与注释绑定（§4.2） |
| `workers/catalog/src/enrich/parse.ts` | 写入契约从「写标量」改为「写 `location`」（§4.8.1） |
| `workers/users/src/db/{client,schema}.ts` + `adapters/neon-atomic-commit.ts` | 改口；id 所有权还给 `uuidv7()` 默认值（§4.2） |
| `workers/users/test/` | 新增 `dependency-rule` 守卫（§4.10） |
| `.semgrep/ts-no-{complete-sql-statement,sql-raw,direct-neon}.yaml` + 3 个 TS fixture | 合成一条 Prisma 逃生舱规则（§4.10） |
| `workers/catalog/test/dependency-rule.worker.test.ts:36,41,118-126,156-164` | 禁止包与变异用例一起重指向（§4.10） |
| `packages/test-postgres/src/atlas-chain.ts` | 换成 Prisma 迁移应用 + 角色创建（§4.7） |
| `packages/pi-session-neon/test/{postgres.ts,migration.db.test.ts}` | Atlas 共存 fixture 与两条断言退役（§4.7） |
| `scripts/migration-head.sh` | 删（没有文件名 head 了） |
| `scripts/local-gates/{pre-push-affected,db-fresh-schema}.sh` | 改口 |
| `Makefile:7,159-181` | 换成 Prisma CLI；`db-push*` 删 |
| `scripts/delivery/{migrate-through-worker,migrator-bundle,schema-preflight-testbed}.sh` + 两个 `.test.sh` | 按 §4.6 减半 |
| `.github/scripts/release/{schema-preflight.sh,record-receipt.mjs}`、`.github/lib/release/{snapshot,source_closure,receipt}.rb` | 按 §4.6 改 |
| `.github/workflows/pr-verification.yml:168,424,476,480`、`release-build.yml:54,58` | 删 Atlas 步 |
| `.github/workflows/cd.yml:114,246` | 整步删除（§4.6） |
| `.github/test/` 的 11 个文件（§2.9） | 改断言 |
| `workers/edge/test/migration-boundary.test.ts` 的 4 个用例 | 改写为 Prisma 权威边界 |

---

## 八、依赖与排序

### 与 #1317 战役（#1595–#1607）的碰撞

`docs/iterations/production-readiness-2026-08/1317-DECOMPOSITION.md`（commit `90f6af841`，
未在 `origin/main` 上）把 #1317 拆成 Cards A–N = #1595–#1607。两处相交：

1. **`.github/lib/release/snapshot.rb:35`** — 该文 §7 的表写得很清楚：
   今天 `images.keys.sort == %w[agent migrator]`；#1589 单独落地 → `%w[agent]`；
   Card J（#1606）单独落地 → `%w[migrator]`；两者都落 → `[]`，
   「at which point the whole `images` key, `validate_images`, `inspect-images.rb`,
   `registry-login.sh` and `docker/setup-buildx-action` are dead weight and should be
   **deleted**, not emptied」。**本 spec 不碰 `:35`**，它碰的是同一文件的 `:10`
   （`migrations/atlas.sum` ∈ `REQUIRED_FILES`）。两处在同一个文件里，但不在同一行。
2. **`apps/agent` 的 Atlas 工具**（`atlas_helper.py` + 四个 `test_atlas_*.py` +
   `conftest_db.py` / `db_config.py`）随 Card N（#1607）死。如果本 spec 的 W4 先落，
   这些 Python 测试会在一个没有 `migrations/neon/` 的仓库里红。

**排序建议**：#1589 → 本 spec 的 W1–W3（不碰发布管线）→ #1607（删 Python）→
本 spec 的 W4（发布管线）→ #1606 / Card J → 本 spec 的 W5。
理由：W1–W3 与 #1317 战役**零文件重叠**（它们改 `workers/catalog`、`workers/users`、
`packages/`，战役改 `workers/edge` 的 gateway 与 `apps/agent`），可以并行；
W4 与 #1606 都改 `.github/lib/release/` 与 `.github/test/`，必须串行，且每一次都要
「Land each one through a full `Release build → CD / staging` cycle before starting the other」
（同该文 §7）。

### 其它依赖

- **ADR 0006 决策 6**（`docs/adr/0006-platform-over-handwritten-ci.md:45`）是硬约束：
  本 spec 不得在任何环节让 CI 持有数据库凭据。migrator Worker 保留为唯一入口。
- **#1620** 是本 spec 的 geography 债登记处；**#1593** 是它的 bucket-B 裁决簿。
  本 spec 不重新裁决 #1620 已否掉的四条替代路线。
- **方法论授权**（§〇）是本 spec 的判据来源，不是可选参考：§4.8 的六条设计决定各自点名了
  决定它的原则，§4.10 在关一条授权尚未闭合的缺口（users 的依赖规则守卫）。
- **#1621** 承接生产闸门的移除与残余风险；本 spec 只提供删除范围（§2.11）与同批约束（§4.9）。
- **ADR**：本 spec 的决定（「一个工具拥有整个数据库层」）是架构级的，应落一条新 ADR 而不是改
  ADR 0006。注意 `docs/adr/0008-platform-over-handwritten.md` 已在 worktree `adr-0008` 的分支
  `docs/adr-0008-platform-over-handwritten` 上、尚未合入 `origin/main`（`origin/main` 的
  `docs/adr/` 只有 0001–0007），所以新 ADR 的编号要在它合入后再定。

---

## 九、风险

1. **Prisma 8 没有 stable，RC 带破坏性变更。** #1620 记着 rc.5 → rc.10 三周内每次都有破坏性
   authoring 变更，rc.8 → rc.9 一次带六个、三个动 authoring；`prisma@8.0.0-rc.13` 与
   `@prisma/orm-postgres@8.0.0-rc.9` 版本不同步（`PRISMA-8-VALIDATION.md:11-12` 明说要各自单独钉）。
   缓解：每个 import 都是声明的公开子路径、两个 descriptor 都带真实框架类型，所以 SPI 变更
   **落成编译错误而不是运行时惊喜**（#1620 原话）。但这对 `@prisma/orm-postgres/components/*` /
   `/relational-core/*` 这些**没有 authoring 参考文档**的路径只是部分缓解。
2. **`framework-gaps.md` G7 与 G2。** G7（列侧排序，`ORDER BY col <-> $param`，
   「the operator is the lowering」）标为「unstable post-#379」，而 `knnOrder` 正依赖那个接缝；
   G2 说扩展不能可靠地发 `CREATE INDEX … USING gist (geom)`。**G2 与我们的实测冲突**——
   geo-spike 的 `@@index([location], type: "gist")` 确实生成了
   `geo_points_location_gist_fb41678c`（`migrations/app/.../migration.ts:25-31`）并被
   `EXPLAIN` 用上。冲突的解释只有两种：文档陈旧，或者这条路在某个我们没走到的形状上会坏。
   本 spec 的态度是**按实测走、把冲突记下来**，并在 §六 用变异断言把它钉住。
3. **本次改动的爆炸半径是「所有数据访问」。** 两个 Worker 的每一条读写、9 个测试数据面消费者、
   整条发布管线。缓解是 §七 的波次把「不碰发布管线」与「碰发布管线」分开，
   以及 §2.6 的空库——一次错误的迁移不会毁数据。
4. **R4 — 生产失去 artifact 级闸门，这是一次有意的移除**（§4.9，owner 裁定，#1621）。
   剩下的控制是 GitHub `production` 环境的 `required_reviewers` + `branch_policy`，
   那是 **operator 级**的：它请一个人批准，并依赖那个人知道 payload 里装了什么；
   被删的闸门是 **artifact 级**的，危险随 payload 走，任何部署路径都绕不过。
   残余风险的确切形状与三条重启触发器在 #1621，**本 spec 不复制也不重新争论**。
   这里记的是它与本 spec 的耦合：Atlas → Prisma 的切换**本身就是那种危险的 payload**，
   它今天安全只因为生产是空的。
5. **护栏永真。** §2.10 两道、§4.10 的换法、§6.2 的变红验收。变红验证是唯一的缓解。
6. **一条链的 marker 写漏是静默通过。** §4.1 选一条链省掉了「两组断言」的风险，
   但四个断言点（`schema-preflight.sh:66-69`、`record-receipt.mjs:38-42`、`receipt.rb:23`、
   `verify-receipt.rb:21`）仍然共用同一个 hash；改动必须带变异断言（改一个字符，断言变红）。
7. **`enrich/parse.ts` 的写入方向反转**（§4.8.1）是唯一一处**行为**改动而不是形状改动：
   写入方从写标量改成写 `location`。如果某个写入点被漏掉，生成列会让它**直接报错**
   （生成列不可写），所以这个风险是响亮的而不是静默的——这也正是选生成列的理由之一。
8. **per-request 建连的延迟未测**（§十一 U6）。它落在 `/catalog/*` 的每一次读上。
   §6.2 有对照计时的 AC；超出预期就立优化卡，而不是回头改 §4.2 的形状。

---

## 十、文档清单（DOCS_POLICY 检查）

按 `docs/DOCS_POLICY.md` 的 Review Check（「这份文档在这次改动之后还成立吗」）。**本 spec 只写这一个文件；
下面是随实现卡一起必须改的清单，不是本次的产出。**

| 文档 | 要改什么 |
|---|---|
| `AGENTS.md:22` | `packages/test-postgres` 的「Atlas chain」 |
| `AGENTS.md:25` | `workers/migrator` 的「applies the `migrations/neon` Atlas chain」 |
| `AGENTS.md:26` | `migrations/neon/` 的「Atlas/Neon migrations」 |
| `AGENTS.md:128,130,134,140-141,154` | Drizzle / `atlas` skill 的路由行 |
| `docs/DOCS_POLICY.md:19` | 「Atlas migrations, browser tests, and IaC conventions」 |
| `docs/DOCS_POLICY.md:84` | DB 数据平面那一行（Drizzle + neon-http + Atlas + no Hyperdrive 四处都变） |
| `migrations/AGENTS.md` | 全文；特别是 `:8`（`atlas migrate hash`）、`:21`（`atlas.sum` 不得手改）、`:55-76`（表所有权）、`:78-86`（角色矩阵，见 §4.8.5） |
| **`.claude/rules/migrations.md`** | **整个文件删除。** 它今天已经是陈旧的：正文指向 `db/migrations/*.sql`（那个目录不存在，已迁到 `migrations/neon`），而它的 `paths:` frontmatter 是 `db/**`——即**它声称治理的文件一个都不匹配**，违反 `docs/DOCS_POLICY.md:63-64`（「Their YAML `paths` frontmatter must match the files whose behavior they govern」）。Atlas 退役后它连话题都没有了 |
| `workers/catalog/AGENTS.md:22,47,49,71` | Drizzle seam、workerd gotchas、Atlas 链 |
| `workers/users/AGENTS.md:30,47,53` | 同上 |
| `workers/migrator/AGENTS.md` | 迁移执行器的形态（`PRISMA-8-VALIDATION.md:83-88` 已描述 Prisma 侧） |
| `packages/test-postgres/AGENTS.md:8-11,29,34,101-103` | Atlas 链的三处 |
| `docs/ops/migrations.md` | 作者/应用边界、expand/contract、`atlas migrate hash` 的位置；三个 README 指向它（`migration-boundary.test.ts:88-92` 钉住） |
| `docs/ARCHITECTURE.md` | 数据平面的运行时参考 |
| `.claude/rules/infra.md:8-9` | **No Hyperdrive 的决定不变**（§4.2），但它给的理由变假了：「the catalog reaches Neon over `@neondatabase/serverless` (neon-http)」。改成 Prisma 的 per-request `pg` 客户端 |
| `docs/ops/deployment.md:366,370,409` · `workers/migrator/AGENTS.md:54,95` · `workers/edge/AGENTS.md:104` | `stagingOnlyBaseline` / baseline 闸门的三处描述（§2.11 文档面）；deployment.md 另有 #1621 AC5 要求的改法 |
| `workers/catalog/src/application/README.md:12-14` | 依赖规则的自述点名 `drizzle`，随 §4.10 重指向 |
| `docs/adr/` | 新 ADR（编号待 0008 合入后定，见 §八） |

---

## 十一、仍然不知道的（诚实的未知）

每条给「什么能定它」。**这些不是待办，是待查。**下面一条都没有被「给个答案」的方式删掉。

原 **U10（生产 baseline 闸门）已不在此列**：它被 owner 裁定成一次有意的移除（§4.9），
残余风险登记在 #1621。它从「未知」变成「已知且已接受的债」，不是被回答了。

- **U1 — `DISTINCT ON` + 子查询能不能用 Prisma 8 的 `sql` builder 写？**
  `workers/catalog/src/adapters/outbound/neon/gazetteer.ts:46-65` 用
  `selectDistinctOn([locations.id], {...})` + `.as("ranked")` + 外层再排序取 limit。
  **定它**：拿 geo-spike 的 `db.sql` builder 直接试一条等价语句，看能不能 `build()`；
  不能的话看 `db.raw.sql` 是唯一出路，还是有 window-function 的等价改写
  （后者更好——它不动 §4.10 的护栏）。
- **U2 — `ON CONFLICT … DO UPDATE … WHERE`（`setWhere`）在 Prisma 8 怎么表达？**
  `workers/users/test/reclaim-sql-shape.worker.test.ts:9-16` 记着这条区分为什么是正确性问题：
  staleness 谓词落进冲突目标的 index-predicate 槽会被非部分主键静默吸收，真 Postgres 随后会
  在保留窗口内覆盖一条已提交的行（#1222）。**定它**：在 test-postgres 上对 Prisma 8 的 upsert
  API 跑一次「陈旧行可回收、新鲜行不可覆盖」的双向断言。
- **U3 — `text[]` 数组列。** `saved_routes.point_ids`（`workers/users/src/db/schema.ts:22`
  的 `text("point_ids").array().notNull()`）。**定它**：在 contract 里声明一次、往返一次。
- **U4 — 经 `db.sql` 选 `location` 列本身，是否也解码成 GeoJSON？**
  §4.2 定案之后这是**唯一**的读路径（`db.orm` 在这两个 Worker 里不存在），
  而 geo-spike 的解码断言走的是 `db.orm`（`test/geography.db.test.ts:90-93`）；
  它的 `db.sql` 断言（`:74-88`）select 的是 `id` / `name` / `distanceM`，**没有 select
  `location` 本身**。**定它**：在 spike 里加一条 `db.sql…select("location")` 的断言。
  这条现在比初稿时更要紧，因为它从「补一条覆盖」变成了「主路径未证」。
- **U5 — `PRISMA-8-VALIDATION.md:51` 的「generated-column expressions」指什么？**
  `git grep -iE 'GENERATED ALWAYS|STORED|IDENTITY' origin/main -- 'migrations/neon/*.sql'`
  零命中，链里没有生成列（§2.5(b) 实测：71 条 `DEFAULT`、24 条 CHECK、6 个触发器、
  2 个函数、4 个扩展、5 个角色、1 个序列）。最可能的所指是**列 DEFAULT 表达式**。
  **定它**：对同一个从 Atlas 链建起来的库重跑一次 `prisma contract infer`，把输出与链逐对象比对，
  列出它实际漏掉的东西。这条不做，「漏一个是静默的」就没有清单可核。
  注意 §4.8.1 之后我们**自己**会有生成列，所以这条的答案还会决定 `db verify` 能不能守住它们。
- **U6 — 无状态 Worker 里 per-request 建连的延迟代价。** `./serverless` 每请求一条 `pg.Client`
  （`dist/serverless.mjs:55`）。§4.2 已经选了这条路，所以这是一条**测量义务**，不是决策输入。
  **定它**：staging 上对 `/catalog/*` 的读路径做切换前后对照计时。
  相关记录：容器未 pin 区域时每跳 208 ms、pin 到 APAC 后 74 ms——同一个洋不能白跨两次。
- **U7 — staging 现存对象的 owner 是谁？** `docs/specs/2026-09-05-cicd-redesign-spec.md:326`
  记着重置前的 34 张表里 26 张归 `neondb_owner`；`infra/database-access/reset-staging-baseline.sql:1-3`
  的 `DROP SCHEMA … CASCADE` 之后重建的应归 `migrator`。
  **定它**：一条 `SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public'`
  加一条 `SELECT extname, extowner::regrole FROM pg_extension`。
  它顺手定掉两件事：§2.6「staging 零业务行」的精确读法（表存在但空，还是表也不存在），
  以及 §4.8.2 的扩展迁移会不会撞 `must be owner`（`CREATE EXTENSION IF NOT EXISTS` 是 no-op，
  但若需要先 DROP 就要 owner 权限）。另有 `PRISMA-8-VALIDATION.md:86-87`：初始化
  `prisma_contract` 需要数据库级 CREATE，而 `reset-staging-baseline.sql:3` 只给了
  `USAGE, CREATE ON SCHEMA public`。
- **U8 — GIN trigram 索引（`gin_trgm_ops`）能不能用 `@@index(type: "gin")` 声明，
  还是必须 `rawSql`？** `20260826000003_catalog.sql:225` 带操作符类
  `USING GIN (alias_normalized public.gin_trgm_ops)`；geo-spike 证过的是不带操作符类的
  `type: "gist"`。**定它**：在 spike 里试一次带操作符类的声明。
- **U9 — Prisma 有没有「不需要数据库的链完整性校验」？** `atlas migrate validate` 是纯静态的，
  `pr-verification.yml:480` 与 `release-build.yml:58` 都用它；`prisma db verify` 需要一个库。
  **定它**：读 `@prisma/orm-toolchain/cli/control-api` 的导出面，看有没有
  「contract ↔ migration 图一致」的离线检查；没有的话 CI 的静态一段只能变成
  「在 test-postgres 上应用一次」，把一个秒级步骤变成分钟级。
- **U11 — §6.2 那条排序变异用的 fixture，要多大才抓得住？**（§4.11 引入的新未知。）
  实测里 sphere 与 spheroid 的 top-200 集合差异出现在 100k 行的东京形状上
  （`.spike/post.log` "C" 段 `set_diff = 2`）；rural 的 14 / 17 行探针**完全一致**。
  所以一个小 fixture 会让「把排序换回 `<->`」这个变异**不变红**——正是作用域外变异那类陷阱。
  **定它**：在 test-postgres 上从小到大扫 fixture 规模与点密度，找到 `set_diff > 0` 的最小形状，
  把那个规模写进 AC。在它被定下来之前，那条 AC 是「待标定」而不是「可验收」。

---

*本 spec 的每条事实都在 `origin/main = 3bb5621e4d4d7962a99dac83f6242c40a8941234` 上可复核；
spike 的证据在 worktree `spike-prisma-geography`（`packages/geo-spike/`）与 `spike-spatial-perf`
（`.spike/`）里，两者都是 spike，不是可上线代码。*
