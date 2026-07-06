# Iteration 1 — 計画:Chat

详细度:**全量细化**。Story 数:11(超「3-8」guideline,原因:特别要求「匿名放开+配额+Turnstile+BYOK 各自独立 story」与 44 态全量细化叠加,见主 spec §③)。

依赖顺序建议:S1.1 → S1.2 → {S1.3, S1.4(依赖 S0.4), S1.5(依赖 S0.4)} → S1.6 → S1.7 → S1.8 → {S1.9, S1.10}(并行,都依赖 S1.8) → S1.11。

**协议纪律(重申)**:本迭代沿用现有 `/v1/chat`(Vercel AI SDK `VercelAIAdapter` 数据流协议,SSE 传输)与 `/v1/runtime`/`/v1/runtime/stream`(自定义 SSE,供 selected_point_ids 旁路等场景)。**Planner 核实**:`apps/agent/agent/interfaces/routes/chat.py` 现状确认 `/v1/chat` 已是 Vercel AI SDK 协议(非"待重新定案"),历史上确有 revert 记录(`spec-chat-page-design.md` §8 提及 commit `79f34a8`),但当前主干状态是"已采用"。**本迭代任何 story 一律不得顺手更换流式协议**,新增能力(BYOK header、匿名标记等)必须在现有协议基础上叠加,不得引入第二套流式格式。

**SD interview 终局结论对本迭代的影响(见主 spec §②)**:
- **SD-3①**(数据面):`apps/agent/agent/agents/selected_route.py` 的跨库混读 bug(选点旁路读 Supabase、同会话搜索已读 Neon)在本迭代作为 enabler 修复,归入 S1.7,修 bug 性质,不是新功能。
- **SD-4**:容器化 Python + 保温策略终局定案,X2 首 token SLO 是**硬性**门禁(S1.2),不是软目标。
- **SD-5**(会话状态):本迭代 chat 前端**沿用现状端点**(`GET/PATCH /v1/conversations`、`GET /v1/conversations/{id}/messages`,Supabase `sessions.state` JSONB + `conversation_messages` best-effort 写),**不在本迭代重构会话持久化**——该数据后续随 SD-3④ 迁移到 Neon(Iteration 2-3 独立 story,S2.9/S3.9)。"best-effort 持久化、无事务保证"是已知且接受的过渡期风险,记入主 spec §⑨,不是本迭代要修的 bug。

---

### S1.1 Chat shell 与页面级入口态(A1/A2/A2b/A3/A5)

**用户故事**:作为首次或回访用户,我要 chat 页根据我进入的方式(空白/带查询/引用路线/历史会话/后端不可达)渲染对应初始画面,以便入口体验始终是"为我定制"而非泛用。

**设计依据**:`spec-chat-page-states.md` §A(A1/A2/A2b/A3/A5);`Chat 状态总览.html` A 组帧。

**Releasable 陈述**:`/chat` 能根据入口信号(无参数/`?q=`/引用路线参数/既有会话/健康检查失败)正确渲染 5 种入口态之一。

**AC**:
- A1 冷启动渲染狐狸问候气泡 + 3 枚示例 nook tile chips + input 自动聚焦 -> browser
- A2 带 `?q=` 进入立即渲染乐观用户气泡并直接进入 B2,不重复打字 -> browser
- 空:A2b 引用的路线已被删除时优雅降级为 A1 冷启动(不是破损的引用卡)-> browser
- 错误:A5 后端不可达显示顶部 error banner + 重试,input 禁用;重试成功恢复到 A1 -> browser
- 多轮:A3 历史恢复渲染全量历史消息(经既有 `GET /v1/conversations/{id}/messages`,SD-5 沿用现状端点)、旧管线折叠为足迹行、滚动锚定到底部 -> integration
- i18n:A1 问候气泡与 3 枚示例 chips 按 locale 渲染 ja/zh/en -> unit

**变更文件**:`apps/web/src/routes/chat/index.tsx`、`apps/web/src/components/chat/registry.ts`(generative UI registry 骨架)、`apps/web/src/components/chat/EntryStates/*`、`apps/web/src/lib/chat/session.ts`。

**依赖**:S0.5、S0.6。

---

### S1.2 回合等待仪式 + 结算足迹(B0-B4)+ 首 token 硬性 SLO(SD-4)

**用户故事**:作为用户,我要发送消息后的等待体验随时长渐进升级、感觉"活着",而不是干等;同时我要真实响应速度足够快,让仪式感是锦上添花而不是掩盖真实延迟。

**设计依据**:`spec-chat-page-states.md` §B(B0-B4);`user-journey.md` §3.3"一个回合的情绪曲线";`DS 补全 - Chat 桌面.html` shimmer/徽章 token。

**Releasable 陈述**:发送消息后 <1s 只显示狐狸 typing,1-4s 升级为管线+足迹(带数据源徽章),≥4s 追加情绪卡,流式阶段打字机+卡片落位,结算态折叠为足迹行+追问 chips;生产环境 warm p95 首 token 延迟 ≤3s——**此 SLO 经 SD-4 终局定案升级为硬性发布门禁**(容器化 Python 架构不再重议,保温机制是履约这个 SLO 的手段,不是可选优化)。

**Backend enabler**:容器保温机制(最小实例数配置或定时 keep-alive ping,机制留 execution-time 定,见 X2);`wrangler.toml` `[[containers]]` 或新增 Cron Trigger 路由。

**AC**:
- B2a <1s 只显示狐狸 typing 指示,不出管线 -> browser
- B2b 1-4s 管线步骤逐个点亮 + Bangumi/Anitabi 数据源徽章 + 狐狸第一人称副标题 -> browser
- 空:纯文字回合(问候/答疑)永不出 skeleton/管线,B2a 直达 B4 -> browser
- 错误:B2c 情绪卡在无该作台词数据时优雅跳过(不显示卡片),回退为管线继续,不报错 -> unit
- **硬性性能门禁(SD-4)**:warm p95 首 token 延迟 ≤3s(对预热容器重复调用 `/v1/chat` 测量,不达标即 story 不可合并)-> api
- 多轮:B4 结算态把管线折叠为一行带用时的足迹(可展开),追问 chips 出现 -> integration

**变更文件**:`apps/web/src/components/chat/WaitingRitual/*`、`apps/web/src/components/chat/FootprintRow.tsx`、`apps/web/src/components/chat/MoodCard.tsx`、`wrangler.toml`(保温配置)、`worker/app.ts`(如需 cron ping 路由)。

**依赖**:S1.1。

---

### S1.3 澄清与位置内容形态(C1/C2/C2g/C4)+ C2t + 平台适配层(geo)

**用户故事**:作为提问模糊或信息不全的用户,我要 chat 提出精确的澄清问题(标题歧义/地理圈/缺失出发信息),而不是瞎猜;想用位置搜索时,我要一个走平台适配层的正规权限提示。

**设计依据**:`spec-chat-page-states.md` §C1/C2/C2g/C4;`Chat 状态总览.html` C2t 帧(已采纳,见主 spec §8.3);`journey-走查.md` Q1/Q5。

**Releasable 陈述**:澄清气泡(标题歧义/地理圈/缺失出发信息 C2t)与位置权限提示全部渲染并正确分支;写真検索在未完整实现识别能力时优雅降级为文字道歉,不阻塞主线。

**AC**:
- C2 澄清渲染 2-4 个候选按钮 + 逃生口("都不是,我重新说");选中后变为用户气泡,其余候选淡出 -> browser
- C2t 在出发地+时间都缺失时触发,提供 chips(駅から+时间/現在地/手动输入/おまかせ);两者都已说明则跳过此回合 -> browser
- 空:C4 位置权限拒绝后回退到手动文字输入,不是死路 -> browser
- 错误:写真検索(写真から探す)意图在无可用识别后端时降级为 D1 道歉文案+示例 chips,绝不卡死或空白卡片 -> browser
- 经由适配层(X10):C4"位置情報を許可"按钮调用 `platform.geo.requestPermission()`,不直接调 `navigator.geolocation`(单测 mock 平台层断言)-> unit
- i18n:所有澄清选项文案与 C2t chips 按 ja/zh/en 渲染 -> unit

**变更文件**:`apps/web/src/components/chat/Clarify/*`、`apps/web/src/components/chat/LocationPrompt.tsx`、`apps/web/src/platform/geo.ts`、`apps/web/src/components/chat/registry.ts`。

**依赖**:S1.1、S1.2。

---

### S1.4 搜索内容形态 + 静态地图(C3a/C3b)

**用户故事**:作为搜索某作品圣地的用户,我要单圈结果看到 top-6 点位卡+地图,多圈结果看到全国圈泡总览,以便不被成百上千个 pin 淹没。

**设计依据**:`spec-chat-page-states.md` §C3a/C3b;`spec-chat-page-design.md` §4/§4.1(体量实测;地图按 X1 读作 MapLibre);`user-journey.md` §4"圈总览卡"。

**Releasable 陈述**:单圈搜索渲染点位卡组 + 静态 MapLibre 地图;多圈搜索渲染全国圈泡地图 + 圈卡组,选圈下钻进 C3a。

**AC**:
- C3a 渲染按人气/有图排序的 top-6 点位卡(截图封面+话数 tag+勾选框)+ ≤50 pin 的静态地图 -> browser
- C3b(≥2 圈或 >50km 包络)只渲染圈泡(面积∝件数,白字数量徽章),该缩放级别绝不画独立 pin -> browser
- 空:搜索结果视野内 0 点位渲染 D2"0 聖地"态(见 S1.6),不是静默空地图 -> browser
- 错误:MapLibre 静态瓦片加载失败降级为自绘 SVG 占位(D7 态)+「地図アプリで開く」外链 -> browser
- i18n:圈名与数量徽章在 ja/zh/en 下地名正确渲染 -> unit

**变更文件**:`apps/web/src/components/chat/SpotCardGrid.tsx`、`apps/web/src/components/chat/CircleOverviewMap.tsx`、`apps/web/src/components/map/StaticMap.tsx`(MapLibre 封装)、`apps/web/src/components/chat/registry.ts`。

**依赖**:S0.4(地图 spike)、S1.1。

---

### S1.5 路线卡(TimedItinerary)+ plan_route + 地图升格 + Walk 入口预留位

**用户故事**:作为已选好点位的用户,我要一张带真实 HH:MM 时刻、散步段独立可见的海报级路线卡,以及升格显示轨迹的地图,以便拿到真正能照着执行的东西("13:00 出发能买车票")。

**设计依据**:`user-journey.md` §6.6(TimedItinerary 完整解剖);`spec-chat-page-design.md` §3;`spec-chat-page-states.md` §C5。

**Releasable 陈述**:`plan_route` 回合渲染完整 TimedItinerary 卡(眉标/卡名/pacing pill/HH:MM 时间轴/walk 胶囊/场景缩略/CTA 行),地图升格为轨迹模式(编号 pin/暖棕虚线路径/金色路线 pill);预留「歩くモード」CTA 位(Iteration 3 接线)。

**AC**:
- 路线卡渲染站粒度 HH:MM 时间轴,至少一个金★高光站与一个可见 walk 胶囊 -> browser
- 地图在路线生成后升格:轨迹绘制、pin 按步行序重编号、非路线点降透明、金色路线 pill 出现在角落 -> browser
- 空:点位 <3 的路线仍渲染(D3 态,见 S1.6)并附 AI 说明,不是半张破损卡 -> browser
- 错误:场景缩略图 404 降级为渐变占位+话数文字(D9),绝不出现破图图标 -> browser
- i18n:pacing pill 文案(ゆったり/適中/緊張)与 CTA 行按钮文案按 locale 正确渲染 -> unit
- 多轮:通过追问 chip 重新生成路线按 E1 规则替换卡片(旧卡 opacity .55+「以前の版」角标,新卡追加在底部)-> integration

**变更文件**:`apps/web/src/components/chat/TimedItinerary.tsx`、`apps/web/src/components/map/RouteTrailMap.tsx`、`apps/web/src/components/chat/registry.ts`。

**依赖**:S0.4、S1.1、S1.4。

---

### S1.6 异常与边界全兜底(D1-D9)

**用户故事**:作为遇到任何失败模式(识别失败/0 圣地/流中断/超时/校验拒绝/地图失败/session 过期/场景图缺失)的用户,我要一个有人格的兜底而不是裸错误,以便产品永远不显得"坏了"。

**设计依据**:`spec-chat-page-states.md` §D(D1-D9 全表);`user-journey.md` §6.8(文案基准)。

**Releasable 陈述**:9 个已定义异常态全部渲染其规定的兜底 UI 与文案;没有一个会显示裸堆栈/HTTP 状态码/空白屏。

**AC**:
- 快乐路径(即"正确渲染兜底"):模拟触发条件后 D1-D9 各自渲染规定兜底元素(识别失败道歉+chips、0 圣地文案+相邻推荐、<3 点路线+chips、流中断 inline 重试且已渲染内容保留、60s 超时同形态重试、校验拒绝通用道歉、地图失败 SVG 兜底、session 过期 inline banner 保留对话、场景 404 渐变占位)-> browser
- 空:D4 流中断发生在第一个 chunk 之前(尚无内容渲染)仍显示重试入口,不是卡死的 spinner -> browser
- 错误:D6 校验拒绝的展示文案绝不泄漏底层 ModelRetry/output_validator 技术细节(断言文案不含这些字符串)-> unit
- 多轮:D4/D8(流中断/session 过期)恢复后均保留此前对话内容,无消息丢失 -> integration
- i18n:全部 9 条兜底文案存在 ja/zh/en 三语,ja 用户不会看到英文兜底泄漏 -> unit

**变更文件**:`apps/web/src/components/chat/ErrorStates/*`、`apps/web/src/lib/chat/errorClassifier.ts`、`apps/web/src/i18n/dictionaries/*`(错误文案)。

**依赖**:S1.1、S1.2。

---

### S1.7 活文档 E1/E2 + 保存→P5 登录墙触发 + selected_route 跨库 bug 修复(SD-3①)

**用户故事**:作为通过追问或勾选细化路线的用户,我要旧版本可见地"变旧"而不是被静默改写;按下「保存する」时,我要恰好在那一刻才被要求登录,不提前打断;并且不管我是通过对话生成路线还是勾选点位重排,拿到的点位数据必须一致可靠(不能因为两条路径读了两个不同步的数据库而出现差异)。

**设计依据**:`spec-chat-page-states.md` §E1/E2;`user-journey.md` §3.3"登录墙(J7,P5 裁决)"。

**Releasable 陈述**:追问细化追加新版本路线卡(旧卡降为「以前の版」);勾选重排完全旁路 agent(`selected_point_ids`,仅显示「再計算 1.2s」);按「保存する」才打开 magic-link modal,匿名成果登录后自动认领;`selected_point_ids` 旁路读取的点位数据与对话搜索路径来自同一数据源(Neon),消除跨库不同步。

**Backend enabler(SD-3① bug 修复,修 bug 性质非新功能)**:`apps/agent/agent/agents/selected_route.py` 的 `execute_selected_route()` 当前要求 `db` 是 `SupabaseClient` 实例并调用 `db.points.get_points_by_ids(point_ids)` 读 Supabase;同一会话的搜索路径(`search_bangumi`/`search_nearby`)已经改经 `CatalogClient` 读 Neon。本 story 把 `execute_selected_route()` 改为经 `CatalogClient` 读 Neon,与搜索路径统一,消除两库自 06-23 fork 后的不同步。

**AC**:
- E1 追问细化追加新卡,旧卡 opacity .55+「以前の版」角标,不原地改写历史 -> browser
- E2 点位卡勾选变化后浮出 sticky「N 件選択中・ルートを組み直す」条,重排只显示时间轴 skeleton + 「再計算 1.2s」足迹(无管线戏)-> browser
- 空:尚无生成路线(无可保存内容)时保存 CTA 禁用,不打开空保存流程 -> unit
- 错误:E2 重排失败(如后端抖动)在托盘上显示 inline 重试,不是整页报错 -> browser
- 多轮:多轮追问后向上滚动仍能看到全部按序排列的历史「以前の版」卡(活文档,不删除任何东西)-> integration
- **回归(SD-3① bug 修复)**:`execute_selected_route()` 改经 `CatalogClient`/Neon 后,对同一组 `point_ids` 返回的点位数据形状与修复前(Supabase 路径)完全一致(字段级快照对比测试),且与同会话内 `search_bangumi` 返回的同一批点位数据一致(不再有跨库差异)-> integration

**登录墙触发**(P5,不弹在别处):按「保存する」→ 打开 magic-link modal(复用 S0.6 的 `LoginModal`);登录成功后匿名 session 路线的账号认领逻辑在 S2.8 实现,本 story 只负责触发时机,不重复造登录 UI。

**变更文件**:`apps/web/src/components/chat/LivingDocument/*`、`apps/web/src/components/chat/SelectionTray.tsx`、`apps/web/src/lib/chat/selectedPointsBypass.ts`、`apps/agent/agent/agents/selected_route.py`(改经 CatalogClient)、`apps/agent/agent/tests/unit/test_selected_route.py`(回归快照)。

**依赖**:S1.4、S1.5。

---

### S1.8 匿名放开 + edge 限流 + 全局日预算熔断(X4)+ 认证模型变更(X5)

**用户故事**:作为匿名访客,我要能完整用 chat(搜索/规划/细化)而不用登录,且这个开放面受限流保护;我要知道如果全局每日成本失控,产品会体面地退回登录墙,而不是无限制烧钱或悄悄挂掉。

**设计依据**:`user-journey.md` §3.3 登录墙段(免登录范围);inputs G7/X4/X5。

**Releasable 陈述**:任何匿名访客能完成一次完整 chat 规划往返而不被要求登录(直到按「保存する」);edge Worker 对匿名身份做请求限流;全局日成本(env 配置)超限时,新的匿名 chat 请求被拒绝并引导登录,而不是静默失败。

**Backend enabler**:`worker/app.ts` 的 `/v1/*` 门禁从"必须鉴权否则 401"改为"能力面端点鉴权可选;匿名请求带 `X-User-Type: anonymous` + 匿名 id 通过,受限流约束";新增 Worker KV(或 Durable Object)计数器追踪全局日成本,超过 `ANON_DAILY_COST_BUDGET_USD`(X4)时拒绝匿名访问。**数据归属提示**:本 story 的限流/配额状态存储属于 edge 基础设施(Worker KV/DO),不是 SD-2 的"用户域数据"(那部分归 `workers/users`+Neon),两者不冲突。

**AC**:
- 匿名浏览器(无 Supabase session)能发送 chat 消息并收到完整 `plan_route` 响应,全程无登录提示 -> integration
- 空:全新匿名 session(零历史活动)依然被允许(无最低历史门槛)-> unit
- 错误:超过单身份限流返回友好的"少し待ってね"提示,不是无文案的裸 429 -> browser
- 熔断(X4):模拟全局日成本达到/超过 `ANON_DAILY_COST_BUDGET_USD` 时,新匿名 `/v1/chat` 请求被拒绝并引导登录,已登录用户不受影响 -> unit/api
- 测试覆盖(SD-6):`worker/app.ts` 新增的匿名信任标记逻辑有与既有 `authenticate`/`forwardV1` 测试(现有 16 用例基线,S0.3 已接入 CI)同等覆盖水平的单测,不得开测试倒退口子 -> unit
- 文档一致性:S0.9 中 X5 的前瞻声明在本 story 落地后回填为既成状态描述 -> unit

**变更文件**:`worker/app.ts`(门禁逻辑变更)、`worker/rateLimiter.ts`(新增)、`worker/costBreaker.ts`(新增,X4)、`worker/app.test.ts`(扩充)、`docs/ARCHITECTURE.md`(X5 回填)。

**依赖**:S1.1;S0.3(worker CI 接线须先落地,SD-6)。

---

### S1.9 Cloudflare Turnstile

**用户故事**:作为站点运营者,我要匿名 chat 请求在到达容器前先过一道 Cloudflare Turnstile 验证,以便新开放的匿名面不被滥用。

**设计依据**:无视觉画布;G7 配套机制。

**Releasable 陈述**:匿名用户首条消息前完成一次低摩擦 Turnstile 验证;edge Worker 服务端校验 token 有效性后才转发到容器。

**AC**:
- 完成正常 Turnstile 验证的匿名用户消息能正常送达 agent -> integration
- 空:同一短期有效 token 窗口内的匿名用户不会每条消息都被重新挑战 -> unit
- 错误:无效/过期 token 被 edge Worker 拒绝并给出可重试提示,不转发到容器 -> integration
- i18n:Turnstile 相关重试/错误文案按 ja/zh/en 渲染 -> unit

**变更文件**:`worker/turnstile.ts`(新增,siteverify 调用)、`worker/app.ts`(接入)、`apps/web/src/components/chat/TurnstileGate.tsx`。

**依赖**:S1.8。

---

### S1.10 匿名配额

**用户故事**:作为匿名用户,我要一个合理的每日免费消息配额,并在用完时看到清晰友好的提示(而不是死路),这样产品才可持续。

**设计依据**:无视觉画布;G7 配套机制;`spec-chat-page-states.md` §A5 错误 banner 视觉语言可复用。

**Releasable 陈述**:每个匿名身份获得可配置的每日消息配额;用完后显示 inline banner 解释限制并提供登录入口(不是死路封锁)。

**AC**:
- 配额内的匿名身份正常发送消息,不显示任何配额 UI -> integration
- 空:全新匿名身份从满额度开始,不是零 -> unit
- 错误:超出配额禁用发送键并显示"今日はここまで・ログインすると続けられるよ"(或等效)文案+登录 CTA,已输入文字保留不丢失 -> browser
- i18n:配额提示文案按 ja/zh/en 渲染 -> unit

**变更文件**:`worker/quota.ts`(新增,Worker KV 按匿名 id+日期计数)、`worker/app.ts`(接入)、`apps/web/src/components/chat/QuotaBanner.tsx`。

**依赖**:S1.8。

---

### S1.11 BYOK(自带 LLM key)

**用户故事**:作为高级用户,我要能带自己的 LLM API key 使用产品(不受免费配额限制),并确信这把 key 除了作为请求头透传外绝不离开我的浏览器,也绝不出现在任何日志里。

**设计依据**:无视觉画布;inputs G7("key 仅存客户端 localStorage、请求头透传、服务端不落盘、设置 UI 归属 chat 输入区 G 组")+ X3。

**Releasable 陈述**:chat 输入区(G 组)提供设置入口,用户粘贴自己的 LLM key,仅存 `localStorage`;后续 chat 请求以请求头透传,容器优先使用该 key 而非服务端配置的默认 key;该 key 绝不落服务端盘,也不出现在任何日志/trace。

**AC**:
- 在设置面板输入有效 BYOK key 后,后续 `/v1/chat` 请求携带该 key 作为请求头,agent 用它而非 `DEEPSEEK_API_KEY` 发起 LLM 调用 -> integration
- 空:未设置 BYOK key 时回退到服务端默认模型,行为不变 -> unit
- 错误:无效/被拒绝的 BYOK key 在设置面板显示明确的 inline 错误(不是泛化的 chat 失败),且不会静默回退到服务端 key 而不告知用户 -> browser
- **硬 AC(X3)**:携带 BYOK key 的请求,其 key 值在代码库可达的**每一个**观测面(Logfire span、structlog 日志行、任何请求日志中间件)被捕获前均已剥除——用一个携带已知假 key 的请求发起 integration test,断言该原始字符串不出现在任何被捕获的日志/span/trace 输出中 -> integration
- 经由适配层(X10):设置 UI 通过一层薄存储封装持久化 key(不是散落的直接 `localStorage.setItem` 调用),单测断言 -> unit
- i18n:BYOK 设置面板文案按 ja/zh/en 渲染 -> unit

**变更文件**:`apps/web/src/components/chat/InputDock/ByokSettings.tsx`、`apps/web/src/lib/byokStorage.ts`、`apps/agent/agent/interfaces/routes/chat.py`(接受可选 key header,不落盘)、`apps/agent/agent/interfaces/routes/_middleware.py`(redaction)、`apps/agent/agent/tests/integration/test_byok_redaction.py`。

**依赖**:S1.1。
