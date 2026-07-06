# Iteration 5 — 発見:作品页+首页

详细度:**开工前细化**。Story 数:10(原 8 个产品/enabler story + SD-27 seo-geo-plan.md 迭代映射新增的 S5.9 地区页、S5.10 质量门进CI)。

依赖顺序建议:S5.4(catalog 公开数据 enabler,需 eng review 签字,建议尽早启动)→ S5.1 → {S5.2, S5.3} → S5.6 → S5.7 → S5.8(可与前面并行,消费方是 S5.4)。S5.5 首页依赖 S2.8(続きから)与 S1.1(搜索跳转复用),可与作品页并行开发。S5.9(地区页)可与 S5.1 并行开发,共享 S5.4 的 catalog 公开数据 enabler。S5.10(质量门进CI)依赖 S5.6/S5.9 产出的页面已存在。

**catalog 首次公网暴露(风险,见主 spec §⑨)**:S5.4 是本列车对 `workers/catalog` **唯一一次**扩大暴露面的 story,合并前需 eng review 签字。

**SD-8 定案提醒(回填自 SD-8)**:S5.5 的"続きから"只依赖 `sessions`/`routes` 数据,**不依赖** `user_memory`(该表休眠,不投入新功能)。

**SEO/GEO 内容归属核证(回填自 SD-27,与 iter-2.md 的核证对应)**:`2026-07-06-seo-geo-plan.md` §7 迭代映射表把"作品页 TVSeries/Movie JSON-LD + 事实速览块v1 + ImageObject/license + hreflang 起步"标在"2 详情+列表"行,但 `/anime/:id` 要到本迭代(5)才建、且 SD-27 明言 programmatic SEO 主战场在迭代 5——判断该表格行归属笔误,已将此内容并入 S5.1/S5.6(此判断未获用户裁决前不视为终局,见 iter-2.md 同条说明)。S5.6 此前版本的 JSON-LD 内容(`TouristTrip + CreativeWork`)是迭代列车原始定义的旧提法,**已被 SD-27 的 JSON-LD 收缩决策取代**(见 S5.6 修订)。

---

### S5.1 作品公開页 shell(A 図鑑型,SSR)+ SW network-first(X7)+ 事实速览块 v1 + hreflang 起步(回填自 SD-27)

**Scope**:`/anime/:id` 选择性 SSR 渲染,hero + 名場面 TOP(按カット数排序)+ 首屏事实速览块 + 三语 hreflang 起步。B ポスター型变体留档不实现(见主 spec §⑥)。

**设计依据**:`作品公開页 状态总览.html`(A 図鑑型,已定稿);`作品公開页 demo.html`;`user-journey.md` §3.1"作品公开页";`2026-07-06-seo-geo-plan.md` §2"事实速览块"(回填自 SD-27)。

**核心 AC**:
- 快乐路径:已知 `bangumi_id` 的 `/anime/:id`(SSR)服务端渲染出 hero + 按カット数排序的名場面 TOP -> browser
- 空:零圣地记录的作品渲染"この作品はまだ聖地情報がありません"等优雅状态,不是破损页面 -> browser
- 错误:未知/无效 `bangumi_id` 返回正规 404 页,不崩溃 -> browser
- **X7 硬 AC**:已激活 SW 的情况下请求 `/anime/:id` 不返回陈旧缓存 HTML(network-first)-> browser
- **事实速览块 v1(回填自 SD-27,三语)**:首屏渲染 `<section>+<dl>` 形态的事实速览块,字段全部来自 catalog 现成字段(不引入没有的数据)——点位总数(`pointsLength`)、主要城市 top3(PostGIS 聚合)、建议巡礼时长(路线规划器估算)、取景话数范围(movie 显示"剧场版")、数据来源署名(Anitabi + CC BY-NC-SA);每句自包含可独立摘引(不依赖上下文) -> browser
- **hreflang 起步硬 AC(回填自 SD-27C)**:`/anime/:id` 的 `ja`/`zh`/`en` 三语路由不仅链接互指 hreflang,且**每语言的 `<title>`/`<h1>`/URL slug 均为该语言本地化的关键词**(不是同一份关键词简单翻译三次)——实测 ChatGPT/Perplexity/Claude 不读 hreflang 标签,本地化关键词是唯一生效信号 -> unit
- 作品页 OG(回填自 SD-27,复用迭代 4 建立的渲染管线):`/anime/:id` 的 OG 图接入 S4.4 建立的动态 OG 渲染管线,新增作品页模板(cover + 点位数 + 帧对比拼版),不重建渲染/缓存核心逻辑 -> integration

**变更文件**:`apps/web/src/routes/anime/$bangumiId.tsx`(SSR)、`apps/web/src/components/anime-page/*`、`apps/web/src/components/anime-page/FactSummaryBlock.tsx`(新增)、`apps/web/src/lib/og/templates/animePage.ts`(新增)、`apps/web/src/sw.ts`(扩展规则)。

**依赖**:S5.4(数据源)、S4.4(OG 渲染管线)。

---

### S5.2 圈泡地图

**Scope**:圈泡地图(面积∝件数),区域名匹配,tap→zoom→機位 sheet。

**设计依据**:`作品公開页 demo.html`(泡 tap→zoom→機位 sheet);主 spec X1(MapLibre)。

**核心 AC**:
- 快乐路径:圈泡按点位数量渲染大小,区域名经既有地名匹配逻辑正确显示 -> browser
- 空:全部点位集中单一区域的作品渲染单个圈泡,不是空地图 -> browser
- 错误:点击零照片点位的圈泡仍优雅打开機位 sheet 展示可用(非照片)点位,不是空白 sheet -> browser

**变更文件**:`apps/web/src/components/anime-page/CircleBubbleMap.tsx`、`apps/web/src/components/anime-page/SpotSheet.tsx`。

**依赖**:S0.4、S5.1、S5.4。

---

### S5.3 「AI にルートを組んでもらう」→ Chat 预填

**Scope**:CTA 深链进 chat,预填作品上下文。

**设计依据**:`user-journey.md` §3.1(CTA);`generative-ui.md`(类比 A2b 引用态机制)。

**核心 AC**:
- 快乐路径:点击 CTA 导航到 `/chat` 并预填作品上下文(作为开场消息/上下文卡),用户无需重新输入标题 -> browser
- 空:零圣地作品仍允许此 CTA(chat 侧自行处理"0 聖地"D2 态)-> browser
- 错误:导航失败(如 JS 异常)降级为普通 `/chat` 链接,不是死按钮 -> unit

**变更文件**:`apps/web/src/components/anime-page/AiRouteCta.tsx`、`apps/web/src/lib/chat/prefillContext.ts`。

**依赖**:S5.1;复用 S1.1 的 A2 带查询进入逻辑。

---

### S5.4 Catalog 公开数据 enabler(新公开 oRPC 路由,首次公网暴露)

**Scope**:为作品公開页提供圈聚合、名場面排行数据。

**设计依据**:无视觉画布。

**Backend enabler(定案,主 spec 默认项 3)**:`workers/catalog` 新增 oRPC 路由(如 `catalog.animeOverview`),返回圈聚合(区域名+件数)+ 名場面排行(按カット数)+ 样例路线;root Worker 新增 `isPublicCatalog` 白名单,把 `/catalog/public/*` 转发到既有 `env.CATALOG` service binding(**catalog 首次公网暴露,本列车唯一一次,需 eng review 签字**);`packages/contract` 新增该契约。**既有** `GET /v1/bangumi/{id}/guide`(agent,公开无鉴权)继续保留供其他消费方使用,不强制迁移。

**核心 AC**:
- 快乐路径:对已知作品请求新公开 catalog 路由返回圈聚合 + 名場面排行数据 -> integration
- 空:数据稀疏(点位少、无明显"区域"聚类)的作品返回空但合法的 circles 数组,不报错 -> unit
- **安全 AC**:新白名单的 `/catalog/public/*` 只暴露明确列入白名单的只读路由,不是整个 catalog 服务面(测试一个未列入白名单的 catalog 路径仍被拦截)-> integration

**变更文件**:`workers/catalog/src/api/anime-overview.ts`(新增)、`packages/contract/src/contract.ts`(新增契约)、`worker/app.ts`(`isPublicCatalog` 白名单)。

**依赖**:无(可独立先行);**需 eng review 签字后才能合并**。

---

### S5.5 首页 App Home(続きから只依赖 sessions/routes,SD-8)

**Scope**:搜索框 + 続きから(进行中路线)+ 人気ランキング。

**设计依据**:`首页 - Seichijunrei.html`(搜索/続きから/人気ランキング)。

**核心 AC**:
- 快乐路径:搜索框提交导航到 `/chat` 并预填查询(复用 S1.1 的 A2 入口态)-> browser
- 快乐路径:已登录且有进行中路线的用户看到"続きから"卡片(经 `workers/users` oRPC 查询,**SD-8 定案:只依赖 `sessions`/`routes`,不依赖 `user_memory`**)-> integration
- 空:未登录或无进行中路线的用户不显示"続きから"区块(不是破损空卡片)-> browser
- 快乐路径:人気ランキング使用既有 `GET /v1/bangumi/popular`(agent,既有端点,本列车不做迁移)渲染 -> browser
- i18n:三个区块文案按 ja/zh/en 渲染 -> unit

**变更文件**:`apps/web/src/routes/index.tsx`(**注意**:与 S0.6 的 Landing 营销路由如何共存/划分,留开工前细化确定)、`apps/web/src/components/home/{SearchBox,ContinueFromCard,PopularRanking}.tsx`。

**依赖**:S2.8(続きから数据源)、S1.1(搜索跳转复用)。

---

### S5.6 Programmatic SEO(JSON-LD 收缩版 + per-anime sitemap + 新番 SLA + hreflang 全站收口,回填自 SD-27)

**Scope**(**修订**:此前版本的 `TouristTrip + CreativeWork` JSON-LD 是迭代列车原始提法,**已被 SD-27 的"JSON-LD 收缩"决策取代**——TouristAttraction/TouristTrip/ItemList 均不在 Google 支持列表,Ahrefs 对照实验证实 schema 堆料对 AI 引用无增益)。`/anime/:id` 页面按 SD-27 收缩版 JSON-LD 映射表渲染 + 按作品自动生成 sitemap 条目,且本迭代收口全站 hreflang + 新番 sitemap SLA 生效。

**设计依据**:`2026-07-06-seo-geo-plan.md` §1"JSON-LD 映射表"、§4"sitemap 体系 + 新番 SLA"、§7"迭代映射"(回填自 SD-27);移植 `apps/agent/agent/tests/unit/test_seo_static_files.py` 模式(S0.8 已引入的基建)。

**核心 AC**:
- 快乐路径:`/anime/:id` 页面渲染 **`TVSeries` 或 `Movie`**(按 `eps` 字段判型)JSON-LD,含 `name` + `alternateName`(三语标题数组)+ `image`(cover)+ `datePublished`;**点位坐标不进 JSON-LD**(几百个 Place 是噪声,爬虫从正文事实速览块读)-> unit
- 快乐路径:所有内容页(含 `/anime/:id`)渲染 `BreadcrumbList` JSON-LD(首页 > 作品 >,锚点不进面包屑)-> unit
- 快乐路径:対比図/代表帧图片渲染 `ImageObject` JSON-LD,含 `contentUrl` + `license`(CC BY-NC-SA)+ `creditText`(取自 catalog 的 `origin` 字段)——同时满足 Anitabi 署名义务与 Google Images licensable 标注 -> unit
- 空:零点位的作品页仍产出合法(即使精简)的 JSON-LD,不是缺失/损坏的 script 标签 -> unit
- **一实体一页 + 每页独特数据(硬 AC,回填自 SD-27C)**:programmatic 生成的每个 `/anime/:id` 页面必须含该作品独有的数据字段值(点位数/城市分布/话数范围等因作品而异),不是仅替换标题的模板复制——2026 spam update 实测数据显示 70% 模板占比的站点遭 -78% 排名打击,5% 模板占比仅 -3%;本 AC 断言"渲染输出中非模板部分的字段值随作品数据变化"而非仅断言 HTML 结构存在 -> integration
- 自动化 AC:per-anime sitemap 条目由构建/部署时脚本从 catalog 数据自动生成,不是手工维护 -> integration
- **新番 sitemap SLA(硬 AC,迭代 5 起生效)**:catalog 新作品通过 S5.8 质量门(X15,点位数 ≥ 阈值)后,**≤24 小时**内该作品的 sitemap 条目必须出现在 `sitemap-anime.xml`(经 Worker cron 重生成机制验证,断言时间窗口而非仅断言"最终会出现")-> integration
- **IndexNow 推送(硬 AC)**:新增/更新的 anime sitemap 条目触发一次 IndexNow POST 推送(Bing/Naver 系),不依赖已弃用的 Google sitemap ping 端点 -> integration
- **`lastmod` 真实性(硬 AC)**:sitemap 条目的 `lastmod` 字段仅在该页面内容 hash 实际变更时更新,不是构建时间戳或固定值(假 `lastmod` 会被 Google 降信任,SD-27 明确警告)-> unit
- **hreflang 全站收口(回填自 SD-27C)**:全部 programmatic 页面(`/anime/:id` 全量 + S5.9 地区页 + 首页)的 `ja`/`zh`/`en` hreflang 互链闭合完整,用链接图测试验证无断链、无遗漏语言变体(S5.1 的 hreflang 起步覆盖单页,本 AC 验证全站闭环)-> integration

**变更文件**:`apps/web/src/lib/anime-page/structured-data.ts`(改写:TVSeries/Movie + BreadcrumbList + ImageObject)、`scripts/generate-anime-sitemap.ts`(新增,含 lastmod hash 比对逻辑)、`scripts/indexnow-push.ts`(新增)、`apps/web/src/lib/seo/hreflangGraph.ts`(新增,全站闭环校验)。

**依赖**:S5.1、S5.4、S5.8(质量门,新番 SLA 前置条件)。

---

### S5.7 GEO 引用友好排版 + AI 爬虫 robots 策略 + 内链结构

**Scope**:点位地址/话数/名場面组织成可被 AI 摘引的事实块;robots 策略放行主流 AI 爬虫;作品页↔路线详情↔首页排行的内链闭环。**点位不独立成页(呼应 DD-14,明确的非目标非遗漏)**:本 story 的事实块以作品页内锚点(`/anime/:id#point-:pid`)组织,不新建点位独立页面——SD-27A 判定点位级 UGC 厚度不足前维持 thin content 防线,DD-14 登记"点位 UGC 覆盖率 ≥20%"为解冻触发条件。

**设计依据**:无视觉画布;inputs SEO/GEO scope(迭代 5 主战场)。

**核心 AC**:
- 快乐路径:作品页上的点位地址/话数/场景名以结构化"事实块"模式组织(语义化标记,非纯散文),便于 AI 爬虫清晰摘引 -> unit
- 快乐路径:`robots.txt` 显式放行 GPTBot/ClaudeBot/PerplexityBot -> unit
- 快乐路径:作品页↔路线详情↔首页排行之间存在双向内链(用链接图测试验证)-> unit

**变更文件**:`apps/web/public/robots.txt`(更新)、`apps/web/src/components/anime-page/FactBlock.tsx`、`apps/web/src/lib/seo/internalLinks.ts`。

**依赖**:S5.1、S5.6。

**验证工序**:发布后按主 spec §⑪ 跑 `claude-seo` 插件(含 seo-geo agent)审计出分,记入本迭代 Tester 报告。

---

### S5.8 Catalog 数据质量门(X15)

**Scope**:catalog publish 阶段的行级数据质量校验,防止"垃圾数据×SEO放大器=垃圾页面工厂"。

**设计依据**:无视觉画布;X15。

**核心 AC**:
- 快乐路径:坐标无效(超出经纬度范围或落在 null island 0,0)的点位记录在到达公开 overview 端点前被拒绝/标记,不流入公开页面 -> unit
- 快乐路径:重复点位检测(同坐标+同话数在小半径内)触发去重/合并,公开页不出现重复卡片 -> unit
- 空:零点位的作品平凡地通过质量门(不误判为异常拒绝)-> unit
- **告警 AC**:某作品点位数量相对上次发布出现骤降或骤增(数量漂移)触发告警(日志/通知),不是静默发布 -> unit

**变更文件**:`workers/catalog/src/publish/qualityGate.ts`(新增)、`workers/catalog/test/qualityGate.test.ts`。

**依赖**:S5.4(消费经质量门检查过的数据)。

---

### S5.9 地区页 `/area/:region`(都道府县+主要城市两级,回填自 SD-27)

**Scope**:programmatic 地区页,覆盖两级粒度——都道府县级 + 主要城市级,**不下探**(不做区/街道级,SD-27A 明确"区·街道级地区页(薄)"列入负清单)。每个地区页聚合该地区内有巡礼点位的作品列表 + 该地区的点位统计,是 SD-27A 页面矩阵中"programmatic 全量铺开"的第二块拼图(第一块是 `/anime/:id`)。

**设计依据**:无视觉画布;`2026-07-06-seo-geo-plan.md` §1 JSON-LD 映射表"地区页 `/area/:region`"行(`Place` 轻量 schema + geo 中心点)、§7 迭代映射。

**核心 AC**:
- 快乐路径:已知都道府县 `region` 的 `/area/:region` 渲染该地区内有巡礼点位的作品列表(按点位数排序)+ 地区点位统计 -> browser
- 快乐路径:主要城市级地区页(如某都道府县下的主要城市)同样渲染,两级路由结构清晰区分(URL 或参数层面) -> browser
- 空:零巡礼点位的地区(理论存在但当前数据无覆盖)渲染优雅空态,不是 500 或空白页 -> browser
- 错误:未知/不存在的地区标识符返回正规 404,不崩溃 -> browser
- **不下探边界(硬 AC)**:不存在区/街道级路由(如某市下的具体区),该层级请求应 404 或重定向到城市级,不是意外可访问的"影子路由" -> unit
- JSON-LD:地区页渲染 `Place`(轻量)JSON-LD,含 `name` + geo 中心点 -> unit
- **一实体一页 + 独特数据**(与 S5.6 同一原则):不同地区页的作品列表/统计数据必须随地区实际数据变化,不是模板复制 -> integration
- hreflang:地区页三语路由参与 S5.6 的全站 hreflang 闭环校验 -> integration

**变更文件**:`apps/web/src/routes/area/$region.tsx`(SSR)、`apps/web/src/components/area-page/*`、`apps/web/src/lib/area-page/structured-data.ts`(新增)。

**依赖**:S5.4(catalog 公开数据 enabler,复用其区域聚合能力)。

---

### S5.10 Programmatic 质量门进 CI(模板占比 + 最小信息厚度阈值,回填自 SD-27)

**Scope**:X15(S5.8)是 catalog **数据层**质量门(坐标有效性/去重/话数完整性,在 `workers/catalog` publish 阶段执行)。本 story 是**页面内容层**质量门,在 CI 中对已生成的 programmatic 页面(`/anime/:id` + `/area/:region`)做模板占比检查与最小信息厚度检查,直接对应 SD-27C 的 2026 spam update 依据——两者触发点不同(数据发布 vs 页面构建后的 CI 检查),不合并为一个 story。

**设计依据**:无视觉画布;`2026-07-06-seo-geo-plan.md` §7"质量门进 CI(模板占比 + 最小信息厚度)"(SD-27C)。

**核心 AC**:
- 快乐路径:CI 脚本抽样构建产物中的 programmatic 页面,计算"模板固定文本 / 页面总文本"占比,占比超过预设阈值(如 70%)的页面判定为 CI 失败(阻断部署),不是仅记录警告 -> integration
- 快乐路径:CI 脚本检查每个 programmatic 页面的"独特信息量"(如事实速览块字段数、非模板段落长度)是否达到最小厚度阈值,低于阈值的页面判定为 CI 失败 -> integration
- 空:零 programmatic 页面的构建产物(理论边界,不应发生但需优雅处理)不导致 CI 脚本本身崩溃 -> unit
- 回归:S5.6/S5.9 新增字段导致模板占比意外上升时,CI 能在合并前捕获,而不是上线后才发现"垃圾页面工厂"效应 -> integration

**变更文件**:`scripts/check-programmatic-quality.ts`(新增)、`.github/workflows/ci.yml`(新增 `ci-content-quality` job 或纳入现有 web CI job)。

**依赖**:S5.6、S5.9(检查对象是这两个 story 的产出)。
