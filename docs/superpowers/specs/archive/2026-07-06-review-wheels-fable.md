# 轮子审查报告(第二轮 · Fable)——独立复核 + 对照第一轮

> 时点 worktree @ 5529b9b。先独立完成 A/B,后对照 opus 报告输出 C/D。已核对决策台账 SD-0~30 + X1-X16 后下判定。
> Coordinator 裁决(2026-07-07):**采纳全部 dispute**(A3 降"不换"、A2 降"不再新增用法");合并 Top 3 以本文 D 节为准。

**依赖基准修正(实测 venv/lockfile,纠 opus 一处失实)**:tenacity 9.1.4 与 cachetools 7.1.4 **已在 venv**(传递依赖);pydantic-ai 自带 `retries.py`(TenacityTransport)与 `common_tools/duckduckgo.py`(site-packages 实测存在)。TS 侧 pnpm-lock 全解析到 @orpc 1.14.6。

## A. 独立轮子清单

### Quick-win
| # | 现状 | 方案 | 删行 | 判定 |
|---|---|---|---|---|
| F1 | `workers/catalog/src/router.ts:53` `os.$context`+`type<T>()` passthrough,:29 注释自陈"MUST stay in lockstep"=人工同步;**catalog 无 @seichijunrei/contract 依赖**,服务端不消费自己的契约;公网端点 lat/lng 零校验直达 SQL | `implement(catalogContract)`(@orpc/server 原生):编译期锁形状+运行时 zod 校验 | 消灭整类漂移;bundle +~15KB gz | **quick-win;X11「契约即产品」/SD-2 字面落地** |
| F2 | `pyproject.toml:46` pydantic-ai-guardrails==0.2.2 **零 import** | 删依赖 | 1 dep | quick-win |
| F3 | reverse-geocoder 是生产依赖但运行时零 import(唯一消费者 scripts/backfill_city.py)——**拖 numpy+scipy ~70MB 进容器镜像** | 移 dev/scripts 组 | 镜像瘦身 | quick-win |
| F4 | `utils/logger.py:153-232` LogContext/LogTimer 生产零引用;LogTimer 与 Logfire span 重复(同 SD-18 已裁的 P3) | 删 | ~80 | quick-win |
| F5 | `infrastructure/supabase/client.py:28` importlib hack + client_types.py 74 行手写 Protocol(绕 asyncpg 无类型) | dev 依赖 asyncpg-stubs,正常 import | ~80 | quick-win |
| F6 | `agents/web_tools.py:40-65` 手写 DDGS 同步→executor 搬运 | `pydantic_ai.common_tools.duckduckgo.duckduckgo_search_tool()`(官方同款方案);**SD-19 P0 定界包外层不受影响** | ~30 | quick-win |

### Story 级
| # | 现状 | 方案 | 删行 | 判定 |
|---|---|---|---|---|
| F7 | **aiohttp 客户端栈**:base.py 433+cache.py 338+cache_mixin 70+retry 段+clients/retry.py 105+anitabi.py 295 ≈ **1,376 行**;运行时唯一消费者 = translation.py:75-77 的 BangumiClient(Anitabi 仅 scripts);且 aiohttp 绕过 logfire[httpx] 插桩→**Bangumi 出站调用 trace 隐身(违 SD-21)** | translation 改 httpx(或按 X12 走 catalog);anitabi/bangumi 客户端降级 scripts 自带;整栈删除 | **~1,200** | story(最大件;X12 本判死刑勿再抛光) |
| F8 | observability/ 手写 OTel 全家桶 658 行,与 logfire 双轨;coverage omit=长期无测试 | 收敛 logfire.metric_counter/span;留 runtime.py 薄封装 | ~400-500 | story |
| F9 | `worker/auth.ts:13-24` verifyJwt 每请求网络回源 Supabase | jose createRemoteJWKSet 本地验签 | 净增 15 行换掉每请求网络往返 | story [unverified: 需 Supabase 非对称 key] |

### 不换有理
haversine ✅ / 贪心 NN + union-find(**SD-28 已定案基座**,n≤几百 O(n²) 毫秒级;详见 C-dispute)/ jobs.ts SQL 单飞 ✅ / media/img.ts 懒拉+墓碑(license 源站脆弱,产品需求)✅ / CatalogClient 手写模型 ✅(但 `_post_json:165` **每请求新建 AsyncClient 应改共享**——库用得不够而非不该用)

## B. 漂移复核

- 确认 opus B 表:backend/↔apps/agent 全部"worktree 新"。
- **新发现(repo 级反向漂移,需裁决)**:主 repo `docs/frontend-rebuild-plan` 分支有 **11 commit 不在 feat/frontend-rebuild**——含首页实作(6921d10 magic-link 登录、bcd3f05、1091341 locale switcher 等 iter15 系)与 docs 恢复(d95b0a4、75f326b)。TanStack 重建若以 feat/frontend-rebuild 为基,这批将被无声丢弃。
- main 上 a1583ce(+/v1/chat)+79f34a8(revert)净零,worktree 已独立重落 chat.py,无缺口。

## C. 对照第一轮

**confirm**:A1、A4、"不换有理"表各条、B 表、D 表 pg/codegen 行。

**dispute(Coordinator 已采纳)**:
1. **A3 ST_ClusterDBSCAN → 降"不换"**:①只吃 geometry 平面距离,points.location 是 geography,eps=50m 须 ST_Transform(JGD2011 分带)或度数近似(纬度依赖误差)——SRID 管道成本被略过;②流程本就拉行进内存做贪心 NN;③parity 回归成本>删 230 行收益,违 3× 纪律;④与 SD-28"纯函数零 I/O 基座"相抵。触发点:点位上万再议。
2. **A2 去 drizzle → 降"不再新增查询构建器用法"**:sql 标签→neon() 标签是同构改写非删除,依赖因 SD-1 反正留下,净删远小于 110。
3. A5 结论对理由过时:cache 随 F7 整栈死,单独议是浪费。
4. opus D 表 reverse-geocoder"✅ 正确用库"——错,见 F3。
5. opus D 表 @orpc/zod"合理"——不同意,见 F1(bundle 15KB 不成立为否决理由)。
6. opus 依赖基准"未装 tenacity/cachetools"失实(均在 venv,且 pydantic-ai 自带 retries/DDG 工具)。

**new**:F1-F9 + 11-commit 反向漂移 + `clients/retry.py:103-105` `_is_client_error` **子串匹配 bug**(错误信息任意位置含"400"即拒重试)+ catalog_client 每请求新建 AsyncClient + clustering.ts 8 处 eslint-disable(违零抑制纪律,旁注)。

## D. 修订后合并 Top 3(两轮合议,Coordinator 采纳为最终版)

1. **F1 router.ts → implement(catalogContract)**(quick-win):消灭人工 lockstep 整类漂移 + 公网入参免费 zod 校验。opus 原 Top-2/3(A3/A2)撤下。
2. **F7 aiohttp 栈死刑执行**(story,~1,200 行):吸收 opus A1(其 Top-1 的 150 行只是冰山一角)与 A5;顺带修 trace 隐身。
3. **卫生批**(半天):F2+F3+F4+F5+F6;外加 A4/SD-9 runtime.py 退役按既定计划随 chat 迁移收尾。

**待 Coordinator/用户单独裁决**:B 节 11-commit 首页工作去留(漂移风险,非轮子)。
