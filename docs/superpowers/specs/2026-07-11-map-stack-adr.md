# 地图栈 ADR · MapLibre GL + PMTiles 自托管(R2 + Workers)——调研与决策全记录

> 状态:ACCEPTED(2026-07-11,S0.4 / issue #237;X1 既定方向经本轮调研 + spike 验证后确认)
> 决策人:用户(经 spec X1 冻结方向);本文档 = 选型证据链 + 需求映射 + 分阶段策略
> 简版决策记录:`docs/adr/0001-map-stack-maplibre-protomaps.md`(本文是它的调研附录)
> Spike 代码:`docs/superpowers/spikes/map-stack/`(独立可运行,不依赖 apps/web)
> 关联:spec `2026-07-06-frontend-rebuild/iter-0.md` S0.4;被 block:S1.4 / S1.5 / S2.2 / S5.2 / S6.2;离线伏笔:S3.6 / S3.10

## 1. 背景与约束

前端重建(TanStack Start + apps/web)需要一套地图栈,同时喂饱五类消费者:chat 静态地图卡、
路线轨迹升格、MODE FLIP 交互地图、作品页 bubble map、双栏 hover 联动;iteration 3 的
Walk mode 还要求**离线**可用。约束按重要度排:

- **全栈 Cloudflare**(用户 2026-07 追加铁律):凡 CF 基建能解决的优先用上。repo 里已有
  现成抓手——Pulumi 声明的 R2 bucket `catalog-media`(`infra/index.ts`)、edge worker
  成熟的 `/img/*` 反代 + Cache API 缓存模式(`worker/app.ts` `handleImageProxy`)。
- **成本敏感**:solo dev,优先自托管/免费层;拒绝按 map-load 计费的商业模式绑死获客环
  (分享页爆火 = 成功时刻,不能同时是账单事故)。
- **static-first**:chat 地图卡默认静态层,点击才挂 GL(`spec-chat-page-design.md` §4;
  该文中 "Mapbox" 字样按 X1 一律读作 MapLibre)。
- **日语标注是第一公民**:全产品日文为主(user-journey §6.8),地名标注质量直接是产品质量。
- **离线**(S3.6/S3.10):Walk mode 断网可用,route bundle 里要能装下地图数据。
- **X1 已冻结**:MapLibre GL + Protomaps(pmtiles on R2),**Mapbox 明令禁用**
  (`NEXT_PUBLIC_MAPBOX_TOKEN` 由 S0.3 移除)。本 ADR 的职责不是重开选型,而是
  **用调研和 spike 证明 X1 成立**、把五个被 block story 的需求逐条对上,并把
  tile 供应、成本、离线路径、风险写成可执行的决定。若证据显示 X1 不成立,本 ADR 有义务推翻它——调研结论是:成立。

## 2. 候选与决策矩阵

### 2.1 引擎层(渲染库)

| 维度 | **MapLibre GL JS v5.24** | Google Maps JS API | Mapbox GL JS v3 |
|---|---|---|---|
| License | BSD-3(开源,fork 自 mapbox-gl v1) | 专有,须走 Google 渲染器 | v2 起专有,绑定 Mapbox 账号 |
| 计费 | $0(库本身永远免费) | Dynamic Maps 每月 1 万次免费,之后 $7/千次 loads | 每月 5 万 loads 免费,之后阶梯计费 |
| 自带 tile? | 无——tile 供应自由选(见 2.2) | 强制 Google tile,禁离线缓存 | 强制 Mapbox token,tile 含 Zenrin 日本数据 |
| 静态首屏成本 | 可绕开:静态层用插画+SVG,GL 按需挂载;GL 本体 lazy chunk | 每次挂载即计费 + 脚本重;无"半静态"档 | 同 MapLibre 技术形态,但每次 GL 挂载计一次 load |
| 交互性能 | WebGL 矢量,风格/数据驱动样式全开放;v5 含 globe | WebGL 矢量,性能好但样式自由度低(Cloud Styling) | WebGL 矢量,业界标杆 |
| 离线/PMTiles | ✅ pmtiles 协议官方插件;`FileSource` 读本地 File/Blob | ❌ ToS 禁止缓存 tile,离线不可行 → **S3.6 直接死** | Web 端无离线;离线只在移动原生 SDK |
| Capacitor/WebView | ✅ 纯 web 库,WKWebView/Android WebView WebGL 即跑 | 可跑但每 WebView 挂载都是计费 load | 可跑,同样计费 |
| 日本地图质量 | 取决于 tile 源(见 2.2) | 日本本土最强(自家数据) | Zenrin 合作,日本质量好 |
| CF Workers/SSR | 客户端 only(需 window);SSR 下 lazy client-mount 即可 | 同为客户端 only | 同为客户端 only |
| 生态 | react-map-gl v8、@protomaps/basemaps、社区活跃 | 封闭生态 | 封闭生态(v2 起) |

**结论**:Google 被离线一票否决(Walk mode 是 journey 的审判点,S3.6 明确要求断网可用),
且按 load 计费与"分享页爆火"的获客环相冲。Mapbox 被 X1 明令禁用,license/计费/token
遥测本身也站不住。**引擎 = MapLibre GL JS**,唯一疑点转移到 tile 供应——这才是本 ADR 真正的选型题。

### 2.2 Tile 供应层(给 MapLibre 喂什么)

| 维度 | **A. CF-native 自托管:PMTiles on R2 + Workers**(Protomaps 日构建) | B. OpenFreeMap(免费托管) | C. MapTiler Cloud | D. GSI 地理院タイル(补充项) |
|---|---|---|---|---|
| 月成本 | **≈ $0**:日本区域 extract 存 R2(免费层 10GB 内,见 §6);零 egress;Workers 请求走现有付费计划($5/mo 含 1000 万次,已在付) | $0,无限请求、无 key、无注册 | Free tier **禁商用**;商用最低 Flex $30/mo(2.5 万 sessions) | $0(出典「国土地理院」+ 链接) |
| API key | **无** | **无** | 必须(可经 Worker 反代藏 key + 省配额,但 ToS 对缓存有约束) | 无 |
| 日语标注 | ✅ Protomaps 41 语言含 `name:ja`;`@protomaps/basemaps` 一行 `lang:'ja'` 出日语样式;MapLibre 内建 CJK 渲染 | ✅ OpenMapTiles schema 含 `name:ja`,但官方样式需自行改日语优先 | ✅ 日本区数据 = OSM + 国土地理院基盤地図(MIERUNE 分发),质量好 | ✅ 官方日本地图,标注最正统;仅日本域内 |
| 离线(Walk) | ✅ **同一基建两用**:`pmtiles extract` 出区域包 → SW 缓存 / `FileSource` 本地读;零额外供应商 | ❌ 托管服务是 z/x/y 散文件,无区域打包;自托管=整颗行星(Btrfs/MBTiles),重 | ⚠️ 数据下载在高价计划里 | ⚠️ raster 散 tile,可逐张缓存但体积差 |
| 可控性/SLA | 数据在自己 R2,worker 自己写;唯一上游依赖 = Protomaps 日构建下载(断供可退 planetiler 自建,见 §7) | 无 SLA,一人项目(Hetzner + Cloudflare 赞助带宽;2025-08 扛过 100k req/s,韧性有实证但无承诺) | 99.9% SLA 在 Custom 档 | 政府服务,稳定;但 raster、样式不可定制 |
| 品牌样式自由度 | ✅ 全开放:動森 token 配色的自定义 style JSON、插画静态层随便做 | ⚠️ 样式可自定义(schema 是 OpenMapTiles,和 Protomaps schema 不同,两套 style 不通用) | ✅ 可自定义 | ❌ raster 即所得 |
| CF-native 契合 | **满分**:R2 + Workers + Cache API + 自定义域,照抄 `/img/*` 形状加 `/tiles/*` 路由 | 部分(它自己也被 CF 赞助 CDN,但不在我们控制面) | 无(外部 SaaS;反代可补) | 无(外部,反代可补) |
| 维护成本 | 月度脚本:`pmtiles extract` 新构建 → rclone 上传 R2(`scripts/build-pmtiles.sh`,可挂 cron;不更新地图也不会坏) | 零 | 零 | 零 |
| License/署名 | ODbL Produced Work:署名 © OpenStreetMap + Protomaps | 署名 OpenFreeMap + OpenMapTiles + OSM(MapLibre 自动) | 商业 ToS | 出典「国土地理院」+ タイル一覧页链接,商用可 |

**结论**:**A(PMTiles on R2)为主供应**——成本≈0、无 key、离线与在线共用一条 extract
工具链、全套在自家 CF 控制面里,和 X1 完全一致。**B(OpenFreeMap)记为开发期免注册后备
与应急逃生门**(主路径故障时的快速切换,但产品的 D7 降级态仍按设计走插画层,不引入第二 schema
的样式维护负担)。**C(MapTiler)不采**:free tier 禁商用是硬伤,$30/mo 起步买不到 A 给不了的东西。
**D(GSI)不做基底**,记为未来叠加选项(登山/等高线/官方航拍,Walk 深化时再议)。

### 2.3 决策矩阵(汇总打分)

打分 1-5,权重按本产品语境(离线与成本是硬门槛):

| 维度(权重) | A. MapLibre+R2 PMTiles | B. MapLibre+OpenFreeMap | C. MapLibre+MapTiler | D. Google Maps | E. Mapbox |
|---|---|---|---|---|---|
| 静态首屏成本(×2) | 5(插画层零 tile;GL 惰性) | 5(同左) | 4(同形态,session 计费悬顶) | 2(挂载即计费+脚本重) | 3 |
| 交互性能(×1) | 4 | 4 | 4 | 4 | 5 |
| 离线/PMTiles(×2) | **5** | 2 | 2 | **0** | 1 |
| Capacitor/移动(×1) | 5 | 5 | 4 | 3 | 3 |
| 日本地图质量·日语标注(×2) | 4(OSM 日本 + name:ja 样式) | 4 | 4.5(OSM+基盤地図) | **5** | 4.5 |
| License/费用(×2) | **5**(≈$0,BSD-3,无 key) | 4.5(免费但无 SLA) | 2(商用 $30/mo 起+key) | 1 | 0(X1 禁用) |
| CF Workers/SSR/CF-native(×1) | **5** | 3 | 2 | 1 | 1 |
| 加权合计(满分 55) | **51** | 41.5 | 33 | 21 | 22(且被禁) |

## 3. 决策

### D1 · 引擎 = MapLibre GL JS v5(BSD-3,npm `maplibre-gl@^5.24`)

客户端渲染库唯一选择(§2.1)。SSR 约束:MapLibre 需要 `window`/WebGL,TanStack Start 下
一律 **client-only 懒挂载**(`useEffect`/dynamic import;地图 chunk 独立分包,不进首屏 bundle)。

### D2 · Tile 供应 = Protomaps 日构建 → `pmtiles extract` 日本区域 → R2 自托管

- 数据源:`build.protomaps.com` 日构建(planet z0-15,**实测 2026-07-10 构建 = 136.7GB**),
  ODbL,schema 文档化,`@protomaps/basemaps` 官方样式含 `lang:'ja'`。
- 只取日本:`pmtiles extract --bbox=<日本>` 远程按需拉取(spike 实测:宇治·京都 bbox
  z0-15 = **20.4MB,25 秒,45 个 range 请求**——不需要下载行星文件)。体积与成本账见 §6。
- 覆盖策略:第一阶段按 spec 至少 Kansai/Kanto;日本全域 z15 体积依然平价(§6),
  建议直接全日本一步到位,免得"点位刚好在 bbox 外"这类边界折腾。
- 更新:后续交付 `scripts/build-pmtiles.sh`(spec 对 S0.4 点名的产物,apps/web 接线时一并落地;
  月度手动或 cron)重新 extract + 上传;spike 内已有其雏形
  `docs/superpowers/spikes/map-stack/scripts/fetch-tiles.sh`。地图数据不更新也不腐坏。

### D3 · 服务形状 = edge worker 新增 `/tiles/*` ZXY 端点(照抄 `/img/*` 模式)

- 采用 Protomaps 官方 Cloudflare worker 逻辑(`protomaps/PMTiles` 仓库
  `serverless/cloudflare`):R2 binding 读 pmtiles、按 z/x/y 切片返回、Cache API 缓存
  (默认 `public, max-age=86400`)、CORS 白名单。**与 repo 现有
  `worker/app.ts` 的 `handleImageProxy`(Cache API + `waitUntil` 回填)完全同构**,
  作为 Hono 路由挂进现有 edge worker 即可,不新开 worker。
- 端点形态选 **ZXY**(`/tiles/{z}/{x}/{y}.mvt`)而非裸 range 透传:每 tile 一个 URL,
  CDN 缓存粒度最优、同源无 CORS、不暴露 bucket 结构;客户端 style 直接写
  `tiles: ["https://<host>/tiles/{z}/{x}/{y}.mvt"]`,连 pmtiles 协议都不用进生产前端包
  (pmtiles 协议留给离线 FileSource 场景)。
- 字体(CJK glyphs)与雪碧图同样自托管:`protomaps/basemaps-assets` 拷入同一 bucket,
  `/tiles/fonts/...`、`/tiles/sprites/...` 同源供给(spike 阶段暂用 GitHub Pages 官方资产,
  生产切 R2,消灭第三方运行时依赖)。
- Bucket:按 spec 用新桶 `seichijunrei-assets`,`wrangler.toml` 直接声明 `[[r2_buckets]]`
  (spec 明示这是 D9「Pulumi 非目标」的显式例外;`infra/index.ts` 的 `catalog-media`
  先例说明两种声明方式并存,后续如收归 Pulumi 是纯机械迁移)。
- R2 冷读延迟(官方文档自述可达 500ms+)由 Cache API + 自定义域缓存吸收;tile 内容按天
  immutable,缓存命中率天然高。

### D4 · 静态层 contract(chat 地图卡,static-first 的落地语义)

`spec-chat-page-design.md` §4 原案照办,并把"static"钉成如下三态渐进:

1. **即时态(0ms)**:品牌插画底图(静态资产)+ **SVG pin 叠加层**。投影/pin 布局/升格
   编排写 plain TS(headless 核,§5 约束),React 只是适配器。流式更新直接改 SVG,零 WebGL。
2. **静默 hydrate(可选,idle 时)**:视口内且浏览器空闲时,挂载 **non-interactive**
   MapLibre 实例(`interactive:false`、无控件、`fadeDuration:0`)替换插画层,呈现真实地理。
   失败(tile 4xx/5xx、WebGL 不可用)则**停留在插画层**——这正是 S0.4 AC3 与 S1.4 D7
   降级态的实现:永远没有"碎 tile 图标"。
3. **升格(用户点击)**:同一实例开启手势与控件,进入交互态(S2.2 的 MODE FLIP 就是
   这个升格的全屏版)。

矢量 GL 的空白区渲染为背景色而非碎图占位——S0.4 AC2(bbox 超出覆盖返回空 tile 时
地图显示底色)由引擎语义免费满足,spike 已验证。

### D5 · 离线(iter-3 伏笔,本 ADR 只钉可行性与形状)

同一 PMTiles 基建两条离线路径,S3.6 落地时二选一或并用:

- **SW 缓存 ZXY**:Walk route bundle 预取路线 bbox 的 `/tiles/z/x/y` URL 集(z12-15),
  标准 Cache API,无 range 特技(D3 选 ZXY 的连带红利)。
- **FileSource 区域包**:`pmtiles extract` 出路线区域的小 pmtiles(宇治全域才 20MB 级)
  → 存 OPFS/Capacitor filesystem → `new PMTiles(new FileSource(file))` 全离线渲染
  (pmtiles JS 内建 `FileSource`,spike demo 3 已验证 Blob 路径)。
- S3.10 的 OSRM 折线是另一条数据流(Geofabrik japan extract 喂自托管 OSRM),与 tile
  栈解耦;折线只是 GeoJSON line layer,MapLibre 侧零新依赖。

### D6 · 日语标注

`@protomaps/basemaps` 的 `layers(source, theme, { lang: "ja" })` 生成日语优先样式
(`name:ja` → 本地 `name` 回退);MapLibre 内建 CJK 文本渲染;glyphs 用官方
basemaps-assets(含 CJK 字形,自托管见 D3)。中文/英文 locale 切换 = 换 `lang` 重建
layers,同一 tile 数据,零额外供应成本(i18n AC 的地图部分由此满足)。

## 4. 被 block story 的需求映射

| Story | 它要什么 | 本决策怎么给 |
|---|---|---|
| **S1.4** 搜索结果:点位卡 + 静态地图(C3a)/ bubble 总览(C3b) | 静态地图 ≤50 pin;圏泡(面积∝件数)且低 zoom 永不画散 pin;D7 降级 = 手绘 SVG + 「地図アプリで開く」;ja/zh/en 地名 | D4 三态静态卡(pin=SVG 叠加,数据驱动);C3b = 聚合结果画 SVG 圆(静态层)或 GL circle layer 半径按 `sqrt(count)` 数据驱动;D7 = D4 的失败停留态;地名 i18n = D6 |
| **S1.5** 路线卡 + 地图升格(轨迹/重编号/降透明/金 pill) | 轨迹绘制、pin 按步行序重编号、非路线点降透明、金色 route pill | GL line layer(暖棕虚线 `#8a6f4d dasharray`)+ symbol/DOM marker 重编号 + feature-state 降透明;pill 是 DOM 叠加,与引擎无关。升格 = D4 状态 3 |
| **S2.2** MODE FLIP + pin 语言 + 进度 pill | 360ms FLIP idle⇄全屏地图;48px 相框 pin(済 teal 徽 / 現在 58px 金环★ / 未訪 白底编号);双击防抖 | FLIP 是容器动画(CSS/JS),地图实例复用不重建(MapLibre `resize()` 跟随容器);相框 pin 用 DOM Marker(每路线 ≤ 十几枚,DOM 成本可忽略,还能直接吃動森 token/阴影);状态切换改 class,不碰 GL |
| **S5.2** 作品页 bubble map | 泡面积∝点位数、地域名匹配、点泡 → zoom → 機位 sheet | GL circle layer 数据驱动半径 + `flyTo` + click 事件出 sheet;单泡/零照片空态是数据层逻辑,引擎无关 |
| **S6.2** 双栏常驻地图 + 双向 hover 联动(150ms 防抖) | 左列行 ⇄ 右栏 pin 双向高亮、防抖、无幽灵高亮 | headless anchoring 核(事件总线)+ MapLibre `feature-state` 高亮/DOM marker class;防抖在核里做,与地图库解耦(§5 headless 约束的直接收益) |
| **S3.6/S3.10**(伏笔) | route bundle 离线渲染;OSRM 折线 | D5 两路径;折线 = line layer,进同一 bundle 缓存 |

一句话:五个 story 全部只消费「MapLibre 实例 + 数据驱动样式 + DOM/SVG 叠加」三件套,
没有一个需要商业 SDK 独有能力;而离线(S3.6)只有自托管 PMTiles 能优雅满足。

## 5. 分阶段策略(静态卡 → 交互 → 离线)

| 阶段 | 交付 | 消费 story | 依赖的本 ADR 决策 |
|---|---|---|---|
| **Phase A(iter-1)** | 插画+SVG 静态卡、静默 hydrate、`StaticMap.tsx` 包装、`/tiles/*` 上线(Kansai/Kanto 起步或直接全日本) | S1.4、S1.5(轨迹升格) | D1-D4、D6 |
| **Phase B(iter-2/5/6)** | 全交互:FLIP 升格、相框 pin、bubble map、hover 联动 | S2.2、S5.2、S6.2 | D1-D3、D6(+A 的组件) |
| **Phase C(iter-3)** | 离线:route bundle 预取 / FileSource 区域包;OSRM 折线叠加 | S3.6、S3.10 | D5(复用 D2 工具链) |

跨阶段铁则:投影/聚合/anchoring/升格编排写 **plain TS headless 核**(spec-chat-page-design
§5,未来可回贡 Anitabi),React 与 MapLibre 都是适配器;地图 chunk 永远独立分包。

## 6. Tile 供应与成本账(实测 2026-07-11)

**体积(pmtiles extract 自 20260710 日构建,z0-15 除注明外)**:

| 范围 | bbox | 实测体积 | 备注 |
|---|---|---|---|
| 宇治·京都 z0-15(spike 用) | 135.68,34.85,135.85,35.02 | **20.4MB** | 25s / 45 个 range 请求 / 传输 22MB(overfetch 0.05) |
| 宇治·京都 z≤12 | 同上 | 2.8MB | z12→z15 实测 ≈ **7.3×**(与官方「每加一级约翻倍」≈8× 吻合) |
| Kansai z≤12 | 134.2,33.8,136.6,35.7 | 33.3MB | z15 估算 ≈ 33.3 × 7.3 ≈ **0.24GB** |
| Kanto z≤12 | 138.4,34.8,140.9,36.5 | 35.2MB | z15 估算 ≈ **0.26GB**(全球最密城市群也不过如此) |
| 日本全域 z≤12 | 127.0,26.0,146.0,45.8 | 327MB(4m46s / 58 请求) | z15 估算 ≈ **≤2.4GB**(×7.3 为偏都市的上界系数) |

**月度成本(R2 定价 2026-07 官方页)**:存储 $0.015/GB-月(免费层 10GB);Class A
$4.50/百万(免费层 100 万);Class B $0.36/百万(免费层 1000 万);**egress $0**。
spec 最低要求的 Kansai+Kanto z15 ≈ **0.5GB**,日本全域 z15 ≈ **2.4GB——都在 R2 免费层内,
存储成本 $0**(即便估算翻倍也只是 ~$0.07/月量级)。读放大被两层缓存(浏览器 + CF Cache API)
压扁,Class B 只发生在 cache miss。Workers 请求走现有 $5/mo 付费计划(含 1000 万次)。
对照:同等流量在 Google/Mapbox/MapTiler 是按 loads/sessions 线性计费。
**结论:地图栈边际成本≈0,爆流量时账单不随 loads 线性走;直接收全日本,不必抠 bbox。**

**供应链**:上游 = Protomaps 日构建(免费下载,官方明言别热链、要自托管——我们正是这么用);
断供后备 = planetiler 自建管线(开源,Geofabrik japan extract 喂入,几小时级构建);
应急后备 = OpenFreeMap 托管(换 style URL 即切,仅样式不同,数据同为 OSM)。

## 7. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| R2 冷读延迟(官方自述可达 500ms+) | 中 | Cache API + 自定义域(Protomaps CF 文档明确要求自定义域才有缓存);tile 按天 immutable,命中率高;首屏走 D4 插画层,GL 是渐进增强 |
| OSM 日本乡下/新开发区精度不及 Google | 中低 | 圣地本身来自 Anitabi(坐标独立于底图);底图只是空间语境;GSI 官方 tile 记为叠加后备;Google 静态嵌入(「地図アプリで開く」外链)兜底导航场景 |
| CJK glyph 首包重(日文字形 pbf 按 256 码位分片,首屏多拉几片) | 中低 | glyphs 自托管同源 + HTTP 缓存;非交互静态卡(D4 态 1)零 glyph;spike 实测请求瀑布见 README |
| Protomaps 日构建停更/断供 | 低 | 本地已存档 extract 可继续用(地图不更新不等于坏);planetiler 自建管线为退路(§6) |
| 一人上游(pmtiles 生态 bus factor) | 低 | 格式规格公开(v3 spec)、多语言实现、Linux 基金会背书(OSMF 官方 vector tiles 也押注 pmtiles 方向);数据永远在自己桶里 |
| Kanto z15 体积超预期(全球最密城市群) | 低 | 已实测消解:Kanto z≤12 仅 35.2MB,z15 估算 0.26GB;日本全域 z15 ≈2.4GB 仍在免费层 |
| ODbL 合规 | 低 | 地图角落署名 © OpenStreetMap contributors + Protomaps;OpenFreeMap 后备启用时加其署名 |
| `perf-mobile-cold` 3s 首 tile 预算(S0.4 AC1)在 spike 阶段无正式测量 | 中 | spike 记录未节流请求瀑布与体积证据;正式 Playwright 节流测量随 demo route 进 apps/web(S0.2 落地后接线,见 §8 范围说明);若超预算,D4 让静态卡先行、GL 延后挂载,AC 语义仍满足 |
| 无 WebGL 环境(极老设备 WebView、无 GPU 的 headless/CI 浏览器) | 中低 | D4 态 1(插画+SVG)本身就是完整降级链终点——**spike 实证**:在无 WebGL 的 headless Chromium(gstack browse)中,静态卡正确停留在插画层、页面不碎;两条推论:① GL 挂载前做 WebGL 能力检测,失败留在插画层(D4 已内建此语义);② E2E/perf 测试必须用带 SwiftShader 软渲染的浏览器(Playwright 自带 Chromium 可用),普通无 GPU headless 会静默空图 |

## 8. Spike 结论与范围说明

Spike(`docs/superpowers/spikes/map-stack/`,Codex 实现,独立 Vite + TS 项目)已全部验证
(真 Chrome QA:console 零错误零警告;AC2/AC3 语义、离线 FileSource、worker 模式
`/tiles/{z}/{x}/{y}.mvt` 200/204 均实测通过;无 WebGL 的 headless 下按 D4 停留插画层):

1. **静态地图卡**:插画+SVG 即时渲染 → non-interactive GL 静默 hydrate(動森 token
   pin:teal `#19c8b9` 普通站 / gold `#f0b429` ★高光站 / 暖棕 `#8a6f4d` 虚线路径,
   数值出自 user-journey §6.6 pin 语言),tile 故障停留插画层(AC3 语义)。
2. **交互地图**:标记/缩放/`flyTo`;飞出覆盖区显示背景色而非碎图(AC2 语义)。
3. **离线**:pmtiles → Blob → `FileSource` 全离线渲染(D5 可行性)。
4. **`/tiles/*` Worker**:Protomaps 官方 worker 形状 + `wrangler dev` 本地 R2 模拟
   (`--local` binding,无需真桶),证明 D3 服务形状与 `/img/*` 同构。
5. **供应链**:spike 内 `scripts/fetch-tiles.sh` 远程 extract(§6 实测数字的来源;
   生产版 `scripts/build-pmtiles.sh` 随 apps/web 接线交付)。

**范围说明**:iter-0 S0.4 的 releasable statement 提及 apps/web 内 demo route 与生产
R2 桶;因 apps/web 骨架(S0.2)由并行工序建设中,本 PR 交付 ADR + 独立 spike,
demo route 接线、`[[r2_buckets]]` 声明与 `perf-mobile-cold` 正式测量作为 S0.2 合流后的
后续小卡完成(见 issue #237 进度评论)。规避了对并行工序的目录依赖,不碰产品代码。

## 9. 来源

- Protomaps on Cloudflare(部署模型/缓存/成本/延迟注记):https://docs.protomaps.com/deploy/cloudflare
- Protomaps 日构建与 extract(planet ~120GB 文档值;2026-07-10 实测 HEAD 136.7GB):https://docs.protomaps.com/basemaps/downloads
- PMTiles 格式(单文件 + HTTP Range,云存储直读):https://docs.protomaps.com/pmtiles/
- PMTiles×MapLibre 协议接入:https://docs.protomaps.com/pmtiles/maplibre
- `FileSource`(浏览器本地 File/Blob 离线读,`js/src/index.ts` 导出):https://github.com/protomaps/PMTiles
- 官方 Cloudflare worker:https://github.com/protomaps/PMTiles/tree/main/serverless/cloudflare
- go-pmtiles CLI(extract):https://github.com/protomaps/go-pmtiles
- Protomaps 本地化(41 语言含 ja,CJK 处理):https://docs.protomaps.com/basemaps/localization
- R2 定价:https://developers.cloudflare.com/r2/pricing/
- OpenFreeMap(免费/无限/自托管/署名):https://openfreemap.org 及 https://openfreemap.org/tos/
- OpenFreeMap 扛 100k req/s + Cloudflare 赞助带宽:https://blog.hyperknot.com/p/openfreemap-survived-100000-requests
- MapTiler Cloud 定价(free tier 非商用;Flex $30/mo):https://www.maptiler.com/cloud/pricing/
- MapTiler 日本上陆(MIERUNE,OSM+基盤地図情報):https://internet.watch.impress.co.jp/docs/column/chizu3/1232026.html
- Google Maps Platform 2025-03 计价改制(per-SKU 免费额度;Essentials 1 万/月;Dynamic Maps $7/千):https://developers.google.com/maps/billing-and-pricing/pricing 、https://mapsplatform.google.com/pricing/
- Mapbox GL JS v2+ 专有 license 与 5 万 loads 免费层:https://github.com/mapbox/mapbox-gl-js 、https://www.mapbox.com/pricing
- Mapbox×Zenrin(日本数据分销):https://www.zenrin.co.jp/product/category/iot/api/mapbox/index.html
- GSI 地理院タイル利用規約(商用可,出典明示):https://maps.gsi.go.jp/development/ichiran.html 、https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
- maplibre-gl 5.24.0 / pmtiles 4.4.1 / @protomaps/basemaps 5.7.2 版本与 BSD-3 license:npm registry(2026-07-11 查询)
- repo 内部先例:`worker/app.ts`(`/img/*` proxy + Cache API)、`infra/index.ts`(R2 `catalog-media`)、`wrangler.toml`
