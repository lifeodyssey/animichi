# Iteration 0 — 地基(Foundation)

详细度:**全量细化**。Story 数:9(超「3-8」guideline,原因见主 spec §③ 说明:X1 地图 ADR + X8 eval 分层是追加必做项)。

前置条件(不是 story,是外部阻塞):**PR #206(atlas CI 修复)必须先合并**,否则本迭代的 CI 基线不可信。

依赖顺序建议:S0.1(独立)→ S0.2 → {S0.3, S0.4, S0.5} → S0.6 → S0.7 → S0.8 → S0.9(收尾)。

**SD interview 终局结论对本迭代的影响(见主 spec §②,inputs §七全稿 SD-0~SD-11)**:
- **SD-0(域名,终局)**:`animichi.com` 定案,不再是待定项;S0.8 直接写死该域名,不再参数留白等待用户拍板。`aninavi.app` 做 301 重定向(或视执行时判断值不值得投入,非阻塞)。
- **SD-1**(迁移链):Neon 侧确认为"双链 + atlas-provider-drizzle"(Drizzle TS schema 唯一真相);S0.9 新增 `docs/ops/migrations.md` 记录边界与 CI 步骤。
- **SD-6**(edge worker):`worker/` 已是 TS + 16 个测试用例(`entry.test.ts` 11 + `auth.test.ts` 5),核证发现唯一缺口是这些测试从未接入任何 CI job——S0.3 补一个新 CI job,不是从零建测试。
- **SD-4**(agent 运行时):D7 的 Pyodide 与"TS 重写"两条路径**双双 REJECTED**,终局定案;S0.9 的文档收敛需明确写出这一点(不只是"REJECTED",还要写清"双双")。

---

### S0.1 Eval gate 分层(X8)

**用户故事**:作为 Reviewer,我要 PR 触发轻量 smoke eval、nightly 跑全量 617 条,以便在不为每个 PR 付出全量 eval 时间成本的前提下,依然能在合并前抓住 agent 行为回归。

**设计依据**:无视觉画布;依据 inputs §六 X8。

**Releasable 陈述**:本 story 上线后,任何触达 `apps/agent/**` 的 PR 自动跑 5 条 smoke eval 作为必过门禁;617 条全量套件改为 nightly cron + `workflow_dispatch` 手动触发;现有 `if: false` 全关配置消失。

**AC**:
- 触达 `apps/agent/**` 的 PR 触发 smoke eval job 并在已知良好 commit 上通过 -> integration
- 只触达 `apps/web/**`(不改 agent 路径)的 PR **不**触发 eval job(path filter 正确排除)-> integration
- 故意注入一个错误 case 的 smoke 集合会让 job 失败并阻止合并(分支保护必过检查)-> integration
- nightly cron 在到点时触发全量 617 条(用 workflow schedule 断言,非真等待)-> unit

**变更文件**:`.github/workflows/ci.yml`、新增或修改 agent-eval 相关 job 定义、新增 nightly cron workflow 文件(如 `.github/workflows/agent-eval-nightly.yml`)。

**依赖**:无。

---

### S0.2 apps/web TanStack Start skeleton + pnpm workspace 注册

**用户故事**:作为开发者,我要一个已注册进 pnpm workspace、跑通 animal-island-ui-tailwind@1.0.x 的 `apps/web` TanStack Start 骨架,以便后续迭代有地基可建。

**设计依据**:无具体画布;`docs/DESIGN.md` 作为 token 基线(本 story 只接线,不消费具体 token,S0.5 负责)。

**Releasable 陈述**:`pnpm --filter web dev` 能跑起一个品牌化但空白的 TanStack Start app;`pnpm --filter web build` 产出 `.output/`;CI 对其跑 typecheck/lint/test/build。

**AC**:
- 全新 clone + `pnpm install` + `pnpm --filter web build` 成功产出 `.output/server/index.mjs` + `.output/public` -> integration
- 访问未定义路由渲染品牌化 404(不是浏览器默认空白页)-> browser
- `animal-island-ui-tailwind` 锁定到一个损坏的 1.0.x 版本时,CI 安装步骤给出清晰的 lockfile 错误而非静默装错版本 -> unit

**i18n 范围说明**:i18n 系统由 S0.6 引入,本 story 尚无用户可见文案(骨架空白页),不适用 i18n AC;S0.6 落地后 404 页文案补挂三语。

**变更文件**:`apps/web/package.json`、`apps/web/vite.config.ts`、`apps/web/app.config.ts`、`apps/web/src/routes/__root.tsx`、`apps/web/src/routes/index.tsx`、`pnpm-workspace.yaml`(新增 `apps/web` 条目;更新 `frontend`/`worker` 的过时"留原地,Wave 4"注释)。

**依赖**:无。

---

### S0.3 部署链修复 + edge worker CI 接线(回填自 SD-6/X14)

**用户故事**:作为 Coordinator,我要部署管线构建并发布 `apps/web`(而不是已删除的 Next.js frontend),以便重建后 tag 部署继续可用;同时我要 root `worker/` 既有的测试套件真正跑在 CI 里,而不是本地能跑但从未被把关。

**设计依据**:无视觉画布;`worker/entry.ts`/`worker/app.ts` 现状(Planner 核实,见风险登记);SD-6 核证结论。

**Releasable 陈述**:推版本 tag 后,`apps/web` 的 TanStack 构建物经既有 Hono 包装 Worker 部署到 Cloudflare;`/healthz`、`/img/*`、`/v1/*` 路由行为不变;`worker/entry.test.ts`+`worker/auth.test.ts`(16 用例)在每个触达 `worker/**` 的 PR 上运行并把关。

**AC**:
- `wrangler deploy --dry-run`(或等效 CI 检查)成功引用 `.output/public` 为 assets 目录、`.output/server/index.mjs` 衍生的 handler 作为 catch-all -> integration
- 访问 apps/web 中不存在的路由仍返回品牌化 404 真实响应,不是 Worker 异常 -> browser
- 若 `.output/server/index.mjs` 的导出形状与既有 `NextHandler` 接口不匹配,构建/typecheck 阶段显式失败(适配层 TypeError 由单测捕获),而不是静默部署一个坏的 worker -> unit
- `/v1/*`、`/img/*`、`/healthz` 三类既有路由在切换 catch-all handler 后行为不变(复用/扩展现有 `entry.test.ts`/`app.ts` 测试)-> unit
- **SD-6 CI 接线**:新增 `ci.yml` job(或复用模式)在 `worker/**` 变更时运行既有 `worker/entry.test.ts`+`worker/auth.test.ts`;Planner 核实此前 `changes` path filter 里没有 `worker/**` 条目,该 job 此前从未被触发过 -> integration

**变更文件**:`wrangler.toml`(`[assets] directory` 改 `.output/public`;移除 `NEXT_PUBLIC_MAPBOX_TOKEN` 相关 secret 引用,见 X1)、`worker/entry.ts`(替换 `nextHandler` 导入 + 适配层)、`.github/workflows/_web-ci.yml`(`working-directory: apps/web`、pnpm、vite build 取代 next build)、`.github/workflows/deploy.yml`(frontend 构建步骤改 apps/web,移除 `NEXT_PUBLIC_MAPBOX_TOKEN` env)、`.github/workflows/ci.yml`(新增 `worker/**` path filter + 对应 job)。

**依赖**:S0.2。

---

### S0.4 地图选型 ADR + spike(X1)

**用户故事**:作为开发者,我要一个跑通的 MapLibre GL + Protomaps(pmtiles on R2)spike,以便 Iteration 1 的 chat 地图卡与后续 Walk 离线能建在已验证的技术栈上,而不是边做边踩坑。

**设计依据**:`user-journey.md` §6.6"地图卡 pin 语言"(视觉规范,与引擎无关);`spec-chat-page-design.md` §4 static-first/GL-on-demand(文中"Mapbox"按 X1 改读 MapLibre)。

**Releasable 陈述**:apps/web 内一个演示路由渲染出挂载了 pmtiles 数据源(取自 R2)的 MapLibre GL 地图,pin 视觉语言(teal/gold 圆点)已按 DESIGN.md token 上色;ADR 文档入库,建立 `docs/adr/` 目录(修复 C 报告"ADR 无统一目录"的缺口)。

**Backend enabler**:新增 R2 bucket `seichijunrei-assets` 并在 `wrangler.toml` 声明 `[[r2_buckets]]` 绑定;`/tiles/*` 前缀存放覆盖至少关西/关东区域的 pmtiles 切片。此为本列车对 D9(Pulumi non-goal)的显式例外(root Worker 直接声明,不经 Pulumi)。

**AC**:
- spike 路由在正常网络下 3s 内加载出可见瓦片 -> browser
- 请求超出切片覆盖范围的 bbox 时优雅返回空瓦片(地图显示底色,不是破损瓦片图标)-> browser
- 模拟 R2 fetch 失败(404/500)时降级为品牌插画静态底图(spec-chat-page-design.md §4 本就存在的选项),不是空白地图 -> browser

**变更文件**:`docs/adr/0001-map-stack-maplibre-protomaps.md`(新建 ADR 目录)、`wrangler.toml`(`[[r2_buckets]]`)、`apps/web/src/routes/_dev/map-spike.tsx`、`scripts/build-pmtiles.sh`(或等效切片生成脚本)。

**依赖**:S0.2。**阻塞**:S1.4、S1.5、S2.2、S5.2(所有消费地图的 story 需等本 story 完成)。

---

### S0.5 DS token 底座 + Zen Maru Gothic + CI 对齐测试

**用户故事**:作为开发者,我要 apps/web 接好 animal-island-ui-tailwind@1.0.x 的 token、vendor 好 Zen Maru Gothic、并有 CI 测试断言 token 对齐,以便后续每个组件 story 继承正确且受测试保护的视觉,而不是各画各的。

**设计依据**:`docs/DESIGN.md`(token 权威,frontmatter 缺 explore/walk/map-* 待回填);`DS 补全 - Chat 桌面.html`(radius-sm=16px 治理规则,S8);`docs/ds-审计.md`(2 处对比度 FAIL,供后续组件级修复引用)。

**Releasable 陈述**:apps/web 的 globals.css 暴露与包 `--animal-*` 原语 1:1 对齐的 `--color-*` 语义 token(含回填的 explore/walk/map-pin-* 系列);任意日文文本渲染 Zen Maru Gothic;CI 测试在包 token 值漂移但语义层未同步时失败。

**AC**:
- 组件渲染日文字符串时计算样式的 `font-family` 命中 Zen Maru Gothic -> unit
- `DESIGN.md` frontmatter 缺失 explore/walk/map-* 的情况下,这些 token 在运行时仍有已定义的回填默认值(不是 `undefined`)-> unit
- 把 `animal-island-ui-tailwind` 升到一个改变了 `--animal-primary-color` 值的模拟版本时,token 对齐 CI 测试失败(用 fixture 模拟回归)-> unit
- a11y:`--color-muted-fg`(原 ~2.8:1)与 teal 底白字(原 ~2.1:1)两个 token 组合在 token 层修正后达到 ≥4.5:1,由对比度计算单测验证 -> unit

**变更文件**:`apps/web/src/styles/globals.css`、`apps/web/src/styles/fonts.css`(从 `assets/fonts.css` vendor)、`apps/web/tests/design-token-alignment.test.ts`、`apps/web/package.json`(`animal-island-ui-tailwind@^1.0.16`)。

**依赖**:S0.2。

---

### S0.6 Spike 代码搬运(Landing + 登录 modal + i18n + Storybook)

**用户故事**:作为用户,我要在重建后的站点上看到 Landing 页、带 magic-link 的登录 modal、以及正确的多语言文案,以便迁移不倒退 spike 已经验证过的东西。

**设计依据**:`Landing - Seichijunrei.html`(昼/夜切换、hero、对比滑块、magic-link 表单)。

**Releasable 陈述**:`/`(营销落地路由)渲染搬运后的 Landing 页,含昼/夜切换与可用的 magic-link 登录 modal(接 Supabase Auth);locale 切换器在 ja/zh/en 间正常工作;Storybook 跑通搬运后的组件 stories。

**AC**:
- 访问 `/` 渲染 Landing hero 与"Start Exploring" CTA,昼/夜切换经 localStorage 持久化 -> browser
- 空邮箱提交 magic-link 表单显示内联校验提示,不发出请求 -> unit
- Supabase magic-link 请求失败(网络/5xx)显示品牌化错误文案,不是裸异常 -> browser
- i18n:切换 locale 到 zh/en 后 Landing 全部文案(hero/CTA/登录表单)重渲染,无硬编码 ja 兜底字符串泄漏 -> unit

**变更文件**:`apps/web/src/routes/index.tsx`、`apps/web/src/components/landing/*`、`apps/web/src/components/auth/LoginModal.tsx`、`apps/web/src/i18n/*`(字典+context,从 spike 搬运)、`apps/web/.storybook/*`、`apps/web/src/components/**/*.stories.tsx`。

**依赖**:S0.2、S0.5(token)。

---

### S0.7 Splash 静态版 + 删除旧 frontend/

**用户故事**:作为移动端用户,我要打开 app 时看到一个 ≤800ms、跟随系统昼夜的品牌开屏;作为开发者,我要旧 Next.js frontend 被彻底移除,以便只维护一套前端代码库。

**设计依据**:`Splash 静态版.html`(`.phone.day`/`.phone.night` 两帧,无 JS 无动效,规则"跟随系统·≤800ms·不进 scene-cut")。

**Releasable 陈述**:打开 app 显示静态开屏 ≤800ms 后继续(无 scene-cut 动效,遵守规则);`frontend/` 目录及其 CI/部署接线从仓库中完全删除。

**AC**:
- 系统为浅色模式(或 `prefers-color-scheme: light`)时渲染日间帧,并在 800ms 内完成 -> browser
- 系统 color-scheme 不可用(旧浏览器)时优雅回退到日间帧默认值,不是未定义态 -> unit
- 开屏在慢速设备上也不超过 800ms 阻塞(纯 CSS,无 JS 计时器依赖)-> browser
- 仓库结构性检查:`frontend/` 目录不再存在,CI 不再引用它 -> integration

**变更文件**:`apps/web/src/routes/__root.tsx`(开屏引导逻辑)、`apps/web/public/splash-day.*`、`apps/web/public/splash-night.*`;**删除**:`frontend/**`;清理 `worker/entry.ts` 中过时的 Next.js 专属注释。

**依赖**:S0.3(部署链必须先指向 apps/web,删除旧 frontend/ 才安全)。

---

### S0.8 SEO/GEO 地基 + 域名定案(`animichi.com`,SD-0)+ Lighthouse CI(回填自 SD-27 + `2026-07-06-seo-geo-plan.md` §3/5/6/7)

**用户故事**:作为站点所有者,我要重建后的站点自带基础 SEO/GEO 设施(robots/sitemap/hreflang/OG/llms.txt/爬虫可达性)与性能预算门禁,并且这些设施要直接指向真正的生产域名(含认证回调域名),以便搜索引擎与 AI 爬虫可见性、以及性能都不因重建而倒退,也不用等域名"以后再定"就得留一堆占位符。

**设计依据**:无视觉画布;移植 `apps/agent/agent/tests/unit/test_seo_static_files.py` 的测试基建模式;`docs/superpowers/specs/2026-07-06-seo-geo-plan.md` §3(域名迁移清单)/§5(L3 增长分析)/§6(robots/llms.txt)/§7(迭代映射)。

**Releasable 陈述**:apps/web 交付 robots.txt(训练爬虫 `GPTBot`/`ClaudeBot`/`Google-Extended` 挡下,搜索/引用/Agent 类爬虫 `OAI-SearchBot`/`Claude-SearchBot`/`Claude-User`/`ChatGPT-User`/`PerplexityBot` 放行,`Sitemap` 指令指向 `https://animichi.com/sitemap.xml`)、sitemap.xml 骨架(含根 URL,预留 IndexNow key 文件)、三语 hreflang+canonical(域名均为 `animichi.com`)、默认 OG 卡(1200x630)+ Twitter summary_large_image、llms.txt v1(**静态一页,不建 llms-full 管线**——回填自 SD-27C 负清单,原稿若曾设想 llms-full 管线在此明确作废);Lighthouse CI 在 LCP>2.5s 或 CLS>0.1 时使构建失败;GSC + Bing Webmaster 双产权验证 + Cloudflare Web Analytics 接入(L3 增长分析基线,不上 GA4);`aninavi.app` 视执行时判断做 301 重定向到 `animichi.com`(非阻塞项)。

**域名迁移清单(回填自 seo-geo-plan §3,全项进本 story,不得遗漏认证回调域名)**:
1. `animichi.com` 入 Cloudflare、TLS/DNS 就绪
2. 旧域(seichijunrei.app)全路径 301 → 新域对应路径(Worker redirect 规则;无对应页兜底首页)
3. GSC 双产权验证 → Change of Address 申报;Bing Webmaster 同步产权验证
4. canonical/OG/sitemap/robots 全部指向新域,域名走构建环境变量(`CANONICAL_DOMAIN`)
5. **Supabase auth 回调 URL + magic-link 邮件模板域名更新为 `animichi.com`**(遗漏此项 = 登录事故,不是普通 SEO 缺口,seo-geo-plan §3 原文强调"漏一条=登录事故")
6. 旧域续费保留 ≥2 年(301 权重传递期,非阻塞,记录为运维待办)

**AC**:
- robots.txt 对训练爬虫(`GPTBot`/`ClaudeBot`/`Google-Extended`)返回 `Disallow: /`,对搜索/引用/Agent 爬虫(`OAI-SearchBot`/`Claude-SearchBot`/`Claude-User`/`ChatGPT-User`/`PerplexityBot`)返回 `Allow: /`,并含 `Sitemap: https://animichi.com/sitemap.xml`(**SD-0 终局域名,不是占位符**)-> unit
- sitemap.xml 此刻尚无 anime/route URL(那些在 Iteration 5 加入),但仍是良构 XML 且至少含根 URL(`https://animichi.com/`);IndexNow key 文件按约定路径可访问(为迭代 5 新番 SLA 推送预留)-> unit
- OG 图缺失/损坏(404)会让 SEO 测试套件失败,而不是静默上线 -> unit
- i18n:hreflang 标签覆盖 ja/zh/en/x-default,且各语言 title(50-60 显示宽度)/description(120-160)符合边界(沿用旧测试的 CJK 宽度计数逻辑)-> unit
- **域名收尾(SD-0)**:配置项 `CANONICAL_DOMAIN` 的值直接写 `animichi.com`(变量名保留以便未来换域名,但不再是待定占位符);Supabase magic-link 重定向白名单与邮件模板同步更新为该域名 -> unit
- **JSON-LD 收缩范围(回填自 SD-27/seo-geo-plan §1,取代原稿"FAQPage"设想)**:首页交付 `Organization`(name=Animichi,`sameAs` 社交档案锚点)+ `WebSite`;所有内容页交付 `BreadcrumbList`;**不实现 FAQPage schema**(已停显,SD-27C 负清单明确排除)-> unit
- **爬虫可达性硬 AC(回填自 SD-27B/seo-geo-plan §6)**:CF AI Crawl Control 面板人工核查并留证(2026-09-15 起 CF 新站默认挡 Training+Agent 类爬虫,须确认放行名单未被面板覆盖);对上述每个允许爬虫 UA 做 `curl -A "<UA>" https://animichi.com/` 实测,断言无隐形 403 -> integration
- **L3 增长分析接入**:GSC 与 Bing Webmaster 完成产权验证并提交 sitemap;Cloudflare Web Analytics beacon 已挂载且能在仪表盘看到至少一次 pageview -> integration

**变更文件**:`apps/web/public/robots.txt`、`apps/web/public/sitemap.xml`、`apps/web/public/llms.txt`、`apps/web/public/<indexnow-key>.txt`、`apps/web/src/routes/__root.tsx`(head meta + CF Web Analytics beacon)、`apps/web/src/lib/structured-data.ts`(Organization+WebSite+BreadcrumbList JSON-LD,移植并去掉 FAQPage)、`apps/web/tests/seo-static-files.test.ts`(移植自 `test_seo_static_files.py`,调整路径 + 新增爬虫 UA 可达性测试)、`.github/workflows/_web-ci.yml`(新增 Lighthouse CI 步骤)、Supabase Auth 重定向白名单 + 邮件模板配置(magic-link,含回调域名)、Worker 301 重定向规则(旧域→新域)。

**依赖**:S0.2、S0.6(i18n)。**不再有域名依赖阻塞**(SD-0 已终局定案)。

---

### S0.9 文档回写(矛盾清单 + X5 前瞻声明 + D7 双双 REJECTED 收敛 + migrations.md,回填自 SD-1)

**用户故事**:作为重建后加入项目的开发者,我要 CLAUDE.md/ARCHITECTURE.md/部署文档描述真实的 TanStack/apps-web 架构(而不是过时的 Next.js 引用),并且要有一份权威文档告诉我 Neon/Supabase 两条迁移链的边界在哪,以便不被误导、也不用去问人。

**设计依据**:无。

**Releasable 陈述**:`docs/ARCHITECTURE.md`、`docs/todo.md`、`docs/ops/deployment.md`、根 `AGENTS.md`/`CLAUDE.md`、`wrangler.toml` 注释、CI 注释、`docs/testing-strategy.md` 全部改写为描述 apps/web + TanStack Start + MapLibre(不再是 frontend/ + Next.js + OpenNext + Mapbox);D7 被文档标注为**双双 REJECTED**(Pyodide 与 TS 重写皆非,不是"计划中");X5 的 edge 认证模型前瞻声明已写入;新增 `docs/ops/migrations.md`(SD-1)记录 Neon(Drizzle+atlas-provider-drizzle)与 Supabase(supabase CLI)两条迁移链的边界与 CI 步骤。

**AC**:
- 对 `docs/ARCHITECTURE.md`、`docs/ops/deployment.md` grep "Next.js"/"OpenNext"/"Mapbox" 在回写后返回零命中(仓库卫生测试脚本断言)-> unit
- `docs/testing-strategy.md` 的覆盖率数字章节改为"apps/web 覆盖率地板见迭代 0 vitest.config.ts 实测值",不是过时的硬编码百分比 -> unit
- D7 的三代自我推翻文档轨迹被收敛为一段明确标注"双双 REJECTED"(Pyodide + TS 重写)的说明(断言 "REJECTED" 字符串在 `ARCHITECTURE.md` 中同时出现在 "Pyodide" 与 "TS" 重写描述附近)-> unit
- X5 的目标认证模型("edge 放行匿名+Turnstile+配额标记")作为前瞻声明写入 `docs/ARCHITECTURE.md` 认证章节(S1.8 落地后回填为既成状态,本 story 只声明方向)-> unit
- **SD-1 新增(回填自 SD-1,双链 + atlas-provider-drizzle 定案;取代原 X13"弃 atlas"的已撤回主张)**:`docs/ops/migrations.md` 存在且至少覆盖三部分内容——Neon 链路(`workers/catalog/src/db/schema.ts` 为唯一真相 → atlas-provider-drizzle 生成期望态 → `atlas migrate diff/lint/apply` versioned 迁移)、Supabase 链路(supabase CLI 不变,不受本次迁移链影响)、CI 步骤对应关系 -> unit

**变更文件**:`docs/ARCHITECTURE.md`、`docs/todo.md`、`docs/ops/deployment.md`、`AGENTS.md`/`CLAUDE.md`、`wrangler.toml`(注释)、`.github/workflows/*.yml`(注释)、`docs/testing-strategy.md`、`docs/ops/migrations.md`(新建)。

**依赖**:软依赖 S0.3/S0.4(文档应描述已落地的实际状态,不是空中楼阁)。
