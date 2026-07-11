# ADR-0001 · 地图栈:MapLibre GL + Protomaps PMTiles 自托管(Cloudflare R2 + Workers)

> 状态:ACCEPTED(2026-07-11)
> 范围:S0.4(issue #237);blocks S1.4 / S1.5 / S2.2 / S5.2 / S6.2;离线伏笔 S3.6 / S3.10
> 调研全文(决策矩阵、需求映射、成本账、风险):`docs/superpowers/specs/2026-07-11-map-stack-adr.md`
> Spike:`docs/superpowers/spikes/map-stack/`(独立可运行)
>
> 本目录(`docs/adr/`)自本条起为架构决策记录统一归档处(修复 report C「无统一 ADR 目录」缺口)。
> 早于本目录的 ADR 存于 `docs/superpowers/specs/`(如 2026-06-13-architecture-adr.md、2026-04-15-api-adr.md),不迁移。

## Context

前端重建需要一套地图栈,服务五类消费者(chat 静态地图卡、路线轨迹、MODE FLIP 交互地图、
作品页 bubble map、双栏 hover 联动),iteration 3 的 Walk mode 还要求离线可用。
约束:全栈 Cloudflare(能用 CF 基建的优先)、solo dev 成本敏感、static-first(chat 卡)、
日语标注第一公民、Mapbox 被 X1 明令禁用。

## Decision

1. **引擎 = MapLibre GL JS v5**(BSD-3,无 key,无按 load 计费)。SSR 下 client-only 懒挂载,地图 chunk 独立分包。
2. **Tile 供应 = Protomaps 日构建 → `pmtiles extract` 日本区域 → 自托管 R2**。
   实测:宇治·京都 bbox z0-15 仅 20.4MB / 25 秒可得;日本全域成本落在 R2 免费层~美分级。零 egress,无 API key。
3. **服务形状 = edge worker 新增 `/tiles/{z}/{x}/{y}.mvt` ZXY 端点**,采用 Protomaps 官方
   Cloudflare worker 逻辑(R2 binding + Cache API + CORS),与现有 `/img/*` 反代缓存模式同构;
   bucket = `seichijunrei-assets`(`wrangler.toml` 直接声明,spec 认可的 D9 例外);
   CJK glyphs/sprites 同 bucket 自托管。
4. **静态层 contract(static-first)**:品牌插画 + SVG pin 即时渲染 → 空闲时可选
   non-interactive GL 静默 hydrate → 点击升格交互;任何 tile 故障停留插画层(永无碎 tile)。
5. **离线(Walk)**:同一 PMTiles 基建两路径——SW 预取路线 bbox 的 ZXY URL;或
   `pmtiles extract` 区域包 + pmtiles `FileSource` 本地全离线读。
6. **日语标注**:`@protomaps/basemaps` `lang:"ja"` 样式(41 语言,CJK 内建);zh/en 切换同数据换样式。
7. **备选登记**:OpenFreeMap = 开发期/应急后备(免费无限无 key,但无 SLA);
   GSI 地理院タイル = 未来日本官方叠加层选项;MapTiler 不采(free tier 禁商用);
   Google Maps 被离线需求一票否决;Mapbox 维持 X1 禁用。

## Consequences

- 地图边际成本 ≈ $0,流量峰值不产生按 load 账单;数据与服务全部在自有 CF 控制面。
- 换来月度 `scripts/build-pmtiles.sh` 数据更新职责(不更新也不会坏)与 ODbL 署名义务
  (© OpenStreetMap contributors + Protomaps)。
- 上游断供退路:planetiler 自建管线;应急切换:OpenFreeMap style URL。
- S1.4/S1.5/S2.2/S5.2/S6.2 全部只依赖「MapLibre 实例 + 数据驱动样式 + DOM/SVG 叠加」,
  无商业 SDK 独有能力;S3.6 离线由自托管 PMTiles 唯一优雅满足——这是本选型的决定性理由。
- apps/web 内 demo route、生产 `[[r2_buckets]]`、`perf-mobile-cold` 正式测量待 S0.2 合流后接线(issue #237 跟踪)。
