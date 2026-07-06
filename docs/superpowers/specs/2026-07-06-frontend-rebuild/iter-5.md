# Iteration 5 — 発見:作品页+首页

详细度:**开工前细化**。Story 数:8。

依赖顺序建议:S5.4(catalog 公开数据 enabler,需 eng review 签字,建议尽早启动)→ S5.1 → {S5.2, S5.3} → S5.6 → S5.7 → S5.8(可与前面并行,消费方是 S5.4)。S5.5 首页依赖 S2.8(続きから)与 S1.1(搜索跳转复用),可与作品页并行开发。

**catalog 首次公网暴露(风险,见主 spec §⑨)**:S5.4 是本列车对 `workers/catalog` **唯一一次**扩大暴露面的 story,合并前需 eng review 签字。

**SD-8 定案提醒**:S5.5 的"続きから"只依赖 `sessions`/`routes` 数据,**不依赖** `user_memory`(该表休眠,不投入新功能)。

---

### S5.1 作品公開页 shell(A 図鑑型,SSR)+ SW network-first(X7)

**Scope**:`/anime/:id` 选择性 SSR 渲染,hero + 名場面 TOP(按カット数排序)。B ポスター型变体留档不实现(见主 spec §⑥)。

**设计依据**:`作品公開页 状态总览.html`(A 図鑑型,已定稿);`作品公開页 demo.html`;`user-journey.md` §3.1"作品公开页"。

**核心 AC**:
- 快乐路径:已知 `bangumi_id` 的 `/anime/:id`(SSR)服务端渲染出 hero + 按カット数排序的名場面 TOP -> browser
- 空:零圣地记录的作品渲染"この作品はまだ聖地情報がありません"等优雅状态,不是破损页面 -> browser
- 错误:未知/无效 `bangumi_id` 返回正规 404 页,不崩溃 -> browser
- **X7 硬 AC**:已激活 SW 的情况下请求 `/anime/:id` 不返回陈旧缓存 HTML(network-first)-> browser

**变更文件**:`apps/web/src/routes/anime/$bangumiId.tsx`(SSR)、`apps/web/src/components/anime-page/*`、`apps/web/src/sw.ts`(扩展规则)。

**依赖**:S5.4(数据源)。

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

### S5.6 Programmatic SEO(JSON-LD + per-anime sitemap)

**Scope**:`/anime/:id` 页面 JSON-LD(TouristTrip + CreativeWork)+ 按作品自动生成的 sitemap 条目。

**设计依据**:无视觉画布;移植 `apps/agent/agent/tests/unit/test_seo_static_files.py` 模式(S0.8 已引入的基建)。

**核心 AC**:
- 快乐路径:`/anime/:id` 页面含合法的 JSON-LD,组合 TouristTrip + CreativeWork 两种 schema 类型 -> unit
- 空:零点位的作品页仍产出合法(即使精简)的 JSON-LD,不是缺失/损坏的 script 标签 -> unit
- 自动化 AC:per-anime sitemap 条目由构建/部署时脚本从 catalog 数据自动生成,不是手工维护 -> integration

**变更文件**:`apps/web/src/lib/anime-page/structured-data.ts`、`scripts/generate-anime-sitemap.ts`(新增)。

**依赖**:S5.1、S5.4。

---

### S5.7 GEO 引用友好排版 + AI 爬虫 robots 策略 + 内链结构

**Scope**:点位地址/话数/名場面组织成可被 AI 摘引的事实块;robots 策略放行主流 AI 爬虫;作品页↔路线详情↔首页排行的内链闭环。

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
