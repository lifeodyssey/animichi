# SEO/GEO 落地包(SD-27 实施细则 + 迭代映射)

> 决策依据:SD-27 A/B/C(inputs 第十节)+ 2026-07-06 调研代理报告(Ahrefs/Semrush/Google 官方一手数据)。
> 本文档 = 任务 #9(落地细则)+ #10(迭代映射)产出;spec 回填(任务 #3)时按「迭代映射」节拆 story/AC。

## 1. JSON-LD 映射表(收缩版:实体消歧,不追 rich results)

依据:FAQ rich results 已停显、TouristAttraction/TouristTrip/ItemList 不在 Google 支持列表、Ahrefs 对照实验证 schema 无 AI 引用增益 → 只保留实体消歧最小集,拒绝 schema 堆料。

| 页面 | JSON-LD | 要点 |
|---|---|---|
| 首页 | `Organization` + `WebSite` | Organization: name=Animichi, logo, `sameAs`(X/GitHub 等社交档案,Entity SEO 锚点)。全站唯一完整版 |
| 所有内容页 | `BreadcrumbList` | 首页 > 作品 > (锚点不进面包屑) |
| 作品页 `/anime/:id` | `TVSeries` 或 `Movie`(eps 判型) | name + `alternateName`(三语标题)+ image(cover)+ datePublished。**点位坐标不进 JSON-LD**(几百个 Place 是噪声,爬虫从正文读) |
| 地区页 `/area/:region` | `Place`(轻量) | name + geo 中心点 |
| 分享页 `/s/:id` | `TouristTrip`(轻量) | name + description + 站数;itinerary 只列首尾站(防膨胀) |
| 対比図/代表帧图片 | `ImageObject` | `contentUrl` + **`license`(CC BY-NC-SA)+ `creditText`(origin 字段)** —— 一石二鸟:Anitabi 署名义务 + Google Images licensable 标 |

## 2. 事实速览块(作品页首屏,GEO/snippet 双喂)

- 定位修正(SAGEO 证伪修辞战术后):这不是"GEO 魔法",是 featured snippet 素材 + 实体清晰度 + 可检索性。
- 数据全部来自 catalog 现成字段,**不引入没有的数据**(如车站——catalog 无此字段,不编造):

| 字段 | 来源 |
|---|---|
| 点位总数 | pointsLength |
| 主要城市 top3 + 各自点数 | PostGIS 聚合 |
| 建议巡礼时长 | 路线规划器估算(点数 × 停留 + 步行) |
| 取景话数范围 | ep 字段聚合(movie 显示"剧场版") |
| 数据来源署名 | Anitabi + CC BY-NC-SA(license 义务的正文露出点) |

- 形态:`<section>` + `<dl>`,每句自包含可独立摘引(例:「『君の名は。』の巡礼スポットは東京を中心に68ヶ所。」)。
- 三语各自本地化生成(呼应 SD-27C:title/H1/slug 本地化硬 AC),不是翻译正文的附属品。

## 3. 域名迁移清单(seichijunrei.app → animichi.com,迭代 0 一次到位)

现流量近零 = 迁移成本最低窗口。清单(全部迭代 0):

- [ ] animichi.com 入 CF、TLS/DNS 就绪
- [ ] 旧域全路径 301 → 新域对应路径(Worker redirect 规则;无对应页兜底首页)
- [ ] GSC 双产权验证 → Change of Address 申报;Bing Webmaster 同步
- [ ] canonical / OG / sitemap / robots 全指新域;域名走构建环境变量,**AC:grep 全仓无旧域硬编码残留**
- [ ] Supabase auth 回调 URL + 邮件模板域名更新(auth 域名清单单列,漏一条=登录事故)
- [ ] 旧域续费保留 ≥2 年(301 权重传递期)

## 4. sitemap 体系 + 新番 SLA + 动态 OG

**sitemap 结构**:index → `sitemap-anime.xml` / `sitemap-areas.xml` / `sitemap-routes.xml`(公开分享)/ `sitemap-images.xml`(対比図/代表帧)/ 静态页。`lastmod` 必须真实(内容 hash 变更才动——假 lastmod 会被 Google 降信任)。

**新番 SLA(迭代 5 起生效)**:catalog 新作品过 X15 质量门(点位数 ≥ 阈值)→ **≤24h 进 sitemap**。实现 = Worker cron 重生成 sitemap(Neon 查询 → 静态产物)。
**推送**:Google sitemap ping 端点已死(2023 弃用)→ 靠 GSC 自动重抓 + **IndexNow**(Bing/Naver 系即时推送,免费,一个 key 文件 + 每新页一次 POST)。

**动态 OG(迭代 4)**:作品页 = cover + 点位数 + 帧对比拼版;分享页 = 路线缩略 + 站数。1200×630,文案随页面语言,产物缓存 R2。技术选型(Satori 系 workers-og / CF Images)留给 executor。迭代 0 先上静态 OG 兜底。

## 5. L3 增长分析(2026-07-06 用户批准)

- **GSC + Bing Webmaster**(迭代 0):产权验证 + 提交 sitemap。SEO KPI 主数据源(收录/点击/查询词)
- **Cloudflare Web Analytics**(迭代 0):免费、无 cookie、beacon 一行;流量/referrer 报表
- **AI referral 归因**:约定 referrer 清单(chatgpt.com / chat.openai.com / perplexity.ai / claude.ai / copilot.microsoft.com / gemini.google.com)→ 巡检时人工读 CF referrer 报表;自动打标推迟(量到 DD-15 级别再说)
- 不上 GA4(重、隐私负担、用不到深度)
- **KPI 基线(飞轮 4 度量落位)**:收录页数(GSC)/ 自然点击(GSC)/ AI referral 会话(CF)/ AI 引用抽检(claude-seo 审计,每迭代一跑)

## 6. robots.txt / llms.txt(迭代 0)

```
# 训练爬虫:挡(CC BY-NC-SA 合规姿态)
User-agent: GPTBot            → Disallow: /
User-agent: ClaudeBot         → Disallow: /
User-agent: Google-Extended   → Disallow: /
# 搜索/引用/Agent 爬虫:全放行(GEO 流量来源 + 自家是 AI 应用)
OAI-SearchBot / Claude-SearchBot / Claude-User / ChatGPT-User / PerplexityBot → Allow
Sitemap: https://animichi.com/sitemap.xml
```

- llms.txt:静态一页(站点简介 + 主要 URL 模式 + MCP endpoint 预留行),≤1 小时,不建 llms-full 管线
- **硬 AC(迭代 0)**:CF AI Crawl Control 面板人工核查(2026-09-15 新默认会挡 Training+Agent)+ 各爬虫 UA `curl` 实测无隐形 403

## 7. 迭代映射(任务 #3 回填 spec 时按此拆 story/AC)

| 迭代 | SEO/GEO 内容 |
|---|---|
| **0 地基** | 域名迁移清单全项 / robots.txt + llms.txt / sitemap 骨架 + IndexNow key / GSC + Bing + CF Analytics / Organization + WebSite + BreadcrumbList / 静态 meta + OG / **CF 爬虫可达硬 AC** |
| **1 計画Chat** | (无 SEO 面)图搜埋点五信号随全信号埋点上 |
| **2 详情+列表** | 作品页 TVSeries/Movie JSON-LD + **事实速览块 v1(三语)** + ImageObject/license + hreflang 起步(随 SSR 三语路由) |
| **4 残すしおり** | 动态 OG + 対比図入 image sitemap |
| **5 発見+首页** | 地区页 /area/:region + programmatic 全量铺开 + hreflang 全站收口 + **质量门进 CI**(模板占比 + 最小信息厚度) + 新番 sitemap SLA 生效 |
| **7 开放接口** | MCP-as-GEO:MCP Registry + mcp.so/Glama 提交 + isitagentready 五维自检 + llms.txt 补 MCP endpoint |

## 8. 明确不做(负清单,防回潮)

- ✗ FAQPage schema(已停显)/ TouristAttraction 堆料 / SearchAction
- ✗ llms-full.txt 维护管线(97% 零请求)
- ✗ GA4 / 独立 GEO 预算 / "GEO 战术包"修辞优化(SAGEO 证伪)
- ✗ 点位独立页(→ DD-14)/ 区·街道级地区页(薄)
- ✗ sitemap ping 端点(已死,用 IndexNow)
