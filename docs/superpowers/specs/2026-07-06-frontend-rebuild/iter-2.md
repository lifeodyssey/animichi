# Iteration 2 — 承接:详情+列表

详细度:**全量细化**。Story 数:**9**(超「3-8」guideline;原 8 个产品 story + SD-3④ 新增的 S2.9 sessions 数据迁移,见主 spec §③)。

依赖顺序建议:S2.8(`workers/users` 首次搭建,建议优先)→ S2.1 → {S2.2, S2.3} → {S2.4, S2.5, S2.6} → S2.7。S2.9(sessions 迁移)可与产品 story 并行,由 Coordinator 视人力排期。

**SD interview 终局结论对本迭代的影响(见主 spec §②)**:
- **SD-2(终局,非讨论中)**:用户域数据(路线保存/列表)访问路径是 **API-first**——新建 `workers/users` TS 服务的 oRPC 路由 `/v1/users/*`,数据落 **Neon**,契约进 `packages/contract`;`apps/web` 的 `supabase-js` 仅用于 auth(取 JWT),**不**直连任何数据表,不用 RLS。此前 rev 1-4 版本"当前按 RLS 直连方案撰写"的暂定框架已作废,本文件从一开始就按 SD-2 终局撰写。
- **SD-3②④**:新用户域表建在 Neon(非 Supabase);既有 `sessions` 表数据迁移到 Neon 是本迭代的独立 story(S2.9)。
- **`workers/users` 是全新服务**,没有 `workers/catalog` 那样的既有骨架可蹭——S2.8 需要完整参照 `workers/catalog` 的 oRPC+Drizzle+CI+部署模式搭建,不要发明新模式(见主 spec §⑨ 风险登记)。
- **SEO/GEO 内容归属核证(回填自 SD-27,`2026-07-06-seo-geo-plan.md` §7 迭代映射表)——冲突已标注,未强行裁决**:该落地包的"迭代映射"表把"作品页 TVSeries/Movie JSON-LD + 事实速览块v1 + ImageObject/license + hreflang 起步"标在"2 详情+列表"行下。但本迭代实际交付页面是 `/routes/:id`(路线详情)与 `/routes`(マイルート列表)——两者都是用户私有页,不在 SD-27 A 的页面矩阵内(不 SSR、不进 sitemap、无 hreflang 意义),`/anime/:id` 作品页要到迭代 5 才建。据此判断该表格行归属很可能笔误(应对应"5 発見+首页",/anime/:id 在此交付且 SD-27 明言 programmatic SEO 主战场在迭代 5)。**处理**:相应 SEO story 内容已改落进 `iter-5.md`(S5.1/S5.6),本文件不新增 SEO story;**此判断供 Coordinator/用户复核,未经确认前不视为终局**。

---

### S2.1 路线详情 shell + 数据点亮态

**用户故事**:作为在不同时刻查看自己路线详情页的用户,我要同一张页面根据数据点亮不同元素(当天=金条、完走=徽章),而不是在三个模式间切换,这样它才像一份活文档而不是三个拼凑的画面。

**设计依据**:`spec-route-detail.md` §1"概念(推翻三时态)";`路线详情 状态总览.html`。

**Releasable 陈述**:`/routes/:id` 渲染 appbar→hero→地图卡→时刻表→sticky dock;平日态 chrome 最少,当天态在 appbar 下出现金条「きょうは巡礼日!→歩くモードへ」且地图自动展開,完走态出现 hero 完走徽章(完走 5/5 ✓)+ 全行✓ + 対比図段自现。

**AC**:
- 快乐路径:日期为今天的路线在 appbar 下渲染金条,地图自动展開 -> browser
- 快乐路径:完全完走的路线渲染 hero 完走徽章,每行时刻表显示✓ -> browser
- 空:平日态(非当天、非完走、部分历史打卡)不显示金条,且保留部分历史✓(活文档不改写历史)-> browser
- 错误:优先级规则(完走>当天>平日)在路线"既是当天又已完走"时被正确执行(显示完走态,不是两个 banner 同显)-> unit
- i18n:金条文案与完走徽章文案按 ja/zh/en 渲染 -> unit
- 生成式组件契约(回填自 SD-13):`GoldBar` 属产品专属生成式组件(inputs §三 A4 目录),若被 Chat generative UI registry 复用,payload 须含 `schema_version` 字段(additive-only 演进,禁破坏性变更)且组件本身 partial-tolerant(缺字段时渲染既定 skeleton slot,不崩溃);Storybook 需建"字段残缺态"+ "旧版 payload 态"两类 story -> unit

**变更文件**:`apps/web/src/routes/routes/$routeId.tsx`、`apps/web/src/components/route-detail/Hero.tsx`、`apps/web/src/components/route-detail/GoldBar.tsx`、`apps/web/src/lib/route-detail/dataState.ts`。

**依赖**:S1.5(路线数据形状);S2.8 的 oRPC 契约(可并行开发,集成时对齐)。

---

### S2.2 MODE 切换(FLIP)+ 地图 pin 语言 + 金色路线 pill

**用户故事**:作为用户,我要能随时在紧凑"静息"视图与展開地图视图之间切换,pin 要清楚标示已访问/当前/未访问状态,以便我既能快速浏览也能深入导航。

**设计依据**:`spec-route-detail.md` §2 MODE、§5 地图(図釘即画面)。

**Releasable 陈述**:点击/拖拽在 静息⇄地図展開 间以 360ms FLIP 切换;地图 pin 渲染为 48px 帧图钉(済✓teal 徽章/現在 58px 金环★/未访白底序号);金色路线 pill 显示进度 N/5。

**AC**:
- 快乐路径:切到地図展開后地图在 360ms 内展開吃满、时刻表收为 352px sheet -> browser
- 快乐路径:pin 状态按规定视觉语言正确渲染已访问/当前/未访问 -> browser
- 空:尚无打卡记录的路线全部 pin 显示为未访问白底序号,空进度不崩溃 -> browser
- 错误:快速连续切换(双击)不产生半过渡的破损状态(防抖/守卫)-> browser
- 多轮:打卡事件发生后 MODE 状态(展開/静息)正确保持,不意外重置 -> integration
- 生成式组件契约(回填自 SD-13):`MapCard` 属产品专属生成式组件(inputs §三 A4 目录),若被 Chat generative UI registry 复用,payload 须含 `schema_version`(additive-only 演进)且组件 partial-tolerant(点位/pin 数据缺字段时渲染 skeleton slot 而非崩溃);Storybook 需建"字段残缺态"+ "旧版 payload 态"story -> unit

**变更文件**:`apps/web/src/components/route-detail/MapCard.tsx`、`apps/web/src/components/route-detail/ModeToggle.tsx`、`apps/web/src/components/map/RoutePinLayer.tsx`。

**依赖**:S0.4、S2.1。

---

### S2.3 金 CTA 逻辑 + sticky dock + Walk 入口 #2

**用户故事**:作为用户,我要页面唯一的金色 CTA 始终说对当下该说的话(平日分享/当天去走/完走后做纪念しおり),并且这里要有一个真正可用的「歩くモードで出発」入口(Q4 要求的三处入口之一)。

**设计依据**:`spec-route-detail.md` §3 金 CTA。

**Releasable 陈述**:金 CTA 文案/动作按数据态切换(平日＝しおりを共有 / 当天＝歩くモードへ / 完走＝記念しおりを作る);編集する(cream 次级)CTA 跳转到 Chat A2b 引用编辑;sticky dock 渐变承接正确。

**AC**:
- 快乐路径:当天路线的金 CTA 显示"歩くモードへ",点击导向 Walk 目标路由(本迭代验证导航意图/路由目标存在,Walk 真实屏幕在 Iteration 3 交付,此处占位可接受)-> browser
- 快乐路径:完走路线的金 CTA 显示"記念しおりを作る"(深链到 Iteration 4 的しおり流程入口,本迭代占位可接受)-> browser
- 空:編集する(cream 次级)在路线无 chat 来源可引用回去时优雅禁用 -> unit
- 错误:CTA 按压过程中数据态发生变化(如打卡恰好完走)不会让 CTA 停留在过时/错误文案 -> browser
- i18n:三种 CTA 文案变体按 ja/zh/en 渲染 -> unit

**变更文件**:`apps/web/src/components/route-detail/StickyDock.tsx`、`apps/web/src/components/route-detail/GoldCta.tsx`。

**依赖**:S2.1。

---

### S2.4 規模态(手风琴/多日/機位 sheet)+ spec-route-detail 默认项确认

**用户故事**:作为路线站数多(≥7)、跨多日、或某站候选照片多的用户,我要时刻表自动组织(按时间段手风琴/按日分段/機位 sheet),而不是变成读不懂的长墙。

**设计依据**:`spec-route-detail.md` §7 規模态(G4);主 spec §8.1 两项默认(段头徒歩合计=显示,★目标接 Walk=本迭代不接)。

**Releasable 陈述**:≥7 站单日路线按时间段(午前/午後/夕方)手风琴,段头显示"件数+徒歩合计+跨度";多日路线按 day 分段(过去收起✓/今日展开+金条/未来收起 op.75);一点多图的行显示"Nカット▸"打开機位ブラウザ sheet。

**AC**:
- 快乐路径:9 站单日路线渲染午前/午後/夕方手风琴,每个段头显示件数+徒歩合计+跨度 -> browser
- 快乐路径:多日路线只展开今日段(带金条),过去/未来段正确收起 -> browser
- 空:恰好 1 站的路线完全跳过手风琴/日分段(不渲染空手风琴壳)-> unit
- 错误:某站候选照片为 0 时不渲染破损的"Nカット▸"入口(只显示普通代表帧)-> browser
- **确认默认(§8.1)**:段头显示徒歩合计,★目标不接 Walk(详情页★仅页内生效)-> unit

**变更文件**:`apps/web/src/components/route-detail/TimeOfDayAccordion.tsx`、`apps/web/src/components/route-detail/DaySegments.tsx`、`apps/web/src/components/route-detail/SpotPhotoSheet.tsx`。

**依赖**:S2.1、S2.2。

---

### S2.5 桌面 R-DESK 布局 + 剪贴板/分享适配层(X10)

**用户故事**:作为在大屏桌面规划的用户,我要一个三栏布局(hero+时刻表 / 大地图 / QR+精选 rail),并且跨设备交接的 QR/复制链接要经过平台适配层。

**设计依据**:`spec-route-detail.md` §6 桌面 R-DESK 1440。

**Releasable 陈述**:≥1440px 视口渲染三栏 R-DESK 布局(430 hero+帧缩略时刻表 | 中央大地图 | 270 rail 含 QR 交接+名場面×3+N→機位ブラウザ+CC BY-NC-SA 出典);QR/复制链接交接经平台 clipboard 适配层。

**AC**:
- 快乐路径:≥1440px 视口渲染正确比例的三栏 grid,QR 码链接到移动端路线 URL -> browser
- 快乐路径:点击"リンクをコピー"经 `platform.clipboard.copy()` 复制路线 URL,不是直接调 `navigator.clipboard` -> unit
- 空:<1440px 视口回退到移动端单栏布局,不产生破损的半三栏渲染 -> browser
- 错误:剪贴板写入失败(权限拒绝)显示"长按复制"兜底提示,不是静默无反应 -> browser
- 经由适配层(X10):单测断言组件内的复制逻辑只调用 `platform.clipboard.copy()`,不存在任何直接 `import`/调用 `navigator.clipboard` 的代码路径(与上一条快乐路径 AC 是同一实现,但本条从"代码结构"角度断言,而非从"行为结果"角度)-> unit

**变更文件**:`apps/web/src/components/route-detail/RDeskLayout.tsx`、`apps/web/src/platform/clipboard.ts`、`apps/web/src/components/route-detail/QrHandoff.tsx`。

**依赖**:S2.1、S2.2。

---

### S2.6 記念·対比図段入口

**用户故事**:作为用户,我要在路线详情页看到"記念·対比図"段,要么展示我已生成的对比图,要么给出清晰的「+対比図を作る」入口深链到对比图流程。

**设计依据**:`spec-route-detail.md` §8 記念・対比図段。

**Releasable 陈述**:空対比図段显示 dashed「+対比図を作る」卡片,深链带正确参数(`?url=帧h360&pid&bid&g`)指向 Iteration 4 的対比図作成流程(该流程本身在 Iteration 4 交付,本迭代只接线入口与空态渲染)。

**AC**:
- 快乐路径:已生成对比图的路线渲染 pair grid(动画帧×实拍)-> browser
- 空:0 张对比图的路线渲染 dashed「+対比図を作る」占位卡,深链参数正确 -> browser
- 错误:本迭代深链目标路由尚不存在(対比図作成在 Iteration 4 才交付)——点击不得 404,应导向体面的"近日公开"占位而不是导航中断 -> browser
- i18n:段头"対比図 N/5・機位ブラウザ↗"按 locale 正确渲染 -> unit

**变更文件**:`apps/web/src/components/route-detail/ComparisonSection.tsx`。

**依赖**:S2.1。

---

### S2.7 マイルート本棚(A 变体)+ 桌面 MY-DESK

**用户故事**:作为有多条计划中/历史路线的用户,我要一个书架式列表(明确规则:只有一条路线能是"今日金件"),包括零路线时的空态。

**设计依据**:`マイルート 状态总览.html`(A 本棚,已定稿;B 予定表留档)、`マイルート demo.html`。

**Releasable 陈述**:`/routes` 以书架卡列出用户已保存路线;若有当天路线,恰好一条显示金框"きょう"处理(结构性强制,不只是视觉巧合);零路线显示规定空态;桌面显示 MY-DESK 布局变体。

**AC**:
- 快乐路径:有 3 条已保存路线(一条为今天)的用户看到该条金框、其余为普通卡 -> browser
- 空:零已保存路线的用户看到规定空态(不是空白列表)-> browser
- 错误:若数据异常导致两条路线都标记"今天",UI 强制"金件唯一"规则(取最近更新的一条金框,另一条按普通卡处理,不渲染两张金卡)-> unit
- i18n:空态文案与卡片标签按 ja/zh/en 渲染 -> unit
- 多轮:在某条路线上完成一次 Walk 后返回 `/routes`,该卡的完走状态无需手动刷新即正确反映 -> integration
- 生成式组件契约(回填自 SD-13):`BookshelfCard` 属产品专属生成式组件(inputs §三 A4 目录),若被 Chat generative UI registry 复用,payload 须含 `schema_version`(additive-only 演进)且组件 partial-tolerant(缺字段时渲染 skeleton slot);Storybook 需建"字段残缺态"+ "旧版 payload 态"story -> unit

**变更文件**:`apps/web/src/routes/routes/index.tsx`、`apps/web/src/components/my-routes/BookshelfCard.tsx`、`apps/web/src/components/my-routes/EmptyState.tsx`、`apps/web/src/components/my-routes/MyDeskLayout.tsx`。

**依赖**:S2.8(数据源)。

---

### S2.8 `workers/users` 服务搭建 + 路线保存/列表 oRPC enabler(SD-2 终局)

**用户故事**:作为用户,我要能从 chat 保存一条路线,之后在マイルート看到它,并且我的匿名操作成果在登录后自动归属到我的账号。

**设计依据**:无视觉画布;`user-journey.md`"匿名态路线暂存于匿名 session,登录后归属账号"。

**Backend enabler(SD-2/SD-3② 终局定案,非暂定)**:
- 新建 TS 服务 `workers/users`(完整参照 `workers/catalog` 的既有模式:Hono + oRPC + Drizzle,不发明新模式)。
- Neon 侧经 SD-1 工具链(Drizzle schema → atlas-provider-drizzle → `atlas migrate`)建表:`routes` 表迁入 Neon(带 `user_id`、`title`、`status TEXT CHECK (status IN ('draft','saved','completed'))`、`saved_at`、`updated_at`)。
- oRPC 路由 `/v1/users/routes`(list/save/delete),契约进 `packages/contract`(新文件,如 `src/users-contract.ts`)。
- 鉴权:请求携带 Supabase 签发的 JWT 作为 bearer,`workers/users` 校验后取 `sub` 关联 Neon 侧 `user_id`;`apps/web` 的 `supabase-js` 仅用于取这个 JWT(`getSession()`),不做任何数据表查询。
- 匿名路线认领:登录后 `apps/web` 调用 `/v1/users/routes/claim`(或等效端点),服务端把匿名 session 关联的路线 `user_id` 置为登录用户。
- root Worker(`worker/app.ts`)需要新增 `/v1/users/*` 的路由转发规则(参照现有 `/v1/*` 转发到 CONTAINER 的模式,改为转发到新的 `workers/users` service binding)。
- CI/部署:`.github/workflows/ci.yml` 新增 `ci-users` job(复用 `_ts-ci.yml`,`component: users`);`deploy.yml` 新增部署步骤(与 `workers/catalog` 同等顺序,在 root Worker 之前部署)。
- **不使用** Supabase RLS 作为访问路径(SD-2 明确否决此前 rev 1-4 版本的暂定方案);**不**在 `apps/agent` 新增任何数据端点。

**AC**:
- 快乐路径:从 chat 保存路线(S1.7 的保存触发)经 `/v1/users/routes` 创建/更新一条记录,之后在マイルート列表可见 -> integration
- 空:全新用户零已保存路线时,`/v1/users/routes` 列表查询返回空数组,不报错 -> unit
- 错误:携带另一用户 JWT 的请求尝试读写不属于自己的路线被 `workers/users` 拒绝(403),不是 Neon 层面隐式拒绝 -> integration
- 认领:匿名 session 的路线在 magic-link 登录完成后,经认领端点立即关联到账号,用户无需重新做任何选择 -> integration
- **鉴权边界**:未携带有效 JWT 的请求访问 `/v1/users/*` 一律 401,不允许匿名读写用户数据(与 Chat 的匿名放开是两套不同的信任模型,不能混淆)-> unit
- **CI/部署接线**:`ci-users` job 在 `workers/users/**` 变更时运行并通过;`deploy.yml` 的新部署步骤顺序正确(先于 root Worker)-> integration

**变更文件**:`workers/users/**`(新建服务:`src/index.ts`、`src/router.ts`、`src/db/schema.ts`、`src/api/routes.ts`)、`packages/contract/src/users-contract.ts`(新增)、`worker/app.ts`(`/v1/users/*` 转发规则 + service binding)、`wrangler.toml`(`[[services]]` 新增 USERS binding)、`.github/workflows/ci.yml`(`ci-users` job)、`.github/workflows/deploy.yml`(部署步骤)、`apps/web/src/lib/data/routes.ts`(oRPC client 调用封装)、`apps/web/src/lib/data/claimAnonymousRoutes.ts`。

**依赖**:S1.7(触发保存的时机);S0.9 的 `docs/ops/migrations.md`(SD-1 工具链参照)。

---

### S2.9 Sessions 数据迁移 Supabase → Neon(SD-3④)

**用户故事**:作为运维,我要既有的 `sessions` 表数据从 Supabase 迁移到 Neon,以便与 SD-3 的"数据面归 Neon"方向保持一致,不再让新老数据分裂在两个数据库里。

**设计依据**:无视觉画布;SD-3④(prod 数据量近零,一次性脚本,非零停机双写)。

**Backend enabler**:一次性迁移脚本读取 Supabase `sessions` 表全量行,按 SD-1 工具链在 Neon 建对应表结构,写入并核对行数;迁移完成后 Supabase 侧 `sessions` 表标注冻结(不再写入,SD-3③ 同类处理);`apps/agent` 的 session 读写路径切换到 Neon。

**AC**:
- 快乐路径:迁移脚本运行后,Neon 侧 `sessions` 表行数与 Supabase 源表行数一致(全量核对,非抽样)-> integration
- 空:Supabase `sessions` 表为空(全新环境)时迁移脚本正常空跑,不报错 -> unit
- 错误:迁移脚本遇到格式不匹配的历史行(如 `state` JSONB 字段损坏)时记录到失败清单并继续处理其余行,不是整体脚本中断 -> unit
- 数据完整性:迁移后随机抽样 10% 行做字段级内容比对(不只是行数),确保 `state`/`metadata` JSONB 内容未失真 -> integration

**变更文件**:`scripts/migrate-sessions-to-neon.ts`(新增)、`apps/agent/agent/infrastructure/`(session 读写路径切换到 Neon 客户端)、`supabase/migrations/`(冻结标注)。

**依赖**:S2.8(`workers/users`/Neon 工具链已搭建)。
