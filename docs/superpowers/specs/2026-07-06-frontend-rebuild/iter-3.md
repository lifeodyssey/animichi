# Iteration 3 — 歩く:Walk

详细度:**开工前细化**(story 清单 + 核心 AC 3-5 条 + enabler + 设计引用;完整模板细节留 Coordinator 排期该迭代前补齐)。Story 数:8。

依赖顺序建议:S3.7(打卡表,独立可先行)→ S3.1 → S3.2 → {S3.3, S3.4} → S3.5 → S3.6 → S3.8(素材可全程并行)。

**数据访问路径提醒**:S3.7 是用户域数据 enabler,当前按 Supabase+RLS 直连方案撰写,**可能因 SD-2 结论改判**(见主 spec §②)。

---

### S3.1 Graduation 转场(F0-F5)

**Scope**:实现从路线详情/chat 跳转进 Walk Mode 时的完整转场 storyboard("明显去某处"的 scene-cut 时刻)。

**设计依据**:`Graduation 转场 - Storyboard.html`(F0 前夜→F1 预备 0-120ms→F2 主移动 120-480ms→F3 落位 480-650ms→F4 完成 650-850ms→F5 边界规则);主 spec §8.4 已采纳。

**核心 AC**:
- 从路线详情"歩くモードへ"CTA 触发转场,按文档时长(约 850ms 总时长)播放并落地到 Walk Mode -> browser
- `prefers-reduced-motion` 开启时显示 F5 边界规则规定的瞬切,不强制播放全动画 -> browser
- 转场中途被打断(如返回键)不留下卡死的覆盖层 -> browser
- 转场不引入可被 Lighthouse 测出的 CLS 回归 -> browser

**变更文件**:`apps/web/src/components/transitions/GraduationTransition.tsx`、`apps/web/src/routes/routes/$routeId/walk.tsx`(入口接线)。

**依赖**:S2.3(Walk 入口#2 已占位)、S1.5(路线卡 Walk 入口预留位#1)。

---

### S3.2 Walk Mode 核心 shell

**Scope**:构建 Walk Mode 主屏骨架——进度格、当前站置顶放大卡(walk-hero,大字号站名+当前序号"3/7")、下一站行。

**设计依据**:`Walk 状态总览.html`(定稿 W-B′全出血);`Walk demo.html`。

**核心 AC**:
- 打开某路线的 Walk Mode 显示反映当前打卡数的进度格,以及当前站的 walk-hero 卡 -> browser
- 零打卡的路线正确显示第 1 站为 hero、进度格全空 -> browser
- 当前索引站数据缺失/损坏时降级为"情報を読み込めませんでした"卡片,不整屏崩溃 -> browser
- i18n:"いまここ N/M"与下一站文案按 ja/zh/en 渲染 -> unit

**变更文件**:`apps/web/src/routes/routes/$routeId/walk.tsx`、`apps/web/src/components/walk/ProgressDots.tsx`、`apps/web/src/components/walk/WalkHero.tsx`、`apps/web/src/components/walk/NextStopRow.tsx`。

**依赖**:S3.1。

---

### S3.3 Walk 操作(Maps 深链/打卡/近く sheet)+ 平台适配层

**Scope**:「🧭 Mapsで開く」深链(J12)、「✓ ここに来た!」打卡(vibrate+撤销 toast,J13)、「📍 近くにあと N スポット」sheet(J11)——全部经 X10 平台适配层(haptics/geo)。

**设计依据**:`user-journey.md` §6.5(四件套映射表);`Walk demo.html`(真打卡 vibrate+撤销)。

**核心 AC**:
- 点击「ここに来た!」触发 `platform.haptics.vibrate()`、进度前进、显示可撤销的 toast(几秒窗口)-> browser
- 「Mapsで開く」通过坐标深链打开系统地图 app -> browser
- 某站附近无其他作品点位时 sheet 显示空态文案,不是破损空列表 -> browser
- 撤销窗口内点击撤销正确回退打卡(进度-1、同步队列条目移除)-> integration
- 经由适配层(X10):打卡震动与"近く"用到的定位一律走 `platform.haptics`/`platform.geo`,不直接调 `navigator.*` -> unit

**Backend enabler**:读写打卡数据(见 S3.7)。

**变更文件**:`apps/web/src/components/walk/CheckInButton.tsx`、`apps/web/src/components/walk/MapsDeepLink.tsx`、`apps/web/src/components/walk/NearbySheet.tsx`、`apps/web/src/platform/haptics.ts`。

**依赖**:S3.2、S3.7。

---

### S3.4 構図をくらべる

**Scope**:机位对照子视图——动画帧半透明叠加 + 透明度滑杆对照实景,场景帧缺失复用 Iteration 1 的 D9 渐变占位模式。

**设计依据**:`user-journey.md` §6.5 J10;`Walk demo.html`(透明度滑杆)。

**核心 AC**:
- 从 walk-hero 卡打开「構図をくらべる」显示可用的透明度滑杆对照动画帧 -> browser
- 无参照帧的站显示 D9 渐变+话数文字兜底,不是空白叠加层 -> browser
- 相机权限被拒绝(若使用实时相机变体)降级为仅静态对照模式,不是死屏 -> browser
- 经由适配层(X10):相机访问一律走 `platform.camera` -> unit

**变更文件**:`apps/web/src/components/walk/CompositionCompare.tsx`。

**依赖**:S3.2。

---

### S3.5 环境态(強光/夜間/離線)

**Scope**:在 S3.2 的核心 shell 之上叠加户外强光(字号更大/对比更高/白底粗边)、夜间、离线三种环境视觉变体。

**设计依据**:`user-journey.md` §3.4 现场环境约束(J14);`Walk 状态总览.html` 3 环境态。

**核心 AC**:
- 切到户外强光模式时 walk-hero 站名字号与对比度按规格提升 -> browser
- 夜间模式应用规定的配色变化且不违反 ≥4.5:1 对比度要求 -> browser
- 无明确环境信号时渲染标准日间变体(默认态)-> browser
- 离线环境态(无网络)仍用缓存数据渲染完整 shell(与 S3.6 集成),不是网络错误屏 -> browser

**变更文件**:`apps/web/src/components/walk/EnvironmentVariants.tsx`、`apps/web/src/styles/walk-environment.css`。

**依赖**:S3.2、S3.6。

---

### S3.6 离线一步到位(SW + 缓存 + 打卡队列)

**Scope**:注册 service worker 缓存路线 bundle(JSON+帧图+每站静态地图 PNG,复用 X1 的 pmtiles range-request 基础设施);离线打卡队列(IndexedDB)通过 online/visibilitychange 在恢复联网时 flush;前瞻声明 SW 路由规则,排除未来的 SSR 路由。

**设计依据**:`user-journey.md` §3.4"弱网/离线"约束;G6"一步到位"裁决;X1(pmtiles range 复用)、X7(SW network-first 前瞻规则)。

**核心 AC**:
- 预缓存路线 bundle 后,飞行模式下打开 Walk Mode 仍渲染完整 shell 与全部站点数据 -> browser
- 离线打卡在本地排队,联网恢复后经真实网络调用 flush -> integration
- 从未预缓存过(从未在线访问过)的路线区段显示明确的"この区間はオフラインで見られません"提示,不是破损 shell -> browser
- flush 冲突(同一打卡已被另一设备同步)按幂等 upsert key 解决,不产生重复行 -> integration
- **X7 前瞻规则**:SW 的路由匹配规则表已包含 `/s/:id`、`/anime/:id`(即使这两条路由此刻尚未上线),标记为 network-first、排除出 Walk 离线缓存范围,由单测直接断言路由匹配表内容 -> browser

**Backend enabler**:复用 S3.7 的打卡表;新增客户端 IndexedDB schema(非后端资源)。

**变更文件**:`apps/web/src/sw.ts`、`apps/web/src/lib/walk/routeBundleCache.ts`、`apps/web/src/lib/walk/offlineCheckinQueue.ts`。

**依赖**:S3.2、S3.3、S0.4(pmtiles range 复用)。

---

### S3.7 打卡持久化后端 enabler

**Scope**:为打卡记录提供持久化存储与幂等同步支持。

**设计依据**:无视觉画布。

**数据访问路径标注**:用户域数据。**数据访问路径以 SD-2 结论为准,当前按 RLS 直连方案撰写**。

**Backend enabler(当前方案)**:新 Supabase 表 `walk_checkins`(`id`、`route_id` FK、`point_id` FK、`user_id`、`client_id UUID UNIQUE`〔离线幂等用〕、`checked_in_at TIMESTAMPTZ`、`synced_at TIMESTAMPTZ`);RLS 限定 owner 读写;`apps/web` 经 `supabase-js` 直连 `upsert`(`onConflict: client_id`),不新增 agent 端点;`packages/contract` 新增 `WalkCheckin` zod 行模式。

**核心 AC**:
- 经 supabase-js 插入一条打卡后,随后的读取立即可见 -> integration
- 零打卡的路线返回空数组,不是 null/崩溃 -> unit
- 重复提交同一个离线排队打卡(相同 `client_id`)在成功同步后是安全的空操作(upsert),不产生重复行 -> integration
- **标注**:数据访问路径以 SD-2 结论为准,当前按 RLS 直连方案撰写。

**变更文件**:`supabase/migrations/2026XXXXXXXXXX_walk_checkins.sql`、`packages/contract/src/user-data.ts`(新增 `WalkCheckin`)、`apps/web/src/lib/data/checkins.ts`。

**依赖**:无(本迭代内可独立先行,被 S3.3/S3.6 消费)。

---

### S3.8 Fox 8 帧小跑 sprite 素材(G8)

**Scope**:按锁定规格生成 8 帧(或 4 帧最小版)小跑循环雪碧图(512×512/帧,透明底,固定地面基线 y=430,不烘焙阴影),接入 CSS `steps()` 动画用于 Graduation/Splash 加载场景。

**设计依据**:`fox-walk-spec.md`(全文:8 帧步态表+一致性锁定+生成提示词模板);G8 裁决。

**核心 AC**:
- 生成的雪碧图符合一致性锁定规则(橙毛/奶白口鼻/青蓝围巾、纯侧视朝右、固定基线),与 `fox-trot.svg` 比例做视觉核对 -> browser
- 若只能做到 4 帧最小版,`steps(4)` 回退仍产生可读的小跑循环(不是卡顿感)-> browser
- 雪碧图加载失败(404)回退到既有单帧 `fox-trot.svg`,不是破图 -> browser
- **用户过目收编(G8 强制人工 AC)**:生成素材经用户过目确认后才视为完成 -> browser(人工核验)

**变更文件**:`docs/design/2026-07-06-design-sync/assets/fox/fox-walk-sheet.png`(或 8 张独立 PNG)、`apps/web/src/styles/fox-animation.css`、`apps/web/src/components/transitions/GraduationTransition.tsx`(接入,复用 S3.1)。

**依赖**:无(素材生产可并行);消费方 S3.1、S0.7。
