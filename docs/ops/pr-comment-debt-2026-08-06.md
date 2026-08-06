# PR 评论清欠台账(2026-08-06,从 GitHub 重新取证)

> 背景:#759 历史 PR 评论清欠。2026-08-03 盘点只查行级线程、漏看顶层评论(qodo 的
> Bugs/Rule violations 计数与 SonarCloud Quality Gate 不产生线程)。本台账从 GitHub
> **重新取证** #477–#560 全部已合并 PR 的**两路**评论(行级 review threads +
> 顶层 issue comments),并逐条到 `origin/main`(初始判定基线 038a10a8;
> FIX ROUND 4 重基至 246eeab2,见过程记录)核实时效。
> 零代码修复;修复由后续卡按文末切分派工。

## 枚举范围

- `gh pr list --state merged --limit 500` 共 **471** 个已合并 PR,落在 #477–#560 区间的
  **26 个**(比 8-03 盘点时的 22 个多出 #536/#539/#542/#544/#548/#551/#553/#554/#557/#559,
  均于 07-29~07-30 合并)。--limit 200 会截断(恰返回 200 条),本卡以 500 复核无遗漏。
- 26 个 PR 全部取到行级线程 + 顶层评论。顶层评论构成:qodo PR 摘要 + qodo Code Review
  计数(或 "no issues")(每个 PR 都有)、coderabbit 评论(26/26,其中 22 条为限流/跳过等
  状态通知、4 条 walkthrough 叙事摘要,均不产生独立 finding,分类见过程记录)、
  SonarCloud Quality Gate 评论(每个 PR 都有)。#491/#551 的 qodo Code Review 为零
  finding;#490 仅 1 条 Optional。

## 每 PR 完整性自检(顶层 N / 线程 M / 台账行 K)

> FIX ROUND 2(2026-08-06):首版台账只记了线程,顶层专属 finding 被系统性丢弃。本表对每个
> PR 分别数出 N(顶层**全部来源**的 finding 条目数 = qodo Code Review 条目 + coderabbit
> 顶层摘要条目 + SonarCloud FAILED 门数)、M(review threads 数)、K(台账行数),
> 断言 **K ≥ max(N, M)**;K 为顶层与线程的并集,故 K 通常 ≤ N + M,凡 K < N 的 PR
> 均已补行(详见下方缺陷表)。来源覆盖(FIX ROUND 3 逐 PR 复核):26 个 PR 的 coderabbit
> 顶层评论逐条读取并分类——22 条为状态通知(跳过/文件超限/已关闭/限流/无 actionable),
> 本身零 finding;4 条 walkthrough 摘要(#501/#513/#539/#559)为叙事性文件级汇总,其
> finding 级条目全部落在线程,台账已含对应行,无"仅存在于 coderabbit 顶层"的漏记。
> 每个顶层来源的每条条目均与台账行逐一比对(计数断言 K ≥ max(N, M) 仅作补充校验,
> 不代替逐条比对)。

| PR | 顶层 N | 线程 M | 台账行 K | 状态 |
|---|---|---|---|---|
| 477 | 2 | 3 | 3 | ✓ |
| 478 | 2(qodo 1 + SonarCloud Failed) | 2 | 3 | ✓ |
| 479 | 1 | 3 | 3 | ✓ |
| 480 | 1 | 2 | 2 | ✓ |
| 483 | 5(qodo 4 + SonarCloud Failed) | 4 | 5 | ✓ |
| 490 | 1 | 0 | 1 | ✓ |
| 491 | 0 | 0 | 0 | ✓ |
| 492 | 0 | 2 | 2 | ✓ |
| 493 | 0 | 2 | 2 | ✓ |
| 495 | 1 | 1 | 1 | ✓ |
| 501 | 0 | 6 | 6 | ✓ |
| 513 | 1 | 5 | 5 | ✓ |
| 514 | 2 | 4 | 4 | ✓ |
| 515 | 3 | 6 | 6 | ✓ |
| 523 | 1 | 2 | 2 | ✓ |
| 528 | 0 | 1 | 1 | ✓ |
| 536 | 3 | 6 | 6 | ✓ |
| 539 | 2 | 2 | 2 | ✓ |
| 542 | 3 | 2 | **3(补 1:buildHandler 超行)** | ✓ 修复 |
| 544 | 3 | 3 | 3 | ✓ |
| 548 | 2 | 9 | **9(补 1:pnpm install --ignore-scripts)** | ✓ 修复 |
| 551 | 0 | 0 | 0 | ✓ |
| 553 | 4 | 3 | **4(补 1:handle_photo_search 超行)** | ✓ 修复 |
| 554 | 4 | 3 | **4(补 1:_run_pipeline 超行)** | ✓ 修复 |
| 557 | 6 | 5 | **6(补 1:Rule 2399064 Wrangler routing 键)** | ✓ 修复 |
| 559 | 3 | 5 | 5 | ✓ |

修复前缺陷(首版 K < max(N, M),均已补):#542(N 侧 3>2)、#548(M 侧 9>8)、#553(4>3)、#554(4>3)、#557(6>5)五条;首版只取不记的机制性漏洞即在此:qodo 的 **Rule 2399064(Wrangler routing 键)**、**`buildHandler`/`_run_pipeline`/`handle_photo_search` 超行**、coderabbit 的 **`--ignore-scripts`** 均只存在于顶层评论/线程而无台账行。

## 台账(88 条 finding)

列:`PR | 位置(file:line) | 机器人 | 摘要(≤80字) | 判定 | 证据 | 建议卡名`
位置指 **finding 提出时的文件:行**;判定依据为**当前 main** 上的状态。

| PR | 位置(file:line) | 机器人 | 摘要 | 判定 | 证据 | 建议卡名 |
|---|---|---|---|---|---|---|
| 477 | apps/agent/agent/agents/byok_models.py:142-143 | qodo | 仅 provider/key 缺失时把 BYOK 当缺席,model/base-url 孤儿头静默回落服务端默认模型 | OBSOLETE-FIXED | main parse_byok_credential 显式拒绝孤儿头("require X-BYOK-Provider and X-BYOK-Key") | — |
| 477 | apps/agent/agent/agents/byok_models.py:87 | qodo | _decode 放行 UnicodeDecodeError → 非法 UTF-8 头回 500 而非 400 invalid_request | OBSOLETE-FIXED | #608 (1626e2a9) _decode_header 捕获并转 ByokError | — |
| 477 | apps/agent/agent/interfaces/public_api.py:357 | qodo | BYOK 转译辅助调用用量整体按零计价,服务端真实花费不入计量 | OBSOLETE-FIXED | main _attributed_usage 拆分零价 BYOK 与补充调用(#554 重构后) | — |
| 478 | docs/ops/cloudflare-hardening.md:229-231 | qodo | runbook 声称 egress_guard 已生效,当时该守卫尚未实现 | OBSOLETE-FIXED | 守卫已随 #477/#479 落地,doc 现有 "What is implemented" 段 | — |
| 478 | docs/ops/cloudflare-hardening.md | qodo | Task 7 验收来源链接失效 | OBSOLETE-FIXED | main :174-176 验收来源已落树(docs/superpowers/specs/2026-07-28-284-byok-design.md 内链,Threat Model T1–T14) | — |
| 478 | 顶层 SonarCloud | sonarqubecloud | Quality Gate FAILED:B Maintainability Rating(文档新代码) | OBSOLETE-REWRITTEN | PR 快照指标;该文档此后经多轮改写(#766 等),评分对象已变 | — |
| 479 | apps/agent/agent/interfaces/routes/byok.py:195-197 | qodo | 5s 超时只包模型调用,DNS 双校验可各自再耗 5s,超墙钟 | OBSOLETE-FIXED | main byok.py:207/341 asyncio.timeout 包住整段探测(注释 "fixed ≤5s wall-clock") | — |
| 479 | apps/agent/agent/interfaces/routes/byok.py | qodo | 429/5xx 被当成功返回,探测结果失真 | OBSOLETE-FIXED | main 错误分类折叠为 provider_unreachable | — |
| 479 | apps/agent/agent/interfaces/routes/byok.py | qodo | 畸形响应逃逸探测错误分类 | OBSOLETE-FIXED | main _run_probe bare except("(#479 P1-2 review follow-up)" 注释) | — |
| 480 | apps/web/src/features/chat/use-byok-settings.ts:112-114 | qodo | 过期探测结果覆盖替换后凭证的 vision 状态 | OBSOLETE-FIXED | main 引入 generation 代际,丢弃过期结果("stale in-flight probe can never paint…") | — |
| 480 | apps/web/src/lib/chat/errorClassifier.ts:68 | qodo | 重算失败屏蔽 D13/D14 BYOK 状态,拒键用户看不到登录/不重试边界 | OBSOLETE-FIXED | 95bfcdb5 use-turn-failure.ts:122 显式放行 D12/D13/D14 | — |
| 483 | apps/web/src/components/auth/useAuthCallback.ts:35-37 | qodo | 登录回调不调 /v1/session/migrate,匿名会话不随登录迁移 | OBSOLETE-FIXED | #514 接入迁移端点 | — |
| 483 | .github/workflows/_deploy-component.yml:70 | qodo | web 构建导出旧 NEXT_* 变量,Vite 构建缺配置 | OBSOLETE-FIXED | #584 (8046e595) VITE_* preflight;main reusable-deploy-component.yml:333-382 | — |
| 483 | apps/agent/agent/interfaces/routes/photo_search.py:249 | qodo | 匿名照片搜索按成员配额计费 | OBSOLETE-FIXED | #553 修复匿名档位 | — |
| 483 | apps/web/src/features/chat/save/deferredSave.ts:65 | qodo | 存储写入未包 try,隐私模式/配额满时 save wall 崩溃 | OBSOLETE-FIXED | #613 (0d549366) removeForClaim/takeFromStore 带捕获 | — |
| 483 | 顶层 SonarCloud | sonarqubecloud | Quality Gate FAILED:D Reliability + D Security(新代码) | OBSOLETE-REWRITTEN | PR 快照;引发评分的线程均已修(#514/#553/#613 等) | — |
| 490 | .github/workflows/ci.yml:64 | qodo | changes 任务对所有事件 fetch-depth:0,PR 事件本可用 API 免全量克隆 | STILL-VALID | main ci.yml:73 仍 fetch-depth:0;注释记录 #483 推送事故,属有意的 P4 取舍 | C5a |
| 492 | .github/workflows/_deploy-component.yml:177-195 | qodo | wrangler secret put 缺 CLOUDFLARE_API_TOKEN/ACCOUNT_ID,未认证必失败 | OBSOLETE-FIXED | 工作流改名 reusable-deploy-component.yml;main :512-513/:565 secret put job env 已注入两凭据 | — |
| 492 | .github/workflows/_deploy-component.yml | qodo | Pulumi 导出作为 30 天 artifact 保留,涉密风险 | OBSOLETE-FIXED | main :486-492 明确拒绝 artifact 通道(公开仓 + plaintext 标识符),改为 R2 回滚备份(:530-555) | — |
| 493 | .github/scripts/post-deploy-assert.sh:19-25 | qodo | curl 无超时/重试,网络卡死或 flaky | OBSOLETE-FIXED | main fetch() --connect-timeout 10 --max-time 20 + 5 次退避 | — |
| 493 | .github/workflows/_post-deploy-test.yml:93 | qodo | 无条件解析 root/web 两个 URL | OBSOLETE-FIXED | 工作流改名 reusable-post-deploy-test.yml;main :123-135 按环境经 resolve-worker-url.sh 解析(root/web 分开) | — |
| 495 | docs/iterations/iter5/progress.md:34 | qodo | "wired by #447 (see below)" 悬空引用,无下文 | OBSOLETE-FIXED | #576 (514f374f) 补 #447 章节 | — |
| 501 | .github/workflows/_deploy-component.yml:130 | qodo | LOGFIRE_TOKEN && \|\| 链缺省回落旧 secret,staging/prod 痕迹混合 | OBSOLETE-FIXED | 工作流改名 reusable-deploy-component.yml;main :176/:186/:599 按环境注入 secret 并做 hash8 前缀校验,无回落链 | — |
| 501 | worker/containerEnv.test.ts | github-advanced-security | CodeQL:反斜杠转义不完整 | OBSOLETE-FIXED | 文件移至 workers/edge/container-env.test.ts(#652+#811 重命名);main :213 escapeRegExp 转义反斜杠,:244-246 有 CodeQL js/incomplete-sanitization 回归测试 | — |
| 501 | apps/agent/agent/config/settings.py:254 | coderabbit | CORS 文档与放宽后的校验不一致 | OBSOLETE-FIXED | main :179 字段描述 "Set to actual domain in production"、:186 校验 docstring "Reject wildcard CORS in production",与实际校验一致 | — |
| 501 | apps/agent/agent/tests/unit/test_deploy_model_env_consistency.py:89 | coderabbit | 测试函数超 10 行 | OBSOLETE-FIXED | #576 抽 _required_deploy_keys() | — |
| 501 | docs/ops/deployment.md | coderabbit | 应 provision 具体 staging CORS origin 再写文档 | OBSOLETE-FIXED | main wrangler.toml:280-286 已 provision 真实 staging origin(注释引 #527/#528) | — |
| 501 | worker/containerEnv.test.ts:219 | coderabbit | appEnvInBlock 超函数限长 | OBSOLETE-FIXED | 文件移至 workers/edge/container-env.test.ts;main :216-230 恰 10 条可执行语句(注释不计) | — |
| 513 | apps/agent/agent/config/settings.py:283 | qodo | validate_required_env 超 10 行 | STILL-VALID | main settings.py:231-245 仍 15 行(P4 风格) | C5b |
| 513 | apps/agent/agent/tests/unit/test_purge_cron_settings.py:20/27 | qodo | filterwarnings 压制无批准注释,违禁 | OBSOLETE-FIXED | #576 删除该 pytestmark | — |
| 513 | apps/agent/agent/config/settings.py | qodo | get_db_only_settings 内部构造 Settings 污染 get_settings 缓存 | OBSOLETE-FIXED | 7c8abe6f(#508 rework)独立 PurgeCronSettings | — |
| 513 | apps/agent/agent/scripts/purge_anon_quota_counts.py:58 | coderabbit | GITHUB_STEP_SUMMARY 写入失败拖垮整个 purge 运行 | OBSOLETE-FIXED | main _write_step_summary 捕获 OSError 记日志(:61-67) | — |
| 513 | apps/agent/agent/tests/unit/test_purge_cron_settings.py:27 | coderabbit | 移除宽泛警告压制 | OBSOLETE-FIXED | #576 已移除 | — |
| 514 | apps/web/tests/unit/auth/use-auth-callback.test.tsx | qodo | warn 断言缺参数 | OBSOLETE-FIXED | main :62 `toHaveBeenCalledExactlyOnceWith(` 显式断言参数 | — |
| 514 | apps/web/src/components/auth/useAuthCallback.ts:73-76 | qodo | Promise.all 等迁移完成,登录完成被拖至超时上限 | STILL-VALID | main redeem():102-104 仍并行等待迁移;owner 已在代码注释说明取舍(P3) | C4 |
| 514 | apps/web/src/components/auth/useAuthCallback.ts | qodo | 迁移 throw 会把成功登录翻成 error | OBSOLETE-FIXED | main runMigration 有 .catch,"structurally incapable of rejecting" 注释 | — |
| 514 | apps/web/src/components/auth/useAuthCallback.ts | qodo | withTimeout 不中止迁移请求 | OBSOLETE-FIXED | owner 裁定保留(#507 ruling,代码注释 "the one case the #507 owner ruling rescues"),didMigrate 门控收尾 | — |
| 515 | apps/agent/agent/tests/unit/test_vision_supply_router.py | qodo | 新增测试超 10 行 | OBSOLETE-REWRITTEN | 文件已从 main 删除;套件拆分为 test_photo_vision.py(166 行)+ test_photo_search_route*.py(#656 photo_vision 重写) | — |
| 515 | apps/agent/agent/tests/unit/test_photo_search_route.py:89 | qodo | 路由级测试超 10 行 | OBSOLETE-FIXED | #576 抽 _outage_app/_assert_clarify_response | — |
| 515 | apps/agent/agent/tests/unit/test_settings.py | qodo | filterwarnings 无批准注释 | OBSOLETE-FIXED | main test_settings.py 全文无 filterwarnings(grep=0),marker 已删 | — |
| 515 | apps/agent/agent/config/settings.py:394 | qodo | GEMINI_API_KEY 缺省 UserWarning 在 filterwarnings=error 下炸 pytest | OBSOLETE-FIXED | main settings.py:324-339 告警集合已不含 GEMINI_API_KEY(仅 DEEPSEEK/MIMO/OPENAI_COMPAT) | — |
| 515 | apps/agent/agent/agents/vision_supply_router.py:228 | qodo | 瞬时错误把 BYOK 端点降级为"无视觉能力" | OBSOLETE-FIXED | main photo_vision.py:51-63 `_RECOGNITION_FAILURES` 类型化收窄(含注释 "Deliberately excludes ValueError"),:105-111 `_try_byok` 瞬时错误按调用回退而非降级端点 | — |
| 515 | apps/agent/agent/agents/vision_supply_router.py:186 | qodo | 失败日志只记 error_type,缺 status_code/provider 维度 | OBSOLETE-REWRITTEN | 文件已重写为 photo_vision.py(#656 系);新文件 :111/:124 仍只记 error_type,建议修复卡在该文件重核 | C3 附注 |
| 523 | .github/scripts/post-deploy-assert.sh:109 | qodo | fetch() 内 if 嵌套超 2 层 | OBSOLETE-FIXED | #610 (85416f68) 抽 retry_reason_for 展平 | — |
| 523 | .github/scripts/post-deploy-assert.sh | qodo | curl 失败被当作"非边缘错误",404 即停止重试 | OBSOLETE-FIXED | #610 后 rc≠0 归为 transport failure 进入重试 | — |
| 528 | .github/workflows/ci.yml:448 | qodo | staging 容器 CORS 回退 '*' 与 APP_ENV=production 冲突,启动失败 | OBSOLETE-FIXED | main ci.yml:811-814 注释确认 CORS_ALLOWED_ORIGIN 移出 secrets、改由 wrangler.toml:280-286 env.staging.vars 提供真实值 | — |
| 536 | .github/scripts/post-deploy-assert.sh:70 | coderabbit | ACCEPT_HEADER 未校验,JSON 非首位时 CF 回 HTML,cloudflare_error 漏判跳过重试 | STILL-VALID | main fetch():115-117 仍读环境变量 ACCEPT_HEADER,仅文档说明未落地强制 | C1 |
| 536 | .github/scripts/post-deploy-assert.test.sh:175 | coderabbit | case4 mock 只查 text/html 出现,不查 application/json 首位 | STILL-VALID | main :171 仍 'text/html' not in Accept;case3 有并行守卫但 case4 未改 | C1 |
| 536 | .github/scripts/post-deploy-assert.test.sh:188 | coderabbit | /tmp/htmlonly.out 可预测路径,符号链接/TOCTOU(CWE-377) | STILL-VALID | main :185/:189 仍写读 /tmp/htmlonly.out(另有 /tmp/cfedge404.out 等) | C1 |
| 536 | .github/scripts/post-deploy-assert.sh:105 | qodo | fetch() 26 行超 10 行 | STILL-VALID | main fetch():115-139 计 23 行 | C1 |
| 536 | .github/scripts/post-deploy-assert.test.sh:191 | qodo | test_html_only_origin_is_accepted 29 行超限 | STILL-VALID | main :161-191 计 29 行 | C1 |
| 536 | .github/scripts/post-deploy-assert.sh:103 | qodo | 隐式 ACCEPT_HEADER 环境变量易碰撞,改动所有 fetch 行为 | STILL-VALID | main :107-117 仍读环境变量(仅文档说明) | C1 |
| 539 | workers/catalog/test/wrangler-private.worker.test.ts:65-67 | qodo | workers_dev 断言要求精确行匹配,格式微调即误报 | STILL-VALID | main :88-90 仍 arrayContaining(["workers_dev = false"]);#576 尝试改写被回滚,文件注释声明"刻意行级解析" | C2 |
| 539 | workers/catalog/test/wrangler-private.worker.test.ts:60 | coderabbit | 测试文件含条件逻辑(sections/nameOf) | STILL-VALID | main :43-58 条件逻辑仍在 | C2 |
| 542 | apps/web/tests/unit/noindex-header.test.ts:57 | qodo | 测试缺 type: 注释 | PHANTOM | main noindex-header.test.ts 全文无 type: 注释(grep=0);仓库无此约定(qodo 自注 "No historical evidence found");线程静默关闭 | 无需卡 |
| 542 | apps/web/tests/unit/wrangler-app-env.test.ts:35 | qodo | Object.keys 顺序敏感断言易碎 | STILL-VALID | main :34 仍 toEqual 顺序断言(现带 guard 注释,属有意;P4) | C5c |
| 542 | apps/web/tests/unit/noindex-header.test.ts:12-37 | qodo | buildHandler() 函数体超 10 行(顶层 Skill insight,无线程) | STILL-VALID | main :24-48 仍 22 物理行(P4 风格) | C5c |
| 544 | apps/web/tests/unit/seo/head-wiring.test.ts:12 | qodo | 测试缺 type: 注释 | PHANTOM | main head-wiring.test.ts 无 type: 注释;仓库无此约定(同 #542-1/#554-3) | 无需卡 |
| 544 | apps/web/src/features/seo/home-structured-data.ts:19 | qodo | SearchAction 指向 /?q=,实际搜索入口是 /chat?q= | STILL-VALID | main :17-20 仍 ${HOME_URL}?q=;index.tsx 不读 ?q= 参数(搜索框提交才跳 /chat) | C3 |
| 544 | apps/web/src/features/seo/head.ts:41 | qodo | og:url/og:title 硬编码首页,非首页共用首页卡片 | STILL-VALID | main SITE_META:35-47 og:url=HOME_URL;__root.tsx:61-63 注释承认 "deeper routes override title only" | C3 |
| 548 | worker/app.ts:369 | qodo | createWorkerApp 超 10 行 | OBSOLETE-FIXED | #576 拆 WorkerDeps + registerWorkerRoutes | — |
| 548 | Makefile:93 | qodo | executor.md/css.md 仍引用已删 frontend/ 与 fe-* 目标 | OBSOLETE-FIXED | 后续文档重写(cf1b9cb2/23d9516a 等),现无残留引用 | — |
| 548 | .github/workflows/dependabot-agent.yml | coderabbit | agent 复现命令未含 web 构建 | OBSOLETE-FIXED | main dependabot-agent.yml:94-96 "Web + worker quality" 步已并入复现(pnpm run verify:dependabot) | — |
| 548 | .github/workflows/dependabot-agent.yml:64/158 | coderabbit | pnpm install 缺 --ignore-scripts,依赖生命周期脚本可在持 repo token 的 runner 上执行(SonarCloud SAST) | OBSOLETE-FIXED | main :70-75 install 已带 `--ignore-scripts` 并有注释说明阻断理由 | — |
| 548 | docs/ops/deployment.md:230 | coderabbit | ASSETS 路由文档过时 | STILL-VALID | main :13 拓扑图仍画 `static paths ─▶ Cloudflare ASSETS`,:244 却说 #537 已移除 [assets] binding、无 HTML 面 — 自相矛盾仍在 | C5f |
| 548 | docs/ops/deployment.md:308 | coderabbit | 路由表漏匿名 catalog 路由 | OBSOLETE-FIXED | main :239/:358 已列 /catalog/public/anime-overview/:id | — |
| 548 | Makefile:174 | coderabbit | 环境就绪报告未等 web 就绪 | OBSOLETE-FIXED | main Makefile:193-196 措辞改 "Web app starting on :3000"(不再声称 ready),与 sleep 3 配套 | — |
| 548 | scripts/local-login.sh:50 | coderabbit | magic link 重定向到不可用登录路由 | OBSOLETE-FIXED | #576 已修 | — |
| 548 | worker/app.ts:368 | coderabbit | 网关工厂扩展前应拆分 | OBSOLETE-FIXED | #576 拆分完成 | — |
| 553 | apps/agent/agent/interfaces/routes/photo_search.py:250-252 | qodo | authenticated 布尔缺 is_ 前缀 | OBSOLETE-FIXED | main photo_search.py:214 已改名 is_authenticated | — |
| 553 | apps/agent/agent/interfaces/usage_metering.py:75 | qodo | is_anonymous_identity 用裸 str 类型 | STILL-VALID | main usage_metering.py:71 仍 `user_id: str \| None, user_type: str \| None`(P4 风格) | C5b |
| 553 | apps/agent/agent/interfaces/usage_metering.py:76 | qodo | 匿名判断仍重复 | OBSOLETE-FIXED | main _deps.py:33 导入并统一走 is_anonymous_identity(_reject_credentialed_anonymous :110-123),无内联重复实现 | — |
| 553 | apps/agent/agent/interfaces/routes/photo_search.py:247-255 | qodo | handle_photo_search 函数体超 10 行(顶层 Skill insight) | OBSOLETE-FIXED | main :213-230 函数体恰 10 条可执行语句,逻辑抽至 _byok_login_rejection/_budget_rejection/_prepare_turn | — |
| 554 | apps/agent/agent/interfaces/public_api.py:818-824 | qodo | _record_attributed_usage 5 参数超 3 | STILL-VALID | main :844-850 仍 5 参数(usage_repo/item/user_id/user_type/platform_prices)(P4 风格) | C5b |
| 554 | apps/agent/agent/interfaces/public_api.py:841 | qodo | user_id 裸 str 注解 | STILL-VALID | main :847 仍 `user_id: str \| None`(P4 风格) | C5b |
| 554 | apps/agent/agent/tests/unit/test_byok_translation_billing.py:199 | qodo | 测试缺 type: 注释 | PHANTOM | main 文件全文无 type: 注释(grep=0);qodo 自注 "No historical evidence found";仓库无此约定 | 无需卡 |
| 554 | apps/agent/agent/tests/unit/test_byok_translation_billing.py:76-95 | qodo | _run_pipeline 函数体超 10 行(顶层 Skill insight) | STILL-VALID | main :78-90 仍 13 物理行(4 条可执行语句 + 多行调用参数)(P4 风格) | C5b |
| 557 | apps/agent/agent/tests/integration/test_byok_probe_containment.py:120 | qodo | _SlowTransport 布尔字段命名 | STILL-VALID | main :122-123/:128/:247 仍裸布尔 started/cancelled(类改名 _TimeoutCancellationTransport 但未加 is_ 前缀)(P4 风格) | C5b |
| 557 | apps/web/tests/unit/auth/migration-failure-surface.test.tsx:56 | qodo | onDone 无参断言 | PHANTOM | main :30 onDone 为无参回调(`onDone = () => undefined`),:54/:61 断言 toHaveBeenCalled() 已足够 — 无可验证的调用参数,前提不成立 | 无需卡 |
| 557 | apps/web/tests/unit/auth/migration-failure-surface.test.tsx:41 | qodo | 元素存在用 toBeTruthy 断言 | PHANTOM | main :39-41 仍 toBeTruthy,但仓库无 jest-dom(apps/web/package.json 无依赖、全仓测试代码零 toBeInTheDocument),建议的 matcher 在本仓不存在 | 无需卡 |
| 557 | wrangler.toml:244-245 + workers/catalog/wrangler.toml:24-25 | qodo | Rule 2399064:Wrangler 声明 workers_dev/preview_urls routing 键,路由应在 Pulumi 管理(顶层 Rule violation,无线程) | STILL-VALID | main wrangler.toml:259-260、workers/catalog/wrangler.toml:24-25/:81-82/:96-97 仍保留两键(现均 false);wrangler.toml:14/:251-258 注释载明 "routes 归 Pulumi" 自订策略 — 需 owner 裁决:移除键或形式化豁免 | C5e |
| 557 | apps/agent/agent/clients/gemini_vision.py:128 | qodo | 每请求新建 httpx.AsyncClient,违反 F7 共享客户端 | OBSOLETE-FIXED | #576 注入 lifespan 客户端;文件后重写为 photo_vision.py | — |
| 557 | apps/web/src/components/auth/useAuthCallback.ts:193 | qodo | migrate 以 Migrate\|undefined 传必需 Migrate 位置,strict 下类型错 | OBSOLETE-FIXED | #576 改 migrate?: Migrate + resolvedMigrate | — |
| 559 | infra/index.ts:104 | coderabbit | workers.dev 主机不在 zone WAF 覆盖内,门控可被绕过 | OBSOLETE-FIXED | #541 step6(35a12e1b)关闭全部 workers.dev,问题面消除 | — |
| 559 | infra/package.json:7 | coderabbit | typecheck 仍 TS ^5.0.0 且无 oxlint/tsgolint,不符 TS7 门 | STILL-VALID | main infra/package.json 仍 typescript ^5.0.0,typecheck 仅 tsc;根 lint 过滤器(:9)未含 infra,需 owner 确认是否有意豁免 | C5d |
| 559 | infra/index.ts:124 | qodo | Ruleset 逻辑名硬编码 staging-access-gate,非 stack-aware | PHANTOM | 整块守 stack==="staging"(main :314),单栈单实例,跨栈命名冲突前提不成立;Pulumi 资源名只存在于各栈状态 | 无需卡 |
| 559 | e2e/playwright.config.ts:21 | qodo | extraHTTPHeaders 全请求携带 x-staging-key,跨源(CF challenge)泄露 | OBSOLETE-FIXED | bdfc3349 改 host-scoped cookie + storageState(main :4/:40 注释+实现) | — |
| 559 | infra/index.ts:122 | qodo | gate token 未转义嵌入 ruleset 表达式 | OBSOLETE-FIXED | bdfc3349 加字符集/长度校验(main :318-321) | — |

## 汇总

| 判定 | 条数 |
|---|---|
| STILL-VALID | 23 |
| OBSOLETE-FIXED | 55 |
| OBSOLETE-REWRITTEN | 4(#478/#483 SonarCloud 门、#515-6、#515-1) |
| PHANTOM | 6(#559-1、#542-1、#544-1、#554-3、#557-2、#557-3) |
| **合计** | **88** |

### STILL-VALID 按域分组

| 域 | 条数 | PR |
|---|---|---|
| CI probe(post-deploy-assert.sh/.test.sh) | 6 | #536-1..6 |
| Catalog 私有化守卫测试 | 2 | #539-1/#539-2 |
| SEO 层 | 2 | #544-2/#544-3 |
| Web 登录延迟 | 1 | #514-2 |
| docs 自相矛盾 | 1 | #548 deployment.md:13 vs :244 |
| Wrangler routing 键策略(owner 裁决) | 1 | #557-6(Rule 2399064) |
| infra 工具链门禁(owner 裁决) | 1 | #559-package.json |
| P4 风格 misc | 9 | #490-1、#513-1、#542-2、#542-3、#553-2、#554-1、#554-2、#554-4、#557-1 |

### 建议修复卡切分

- **C1 — CI probe 清理(1 卡,6 finding,同一文件组)**:#536-1..6 全部落在
  `.github/scripts/post-deploy-assert.sh` + `.test.sh`:fetch() 拆小函数并把 Accept
  改为显式参数(同时关 536-4/536-6/536-1)、case4 mock 补 JSON 首位断言(536-2)、
  /tmp 输出改 mktemp+trap(536-3)、长测试拆分(536-5)。#535-3 已由 #610 修了一半,
  这卡是它的收尾。
- **C2 — Catalog 守卫测试(1 卡,2 finding)**:#539-1/#539-2 都在
  `workers/catalog/test/wrangler-private.worker.test.ts`。红线:必须保留"刻意行级解析"
  设计意图(#576 曾因违反而回滚);建议对行文本做规范化(去空白/尾注)再比较。
- **C3 — SEO 层(1 卡,2 finding + 1 附注)**:#544-2 SearchAction 目标改 `/chat?q={search_term_string}`;
  #544-3 og:url/og:title 按路由覆盖(__root.tsx 注释已承认现状)——或书面接受该设计。
  附注(不计入 C3 的 finding 数,与主线验收分离):#515-6(重写后的 photo_vision.py:111/:124
  仍只记 error_type)挂这张卡复核;复核结论不阻塞 C3 主线。
- **C4 — 登录延迟(1 卡,1 finding,低优先)**:#514-2。owner 已在代码注释说明取舍;
  如需修复:迁移失败/超时不阻塞导航,后台完成。
- **C5a — CI 微调(1 卡,1 finding)**:#490-1 fetch-depth 按事件条件化(PR 事件走 API、
  其余全量克隆)。
- **C5b — agent 风格清理(1 卡,6 finding,同域可并)**:#513-1 validate_required_env 拆分、
  #553-2/#554-2 裸 str 收窄(可合并为同一修复)、#554-1 参数对象化(与 #554-2 同一函数,
  一并做)、#554-4 _run_pipeline 压缩、#557-1 _SlowTransport 字段改名。全为 P4 风格,
  一张卡做完六处。
- **C5c — web 测试风格(1 卡,2 finding)**:#542-2 顺序断言改集合比较、#542-3 buildHandler
  抽小函数。
- **C5d — infra TS7 门禁(独立卡,owner 裁决)**:#559 infra/package.json。先由 owner
  裁决 infra 是否纳入 TS7 门(根 lint 过滤器未含 infra);裁决后再决定升级 toolchain 或
  书面豁免。不与任何小改混卡。
- **C5e — Wrangler routing 键(独立卡,owner 裁决)**:#557-6 Rule 2399064。wrangler.toml
  与 workers/catalog/wrangler.toml 保留 `workers_dev = false`/`preview_urls = false`
  属文档化的自订策略;需 owner 裁决:移除两键(qodo 规则字面合规)或加正式豁免注释
  (维持 deny-by-default 守卫)。Pulumi 已管理全部路由(#541 step6),此卡无安全紧迫性。
- **C5f — docs 修复(1 卡,1 finding)**:#548 deployment.md:13 拓扑图删去已退役的
  `static paths ─▶ Cloudflare ASSETS` 一行,与 :244 的 #537 记录对齐。

### 过程记录

- 8-03 旧盘点遗漏机制复现确认:qodo 的 Bugs/Rule violations 计数、SonarCloud Quality
  Gate、coderabbit 顶层摘要都不产生线程;本卡 26 个 PR 的顶层评论全部取到并逐条比对。
- FIX ROUND 2(2026-08-06):首版取到了两路却只记了线程(83 行 K==M)。本轮按 PR 重数
  N/M/K 并断言 K ≥ max(N,M),补齐 5 条顶层/线程专属 finding(#542 buildHandler、
  #548 pnpm --ignore-scripts、#553 handle_photo_search、#554 _run_pipeline、
  #557 Rule 2399064),台账 83 → 88 行;顶部自检表使完整性一望即知。
- 本轮逐条复核 25 条无证据判定(main 文件状态或后续 PR/commit 为凭),11 条改判:
  5 条改 STILL-VALID(线程静默关闭但 main 上原样仍在:#548 dep:13、#553-2、#554-1、
  #554-2、#557-1),5 条改 PHANTOM(#542-1/#544-1/#554-3 的 type: 注释约定在仓库不存在
  ——qodo 自注 "No historical evidence found";#557-2 onDone 为无参回调、无可验证参数;
  #557-3 建议的 toBeInTheDocument 需 jest-dom 而仓库未装、全仓测试零使用),1 条改
  OBSOLETE-REWRITTEN(#515-1 测试文件随 #656 拆分删除)。
- 已核实的关键"旧 finding 已被修"证据链:#608(BYOK UTF-8)、#613(deferred save)、
  #610(probe 重试分类)、#576(backlog batch 1,修 9 处)、#584(Vite 构建)、#554(用量计价)、
  #514/#553(登录迁移/匿名计费)、bdfc3349(gate token 卫生)、#528(wrangler.toml
  env.staging.vars CORS_ALLOWED_ORIGIN 落地)、#656(photo_vision.py 重写)。
- PHANTOM 实例(机器人编造理由类):#559-1 以"跨栈命名冲突"为由要求 stack-aware 命名,
  但资源块被 `stack === "staging"` 守卫,冲突前提不成立;#557-3 引用的 jest-dom matcher
  本仓未装;#542-1/#544-1/#554-3 引用的 type: 注释约定本仓不存在(且 qodo 自认
  "No historical evidence found")。其余 finding 前提均核实成立。
- FIX ROUND 3(2026-08-06,PR #822 评审回合):处置 coderabbit/qodo 对台账与 .gitignore 的
  7 条线程 + 2 条顶层 bug(qodo Code Review Bugs=2 / Rule violations=0,SonarCloud
  Quality Gate 实测 **passed**):① N 口径扩展为顶层全部来源,并补来源覆盖证据——
  coderabbit 顶层评论 26 条逐条分类:22 条状态通知零 finding(跳过 #477/#478/#479/#480/
  #557、文件超限 #483、已关闭 #492、限流 #490/#491/#493/#495/#514/#515/#523/#528/#536/
  #542/#544/#548/#553/#554、无 actionable #551),4 条 walkthrough(#501/#513/#539/#559)
  为叙事汇总、其 finding 级条目均落在线程;②"首版 K < N"表述修正为 K < max(N, M)
  (#548 实为 M 侧 9>8);③台账段落排 MD018(行首 # 数字)/MD037(裸下划线标识符)标记
   问题;④切分 C3 注明 #515-6 为附注、不占 finding 数;⑤.gitignore 临时目录规则根锚定为
   `/.tmp-b8/`。逐条处置见 PR #822 线程回复。评审覆盖:#822 上 coderabbit(7 线程)、
   qodo Code Review(2 bugs)、SonarCloud(passed)、codecov 均评审,无机器人沉默。
- FIX ROUND 4(2026-08-06,冲突解决轮):分支重基至 origin/main 246eeab2。唯一冲突文件
  为 `.gitignore`(main 侧 H1 #651 把 build_info.py 移至
  `/apps/agent/src/animichi/build_info.py`,本侧新增 `/.tmp-b8/` 根锚定规则),两侧意图
  均保留。重基期间 rebase 的 cleanup=strip 把首个提交的 `#759` 开头主题行当注释剥离,
  已用 commit-tree 恢复原始主题(台账提交 e13e41c2)。判定证据路径随重基同步:main 侧
  自 038a10a8 以来仅发生路径级迁移(H1 #651 `apps/agent/agent/*` →
  `apps/agent/src/animichi/*`、#652 `worker/` → `workers/edge/`、G2b #811
  camelCase → kebab-case),不影响任何判定结论;唯一失效证据路径
  `workers/edge/containerEnv.test.ts` 已更新为 `container-env.test.ts`(#501×2)。
  本台账另受 .gitignore 与台账文件自身提交保护;工作树无残留临时目录。
