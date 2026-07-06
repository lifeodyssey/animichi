# 前端重建规划输入(2026-07-06)

> 本文件是 frontend rebuild spec 的唯一权威输入,由主会话三路盘点 + grill-me 决策会产出。
> Planner 据此写 spec,**不要重新盘点**;与本文件冲突的旧文档以本文件为准。
> 设计原稿:`docs/design/2026-07-06-design-sync/`(claude.ai/design 项目导出,内嵌说明改名为 `design-project-log.md`)。

## 一、决策登记册(grill-me 定案,2026-07-06)

| # | 决策 | 定案 |
|---|---|---|
| G1 | 基线落点 | 基于 main(02cd7fa)新分支 `feat/frontend-rebuild`,新前端落 `apps/web/`;spike 代码(分支 docs/frontend-rebuild-plan 的 frontend/,11 个功能 commit)**迁代码不迁历史** |
| G2 | 切流 | **大爆炸**:迭代 0 的 walking skeleton 直接替换生产前端;旧 Next.js `frontend/` 与 OpenNext 链路同迭代删除 |
| G3 | 渲染 | SPA + **选择性 SSR**(`/s/:id`、`/anime/:id` 两族路由)——对 2026-06-22 spec「纯 SPA」决策(D4)的正式修订,需记入 spec Decision Log;skeleton 从迭代 0 起按 worker 运行时 + 静态资产形态部署,为 SSR 预留跑道 |
| G4 | 后端归属 | **全栈纵切**:需要新后端能力的 story 自带最小 enabler(端点 + DB 迁移 + oRPC 契约类型),不做 mock 先行、不做后端先行 |
| G5 | 迭代列车 | Chat 先行,8 个迭代(0-7),见下节 |
| G6 | Walk 离线 | 迭代 3 内**一步到位**(service worker + 地图/路线缓存 + 打卡离线队列同步),不拆分、不推迟 |
| G7 | 匿名 Chat(原设计未决项 A4) | **完全放开**:未登录可完整用 Chat,登录墙只在保存(P5);配套 edge 限流 + Cloudflare Turnstile + 匿名配额 + **BYOK**(用户自带 LLM key,key 仅存客户端、请求透传不落盘);agent skill + A2A 开放接口进迭代 7 |
| G8 | 素材生产 | fox 小跑 8 帧 sprite(按 fox-walk-spec.md 的生成模板)+ 20 枚产品图标集(按 DS 补全 S2 规范)以 AI 生成管线产出,进对应 story;AC 必须含「用户过目收编后才算完成」 |

### 主会话设定的默认项(spec 里标注,可被用户推翻)

- PR #206(atlas CI 修复)列为**迭代 0 前置条件**(部署链依赖)
- `animal-island-ui-tailwind` 升级到 **1.0.x 最新**(现 npm 1.0.16;spike 锁 1.0.0、旧 main 用 0.8.4),兼容性验证进迭代 0 story
- **Zen Maru Gothic 自行 @import 为硬性 AC**(上游包 v0.9.x 起移除日文字体,产品全日文,漏掉即视觉事故;设计导出 `assets/fonts.css` 可直接 vendor)
- D7-D10(Agent Pyodide 化 / Neon 迁移 / Pulumi / 多环境)**明示为 non-goal**,本列车不动
- Capacitor **推迟到环闭合后**(零代码沉没);本列车只保证不做出阻断 Capacitor 的选择(SPA shell 保持、SPA 路由无 server-only 依赖)
- 域名:用户持有 `animichi.com`(主推荐)与 `aninavi.app`,尚未最终拍板 → spec 用参数 `CANONICAL_DOMAIN` 表示;迭代 0 的 SEO/域名 story 标注「依赖域名落定」(canonical/sitemap host/OG 绝对链接/Supabase magic-link 重定向白名单)
- 设计导出已提交入库,作为 Tester 的视觉基准(oracle)

### 用户附加 scope(必须进 spec)

1. **SEO + GEO 可执行化**,按迭代摊派:
   - 迭代 0:robots.txt、sitemap 骨架、三语 hreflang/canonical、OG 默认卡、llms.txt v1、Lighthouse CI 预算门禁(CWV 进 DoD)、域名绑定 + 旧域 301;旧仓 `backend/tests/unit/test_seo_static_files.py` 的基建可移植
   - 迭代 4:/s/:id 动态 OG/Twitter 卡(即 G3 选择性 SSR 的动机)
   - 迭代 5:programmatic SEO 主战场——/anime/:id JSON-LD(TouristTrip + CreativeWork)、per-anime sitemap 自动生成、内链结构(作品页↔路线↔首页ランキング)、GEO 引用友好排版(点位地址/话数/名場面组织成可被 AI 摘引的事实块)、AI 爬虫 robots 策略(GPTBot/ClaudeBot/PerplexityBot 放行)
   - 迭代 7:llms-full.txt + agent skill/A2A 端点
   - 验收:claude-seo 插件(含 seo-geo agent)写进 Tester 工序,迭代 5 发布后跑审计出分
2. **覆盖每一张设计稿**:spec 必须含「设计稿 → story 覆盖矩阵」,`docs/design/2026-07-06-design-sync/` 顶层每个 .html 都要有归属(实现 story / 留档不实现 / 规范画布 / 索引画布),一张不落

## 二、迭代列车(G5 定案)

| 迭代 | 主题 | 内容 |
|---|---|---|
| 0 | 地基 | apps/web skeleton(TanStack Start,worker 运行时形态)+ 部署链修复(wrangler assets 指向 `.output/public`、_web-ci.yml 改 pnpm/vite/apps-web 路径)+ pnpm workspace 注册 + spike 代码搬运(Landing/登录 modal/i18n/Storybook)+ Splash 静态版 + DS 底座(tokens 对齐 CI 测试、fonts vendor 含 Zen Maru Gothic、DS 包升 1.0.x)+ 删旧 frontend/ + SEO 地基 + 域名 story |
| 1 | 計画:Chat | Chat Phase 1 单列流全态(流式三段等待仪式、generative UI registry、7 demo 态 + 44 态 spec 的对应帧、D1-D9 异常态兜底、E1/E2 卡片规则)+ 保存 P5 登录墙 + 匿名放开(限流/Turnstile/配额)+ BYOK story |
| 2 | 承接:详情+列表 | 路线详情 v2(单页活文档:三数据快照/MODE 静息⇄地図展開 FLIP/金条 CTA/规模态手风琴/機位 sheet/桌面 R-DESK)+ マイルート本棚(空态/きょう金件唯一规则/桌面 MY-DESK)+ 路线保存/列表后端 enabler |
| 3 | 歩く:Walk | Graduation 转场(F0-F5 storyboard)+ Walk 10 态(W-B′全出血定稿方向、強光/夜間/離線环境态、構図对照透明度滑杆、近くsheet 寄り道、打卡 vibrate+撤销)+ 打卡持久化 enabler + **离线一步到位**(SW+缓存+离线打卡队列)+ fox 8 帧 sprite 素材 story |
| 4 | 残す:しおり | しおり版式族(切符/一枚看板/アルバム格子/ポスター fallback,枚数驱动)+ 生成屏 + /s/:id 公开分享(**SSR + 动态 OG**)+ share token 后端 enabler + 対比図作成 5 态(getUserMedia ghost 叠帧/canvas 合成/HEIC 警告/EXIF opt-in)+ 图片上传 R2 enabler |
| 5 | 発見:作品页+首页 | 作品公開页 A 図鑑型(圈泡地图/機位 sheet/「AIにルートを組んでもらう」→Chat 预填,**SSR**)+ catalog 数据 enabler + 首页(搜索/続きから/人気ランキング)+ programmatic SEO/GEO story |
| 6 | 工作台 | Chat Phase 2 地图常驻双栏(hover 图钉即画面/lightbox 機位浏览器/エリア/話数分组同步/SP8 草稿编辑/SP9 锚点委托,>100 件规模反转) |
| 7 | 开放接口 | agent skill 发布 + A2A 端点 + llms-full.txt + API 文档;涉及 agent 行为面 → 按 eval gate 规则(先跑 baseline,score >= baseline - 10pp) |

依赖链依据:Chat 产路线 → 详情/列表承接保存 → Walk 走路线 → 残す留成果 → 発見引新人 → 工作台增效 → 开放接口对外。

## 三、盘点报告 A:设计资产(Sonnet 代理,2026-07-06)

[以下为报告原文]

### A1. 页面清单

| 页面 / 路由 | 对应 html 文件 | 状态 / 变体列表 | 关键交互 |
|---|---|---|---|
| 開屏 Splash | `Splash 静态版.html`(现行·移动开屏)、`Splash - Seichijunrei.html`(动效探索,留档) | 静态版:昼/夜两帧(`.phone.day`/`.phone.night`),无 JS 无动效,规则「跟随系统 ·≤800ms·不进 scene-cut」;动效版:朝/夜 + CTA「巡礼を始める」 | 动效版点击后触发 scene-cut 小狐狸转场;静态版纯展示 |
| Landing 落地页(营销/桌面) | `Landing - Seichijunrei.html` | 昼/夜(`body.night` + localStorage `landing-mode`,右下 toggle) | 「Start Exploring」主 CTA(explore 橙)→scene-cut→Chat;magic-link 登录表单 |
| 首页 App Home | `首页 - Seichijunrei.html` | 搜索态 / 続きから(进行中路线)/ 人気ランキング | 搜索框「今日はどの聖地へ?」;FAB「新しい巡礼」→Chat |
| Chat 計画(核心) | `Chat 完整状态.html`(可点 demo,主版,含 `?m=1` 手机壳)、`Chat 状态总览.html`(状态总览,主交付)、`Chat 初始状态.html`(旧版,留档) | demo 7 态(空/ホーム/聞き返し/写真/近く/失敗/編集)+「暖/DS」配色对比开关(默认 DS 严格);状态总览按 A(5)/B(7)/C(8,新增 C2t)/D(9)/E(6)/SP(1,已改为跳转帧)/F(5)/G(6) 分组平铺 | 发送/勾选重排(E2)/追问 chips/しおり分享/「歩くモード」→scene-cut→Walk |
| Chat 桌面 DS 扩展稿(规范,非产品页) | `DS 补全 - Chat 桌面.html` | S1–S9 九段:token 补遗/图标 20 枚/按钮 4 级×6 态/overlay 三件套/生成式家族①–⑩/A11y/动效角色/治理 decision log/07-06 新增⑨-1~7 | 纯参照文档,声明「值以本画布为准」 |
| Chat Phase2 双栏工作台方案 | `工作台 - 地图常驻方案.html` | 地图常驻右侧 + 左栏随阶段换内容(选图 gallery / 路线 TimedItinerary),单画布 JS 多幕渲染,恒定密度左栏 | hover 图钉即画面、lightbox 機位浏览器、エリア/話数分组同步契约 |
| 毕业转场说明 | `Graduation 转场 - Storyboard.html` | F0 前夜→F1 预备(0–120ms)→F2 主移动(120–480ms)→F3 落位(480–650ms)→F4 完成(650–850ms)→F5 边界规则 | 纯 storyboard,无可点交互 |
| 歩くモード Walk | `Walk 状态总览.html`(10 态)、`Walk demo.html` | W-A 卡片积 / W-B′全出血(定稿方向)两案;強光/夜間/離線 3 环境态;構図をくらべる/近くsheet/打卡瞬間;完走屏+桌面降级 | demo:打卡(vibrate+撤销 toast)、構図对照透明度滑杆、近くsheet 寄り道追加、対比図出口深链 |
| 路线详情 `/routes/:id` | `路线详情 状态总览.html`(标题含 v2,现行单页活文档)、`路线详情 demo.html`、`路线详情 状态总览 v1.html`(archived,三态 tab 探索) | v2:平日/きょう(金条)/完走 三数据快照 + MODE(静息⇄地図展開)+ 桌面 R-DESK 三栏 + 规模态(手风琴/多日/機位sheet) | FLIP 地图展开/grab 收起、金 CTA 随数据换文案、対比図 tile |
| しおり + 公开分享 `/s/:id` | `しおり share 状态总览.html`、`しおり demo.html` | 版式族(切符/一枚看板/アルバム格子/ポスター fallback,枚数驱动)+ 生成屏×2 + 公开页×3(手机完走/计划+桌面) | demo:逐枚勾选实时换版式、保存→P5 登录 modal、画像保存/リンク复制 |
| 作品公開页 `/anime/:id` | `作品公開页 状态总览.html`、`作品公開页 demo.html` | A 図鑑型(圈泡地图优先,已定稿) / B ポスター型(留档) + 桌面 AN-DESK | 泡 tap→zoom→機位 sheet;「AI にルートを組んでもらう」→Chat 预填 |
| マイルート `/routes`(列表) | `マイルート 状态总览.html`、`マイルート demo.html` | A 本棚(已定稿) / B 予定表(留档)+ 空态 + 桌面 MY-DESK | demo:きょうあり/きょうなし/空态 3 档,验证「金件唯一」规则 |
| 対比図作成流程 | `対比図作成 状态总览.html`、`対比図作成 demo.html` | CMP-0 構図確認→1 現場撮影→2 写真を選ぶ→3 合成→4 完成,共 5 态 | demo:真 `getUserMedia` 相机 ghost 叠帧、真 canvas 合成、HEIC 警告、EXIF opt-in 回传 |
| 总览索引 | `前端全景 - Journey Hub.dc.html` | 発見/判断/計画/歩く/残す 五段列 + 「Step2–5 交付」十一连卡链接区 | 纯导航;未收录 Walk/DS 补全/工作台/Graduation 四份文件(见 A6) |

### A2. 用户旅程映射

依据 `docs/user-journey.md` §2「5 段 18 断点」(J1–J18):

- **発見 Discover(J1 分享物缺失/J2 落地登录墙/J3 无作品浏览面)** → しおり share(`/s/:id` 免登录落地,解 J1/J2)、作品公開页(弱覆盖 J3)、首页/Landing(入口)
- **判断 Decide(J4 guide 页缺失/J5 判断素材未成页)** → 作品公開页(名場面 TOP + 圈泡地图 + 示例路线,与 chat C3b 圈总览共享素材)
- **計画 Plan ★(J6 无流式反馈/J7 登录边界/J8 效率回归)** → Chat(J6 流式三段已交付)、DS 补全、工作台(Phase2,已降级到环闭合后)
- **歩く Walk ☆审判(J9 现场视图/J10 机位对照/J11 附近点位/J12 导航深链/J13 打卡/J14 环境约束)** → Walk(主交付)、対比図作成(J10 延伸)、Graduation 转场
- **残す Keep(J15 分享物/J16 同行协作/J17 历史路线/J18 打卡照合成)** → しおり share(J15 主交付)、マイルート(J17)、対比図(J18);**J16 同行协作本次导出无对应页面(缺)**
- **环回流**:`/s/:id`「自分用にアレンジ」→ Chat A2b 引用态(主线 B,比首次搜索主线 A 更高频)

### A3. 各 spec 文档要点

- **docs/DESIGN.md**:動森キャンプ 90/8/2 三层配色(奶白棕/teal/金),永不纯黑纯蓝;按钮层级靠阴影深度非饱和度,3D 底影+pill+2px 边为核心识别;`Token Alignment Map` 预埋包↔应用 token 对照表与 CI 守护测试;Do/Don't 硬规则禁 `transition-all`/`space-y-*`/玻璃拟态/暗色模式/弹性缓动。
- **docs/spec-chat-page-design.md**:双形态分期共享同一 generative UI registry——Phase1 单列流(现做)→Phase2 桌面双栏(环闭合后);TimedItinerary 站粒度+HH:MM 精确时刻+散步段独立可见为核心固化资产;地图 static-first/GL-on-demand(单季≤206 点、系列合并 829 点→50m 聚合 115 地点);未决:登录墙范围(已由 G7 裁决)/流式协议(Vercel AI SDK 曾 revert)/しおり排版细节。
- **docs/spec-chat-page-states.md**:四层正交状态模型(页面 A→回合 B→内容形态 C→卡片 D/E,输入区 G 贯穿);等待仪式感阶梯化(<1s 纯 typing、1–4s 管线+徽章、≥4s 情绪卡),纯文字回合永不出 skeleton;9 种异常态(D1–D9)全兜底永不裸错误;E1 活文档旧卡降级不改写历史、E2 旁路不演 agent 戏。
- **docs/spec-route-detail.md**:「单页活文档·无模式」,数据点亮元素,优先级完走>当天>平日;MODE 与数据正交,FLIP 360ms,07-03 已改为「可随时手动切」;时刻表恢复帧缩略 104×64(画面>地点>时刻);规模态 G4 留 2 项「待用户过目」。
- **docs/journey-走查.md**:三主线 A 首次搜索/B 回流アレンジ(更高频)/C 浏览判断;chat→SP 工作台仅两个入口,SP 出口不产路线只旁路改「选中集合」(E2);Q1–Q5 共 5 个未裁决开放问题;C2t 帧是画布作者提案,spec 未收录。
- **docs/ds-审计.md**:品牌层强、系统层仅~50%;**2 处对比度 FAIL(`#9f927d`≈2.8:1、白字 on teal≈2.1:1)**;图标/组件状态矩阵/产品组件规范/布局栅格/治理分 P0–P3 补齐(P0 已交付进 DS 补全画布)。
- **fox-walk-spec.md**:scene-cut 狐狸单帧→8 帧小跑 sprite(512×512 透明底、脚着地线 y=430、不烘焙阴影);交付雪碧图 4096×512 或 8 张 PNG;附 CSS `steps()` 接入代码与生成提示词模板。
- **generative-ui.md**:Plan Phase1 单列 inline 卡是唯一现做范围;Walk 审判时刻插队于 Phase2 之前;固定组件库+结构化输出选组件填数据;J6 流式反馈必须、J7/P5 登录墙只在保存两条红线;组件 catalog 标注 Phase 归属。

### A4. 设计系统(两套需分清)

1. claude.ai/design 项目「Seichijunrei DS·Animal Island UI v1」(`_ds/…/`):导出物只有 token CSS(`assets/index.css`+`styles.css`)+ `_ds_bundle.js`;`_ds_manifest.json` 的 components 为**空数组**;9 张说明卡中仅 `card-user-journey.html` 在此导出。
2. 上游 npm 包 `animal-island-ui`(v0.9.5 文档):26 组件 + 3 伴生导出的完整 API 手册(`AI_USAGE.md`)+ 像素级样式指南(`skill/SKILL.md` ~2600 行)+ 7 个组件 less 源码。Icon 内建仅 10 个游戏向图标,与产品所需 20 图标集(DS 补全 S2)不同。
   (实现用的是 Tailwind 版包 `animal-island-ui-tailwind`,见决策 G1/默认项。)

**Token 权威顺序**:`DS 补全 - Chat 桌面.html` > `docs/DESIGN.md` > `skill/SKILL.md` > `_ds_manifest.json`/bundle(仅比对)。

**产品专属生成式组件**(DS 补全 S5/S9 定义):TimedItinerary、FootprintRow、SpotCard、ClarifyChips、MapCard、AreaCard、EpisodeSection、SelectionTray、Lightbox、対比図 tile、しおり版式族、GoldBar、SegmentHead、BookshelfCard。

**注意**:`DESIGN.md` frontmatter colors 缺 `explore`/`walk`/`map-*`(正文有讲解),由 DS 补全 S1 回填,frontmatter 未同步。

### A5. 素材资产

- `assets/fox/` 11 个 SVG 姿态:cheer/curious/guide/lean/oops/peek/stand/thinking/traveler/trot/welcome(stand、trot 未被文档记录,应为 Splash 待机与 scene-cut 后补);fox-walk-sheet **尚未生成**。
- `assets/img/`:divider×3、footer-sea、icon-camera/chat/map、icon-leaf.png、location、page、wave-yellow、wifi——Landing/首页装饰,非 DS 补全 S2 的 20 枚图标系统(规范先行、素材未产)。
- `assets/compare/`:anime.jpg + real.jpg(秒速5cm 参宮橋踏切),比較スライダー与対比図 demo 用,全导出仅有的真实照片。
- `assets/torii.svg`:鸟居品牌标志,页头统一使用。
- CSS 三件:`fonts.css`(15 条 @font-face,自托管 Nunito/Noto Sans SC/Zen Maru Gothic 含日文子集)可直接复用;`index.css` = core + fonts 全量单文件(7 个旧式页面引用);`core.css` 无字体且无 html 引用(孤立文件,与上游包 dist/core.css 仅重名)。
- `_ds_bundle.js`/`support.js`/`image-slot.js`/`tweaks-panel.jsx` 为画布工具脚手架,`_adherence.oxlintrc.json` 规定业务代码禁止直接 import。

### A6. 歧义与冲突(spec 必须显式裁决)

1. 路线详情 v2(现行)与 v1(archived)并存,文件名无法分辨——以 `spec-route-detail.md` 首行裁决为准。
2. `Chat 初始状态.html` 是旧版(仅 2 态),被 `Chat 完整状态.html`(7 态)取代,文件名无 legacy 标记。
3. `Chat 状态总览.html` 内 SP 分组仅剩 1 帧跳转声明,以 `工作台 - 地图常驻方案.html` 为准。
4. Journey Hub 索引滞后:Walk 栏仍写「零実装」,且未链接 DS 补全/工作台/Graduation;以 design-project-log.md 的 Step 日志为准。
5. **三套互不复用的 CSS/token 加载方式**:①旧式页面走 `assets/index.css`;②Walk/DS补全/工作台/Graduation/路线详情v1 走 `_ds` bundle;③Step2–5 新稿(路线详情v2/しおり/マイルート/作品公開/対比図)每个 html 内联手写 `:root`。**实现时禁止从任一 html 的内联 :root 反推数值**,一律走 DS bundle token + DS 补全画布权威值。
6. Token 数值漂移:文档「radius sm=12px」vs 编译产物 `--animal-radius-sm=16px`——按 S8 治理规则(画布为准)取 16px,并记 decision log。
7. **字体风险**:上游包 v0.9.x 移除 Zen Maru Gothic,产品全日文依赖它——必须自行 @import(见默认项)。
8. `DESIGN.md` frontmatter 落后正文(colors 缺 explore/walk/map-*)。
9. 未裁决项:A4 匿名 chat(已由 G7 裁决);spec-route-detail 2 项「待用户过目」;fox sprite 未产(G8);manifest 引用的 8 张说明卡不在本导出。
10. 两份「用户旅程」并存:`user-journey.md`(散文全量,权威)与 `card-user-journey.html`(APPROVED 可视化锚点),范围判断以后者、细节以前者。

### A7. 权威性规则(设计侧自声明)

- 权威文档五件套:`user-journey.md`、`DESIGN.md`、`spec-chat-page-states.md`、`spec-chat-page-design.md`、`card-user-journey.html`;其余 html 是据此产出的高保真画布。
- 视觉值只允许三个出处:DS bundle token → DS 补全画布 → 无;画布手搓值一经发现即收编或替换;**DS 补全画布 > DESIGN.md**。
- 基础组件对齐上游(API 形状查 `AI_USAGE.md`,像素级 CSS 查 `skill/SKILL.md`);产品生成式组件由本项目在 DS 补全定义,不去上游找。
- 产品级约束(已拍板,直接继承):登录墙只在「保存」(P5);离线只做 Walk;scene-cut 只用于「明显去某处」的大跳转,页内小变化保持轻快即时。

## 四、盘点报告 B:代码现状(Sonnet 代理,2026-07-06)

### B1. 两个 worktree

- **ssr-migration**(feat/ssr-cloudflare,领先 main 2 commit):HEAD「delete frontend for clean-slate rewrite」;未跟踪 frontend/ 是**构建垃圾**(.next/node_modules/coverage,无源码),不是 spike。分支 2 commit 无 PR。
- **backend-survey**(领先 main 5 commit):与 main 几乎同源(PR #190-#203 已合入 main);仅 atlas/CI 修复 + staging pulumi 配置;**PR #206 OPEN**。

### B2. main 基线(origin/main = 02cd7fa)

- monorepo P0-P3 已落地:`apps/agent`(Python FastAPI + pydantic-ai)、`workers/catalog`(TS, Hono+oRPC+Drizzle+Neon)、`packages/contract`(`@seichijunrei/contract`, oRPC + zod 4)、`infra/`(Pulumi prod+staging)、pnpm-workspace、reusable CI workflows(`_python-ci.yml`/`_ts-ci.yml`/`_web-ci.yml`/`_deploy-component.yml` 等 10 个)。
- main 的 `frontend/` 仍是旧 Next.js 16 + @opennextjs/cloudflare + animal-island-ui-tailwind@^0.8.4 + Supabase/AI SDK/Mapbox,无 TanStack。
- `pnpm-workspace.yaml` 注释已预留:`frontend # 留原地,Wave 4 → apps/web`、`worker # 留原地,Wave 4 → workers/edge`。

### B3. TanStack spike 下落

**在主工作区分支 `docs/frontend-rebuild-plan` 的 `frontend/`**(不在任何 worktree):全套 @tanstack/react-start 依赖 + `animal-island-ui-tailwind@1.0.0`(npm 公开包,registry 最新 1.0.16);11 个功能 commit(hero/对照滑块/Storybook/登录 modal/i18n/locale switcher);merge-base ac03720(2026-04-28),**落后 main 341 commit**,无 monorepo 结构,从未 push。Capacitor 仅以传递可选依赖出现,**集成未开始**。

### B4. 可复用资产

- spike 的 `src/routes`、`src/components`、Storybook、i18n(含测试)、登录 modal、hero/对比滑块 → 迭代 0 搬运主体
- `packages/contract`(oRPC + zod)→ 新前端类型化 API 调用的挂点
- `_web-ci.yml` reusable workflow → 改路径(apps/web)/包管理器(npm→pnpm)后复用
- `docs/superpowers/specs/2026-06-22-frontend-rebuild-tanstack-design.md` 及配套 UX spec → 设计依据(注意其 D4 纯 SPA 决策已被 G3 修订)

### B5. 风险

- spike 与 monorepo 完全脱节:搬运必然重写 package.json/CI 路径/工作区注册,不是 git merge
- ssr-migration 的 frontend/ 构建垃圾勿误提交
- PR #206 未合并,涉及 CI/迁移脚本 → 迭代 0 前置
- main 现役旧前端迁移后必须显式移除(G2 已裁决:迭代 0 删)
- animal-island-ui-tailwind 版本三处不一致(0.8.4/1.0.0/1.0.16)→ 默认项已裁决升 1.0.x 最新
- 主工作区 docs/frontend-rebuild-plan 有未提交杂物(截图/.claude-flow/ 等),与本列车无关,注意隔离

## 五、盘点报告 C:架构决策台账(Sonnet 代理,2026-07-06,节选可行动部分)

> 台账扫描的是 docs/frontend-rebuild-plan 分支;凡「未落地」判断需结合 B2 修正:monorepo/oRPC/Pulumi 在 main 已落地。

| # | 决策 | 判决(主会话) | 关键事实 |
|---|---|---|---|
| D1 | TanStack Start | 保留 | spike 已跑通;docs/ARCHITECTURE.md、AGENTS.md、deployment.md、CI 全部仍写 Next.js——**文档滞后,迭代 0 需一并回写** |
| D2 | animal-island-ui-tailwind | 保留,升 1.0.x | PRODUCT.md 未入库且内容过时(仍写 Next.js) |
| D3 | Capacitor | 推迟(non-goal) | LOCKED 纸面决策,零代码 |
| D4 | 渲染策略 | **修订**:SPA + 选择性 SSR(G3) | 原 spec 纯 SPA;`wrangler.toml [assets]` 仍指向已不存在的 `./frontend/out`,**下次 tag 部署必挂**;CI frontend-build/upload-artifact 同样按旧假设——迭代 0 必修 |
| D5/D6 | monorepo + oRPC 契约 | 保留(main 已落地) | agent API 仍是手写 REST;新端点顺手进 contract |
| D7 | Agent Pyodide Worker 化 | non-goal | 三代设计自我推翻,代码停在第一代(FastAPI 容器);现役 `/v1/*` 稳定,前端照常消费 |
| D8 | Neon/Supabase 拆分 | **SD-3 激活(2026-07-06)**:Supabase 收缩为纯 auth,数据归 Neon,渐进执行(见第七节) | 原 06-23 设计被用户确认为终局路线;不再是 non-goal |
| D9 | Pulumi IaC | non-goal(main 已有 infra/) | 本列车不新增 infra 资源除非 story 需要(R2 桶等按需) |
| D10 | 多环境 | non-goal | 现状单环境 tag→prod;releasable 定义按此 |
| D11 | i18n | 保留 | spike 的 Context+字典机制,决策-文档-代码-测试四者一致,直接沿用 |
| D12 | 测试策略 | 保留 + 补洞 | coverage ratchet 生效(backend≥80,frontend lines72/stmt68/func61-62 口径待核);**agent-eval job 被 `if: false` 禁用**——迭代 7 触及 agent 面时必须先解禁跑 baseline |
| D13 | tag-based deploy | 保留机制,重写内容 | 部署内容对应旧架构;迭代 0 按 apps/web + worker 运行时重写 web 部署 job;catalog 无独立部署 job 的洞不在本列车修(non-goal),但 web job 不得再依赖 frontend-out artifact |

### 文档矛盾清单(迭代 0「文档回写」story 的输入)

ARCHITECTURE.md/todo.md/deployment.md/根 AGENTS.md/PRODUCT.md(未入库)/wrangler.toml/CI 全部仍写 Next.js;frontend/AGENTS.md 被脚手架覆盖空心化;testing-strategy.md 长期 DRAFT 数字过期;i18n 新旧两套机制并存文档;ADR 无统一目录。

## 六、主会话架构补充意见(2026-07-06,用户已知悉,须落进 spec)

| # | 意见 | 落点 |
|---|---|---|
| X1 | **地图选型 ADR**:MapLibre GL + Protomaps(pmtiles 存 R2),static-first;禁 Mapbox(账单+封闭样式);pmtiles 的 range 请求与 Walk 离线的 SW 缓存天然复用 | 迭代 0 或 2 前的 ADR+spike story;Walk 离线 AC 引用它 |
| X2 | **Chat 首 token SLO**:warm p95 ≤3s + 容器保温策略(min instances 或 cron ping);等待仪式阶梯只是兜底不是方案 | 迭代 1 性能 AC -> api |
| X3 | **BYOK × Logfire scrub**:BYOK key 透传必须从所有日志/trace 中剥除(header redaction),需测试证明 key 不落任何观测面 | 迭代 1 BYOK story 硬 AC -> integration |
| X4 | **全局日预算熔断**:匿名入口在全局日成本超限时自动降级到登录墙(env 配置一个数) | 迭代 1 匿名放开 story AC -> unit/api |
| X5 | **Edge 认证模型变更显式化**:「edge 强制认证」→「edge 放行匿名+Turnstile+配额标记,容器按新信任规则处理匿名」;CLAUDE.md/ARCHITECTURE.md 回写须含此条 | 迭代 1 enabler + 迭代 0 文档回写 story |
| X6 | **图片管线客户端化**:resize/压缩/合成全在客户端 canvas,R2 只存成品;分享物默认剥 EXIF(GPS 隐私),EXIF 回传维持 opt-in | 迭代 4 対比図/上传 story AC |
| X7 | **SW 与 SSR 路由绕行规则**:service worker 对 /s/:id、/anime/:id 走 network-first,不得缓存旧 SSR HTML | 迭代 3 SW story + 迭代 4 SSR story 各一条 AC -> browser |
| X8 | **eval 分层常开**:5 条 smoke eval 进 PR 门禁(agent/ 路径触发),全量 617 条 nightly/手动;取代现在的 `if: false` 全关 | 迭代 0 CI story;迭代 7 依赖它 |
| X9 | **D7 Pyodide 改判 REJECTED(非 deferred)**:容器 FastAPI + 保温为定案,三代自我推翻的文档在回写 story 中统一收敛并标注 | Decision Log + 迭代 0 文档回写 story |
| X10 | **平台能力适配层(多端纪律)**:`apps/web/src/platform/` 薄接口(camera/geo/haptics/wake-lock…),组件禁止裸调 `navigator.*`;web 实现打底,Capacitor 实现后插。凡涉及相机(対比図)、定位/震动(Walk)、剪贴板/分享(しおり)的 story,AC 要求经由适配层 -> unit | spec 全局约定一节 + 迭代 1-4 相关 story AC |
| X11 | **SDK 战略(契约即产品)**:① 自家 web app 一律经 /v1 公开 API 消费能力,禁止私有后门;② oRPC 契约自动出 OpenAPI;③ `@seichijunrei/sdk`(npm)= contract client 薄壳再导出;④ 现有 `backend/clients/python/seichijunrei_client.py` 转正为 Python SDK(手写薄客户端,不上 codegen);⑤ 迭代 7 的 MCP server/A2A 必须是 /v1 的薄适配器,零业务逻辑。①与②是全程纪律,③④⑤落迭代 7 story | G4 补充纪律 + 迭代 7 story 扩充 |
| X12 | **Agent 去数据化,catalog 成为唯一数据面**(方向性,不进本列车 story):agent 的 resolve_anime/search_bangumi/search_nearby 等数据工具应改为调用 catalog 读 API(经 contract),移除 agent 内嵌 retriever 直连 DB;消除「点位数据 Supabase(agent 读)与 Neon(catalog 写)两份真相」的分叉。agent 只保留会话/编排状态。进 Decision Log + 后续 backend wave;本列车中新建的后端 enabler 归属规则(G4 细化,SD-2 定案):**catalog 域数据(作品/点位/图片元数据)→ workers/catalog(oRPC);用户域数据(路线保存/列表、打卡、しおり、分享 token)→ /v1/users/* oRPC 路由(workers 上新建 users 模块),后端连 Supabase PG(service role),RLS 保留为纵深防御但不是访问路径;zod 契约进 packages/contract;禁止往 agent 服务新增任何数据端点;apps/web 的 supabase-js 仅用于 auth**。「自家吃公开 API」纪律(X11)全域统一适用;迭代 7 的 SDK/MCP 零改造复用同一契约 | Decision Log + G4 enabler 归属规则 |
| X13 | **[已撤回 2026-07-06]** 原主张「弃 atlas 收敛为 drizzle-kit」系误判:Drizzle(类型/查询)+ Atlas(schema 迁移)是用户的既定分工,PR #206 摩擦为 Neon 系统 schema 环境问题且已修复。迁移链议题转入 system-design 讨论(SD-1),结论以评审版 Decision Log 为准 | 撤回;见 SD 讨论 |
| X14 | **[核证修正 2026-07-06]** 原假设「worker.js 无测试纯 JS」不成立:现状已是 TS 三件套(worker/entry.ts+app.ts+auth.ts)且有 15 个测试用例;**真实缺口 = 测试从未接入 CI**(根 package.json 无 test script,workflow 零引用)。修正后的要求:迭代 0 CI story 把 worker 测试接入;迭代 1 的 Turnstile/配额/匿名逻辑在其上追加并保持可测 | 迭代 0 CI story + 迭代 1 enabler |
| X15 | **catalog 数据质量门**:作品公開页/programmatic SEO 上线前,catalog Publish 阶段加行级校验(坐标有效性/去重/話数完整性)+ 数量漂移告警——垃圾数据 × SEO 放大器 = 垃圾页面工厂 | 迭代 5 story 或其 AC |

## 七、SD interview 结论(滚动更新;评审版 Decision Log 以本节为准)

| 轮次 | 结论 | 状态 |
|---|---|---|
| SD-0 域名 | 调研代理扫描候选中,animichi.com 为基准对照;CANONICAL_DOMAIN 保持参数化 | 进行中 |
| SD-1 迁移链 | **双链 + atlas-provider-drizzle**:Neon 侧 Drizzle TS schema(workers/catalog/src/db/schema.ts)为唯一真相 → atlas-provider-drizzle 作期望态 → atlas migrate diff/lint/apply(versioned,db/migrations);Supabase 侧 supabase CLI 不变;边界与 CI 步骤写入 docs/ops/migrations.md(迭代 0 文档回写 story) | 定案 |
| SD-2 用户域访问 | **API-first 全走 /v1**:用户域 CRUD = workers 上新建 users 模块的 oRPC 路由(/v1/users/*),契约进 packages/contract;apps/web 的 supabase-js 仅用于 auth;RLS 不作为访问路径;迭代 7 SDK/MCP 零改造复用同一契约 | 定案 |
| SD-3 数据面 | **Supabase 收缩为纯 auth,数据归 Neon**(激活 06-23 D8 设计并升级为终局):① selected_route 的 get_points_by_ids 改走 CatalogClient/Neon,消除同会话跨库混读(迭代 1 enabler,修 bug 性质);② 新建用户域表(路线/打卡/しおり/分享 token)一律生在 Neon,经 SD-1 工具链建表,JWT sub 衔接 auth;③ Supabase 中 catalog 域表(points/bangumi/aliases 等)冻结写入标废,稳定一迭代后删;④ 既有会话/消息/routes 数据迁 Neon 作为迭代 2-3 的独立 story(prod 数据量近零,一次性脚本);⑤ 远期 Neon Auth 成熟后 auth 亦迁、彻底退役 Supabase(future wave,不进本列车) | 定案 |
| SD-4 agent 运行时 | **Python FastAPI 容器定案,不再议**(2026-07-06,基于 TS agent SDK 对标调研的知情决定:Vercel AI SDK 50/60 可行但需自养 ~100 行重试基建,pydantic-ai 的 ModelRetry+output_validator 护城河保留)。推论:① X2 容器保温 + 首 token SLO 升级为硬性要求;② 迭代 7 MCP/A2A = Workers 侧薄适配器跨运行时调容器 /v1;③ X9 终稿 = D7 Pyodide REJECTED + TS 重写 REJECTED,容器+保温为终局 | 定案 |
| SD-5 会话状态 | 迭代 1 前端沿用现状端点(Supabase sessions.state JSONB + conversation_messages,best-effort 写);随 SD-3④ 迁 Neon;「best-effort 持久化、无事务保证」记入风险登记 | 定案(默认) |
| SD-6 edge worker | X14 核证修正:已是 TS + 15 用例,唯一缺口是测试未接 CI → 迭代 0 CI story 接入;Turnstile/配额在其上追加 | 定案 |

### 核证报告要点(2026-07-06,代码级证据)
- 主张 1 成立且更严重:同一会话内搜索读 Neon、选点成交读 Supabase(apps/agent/agent/agents/selected_route.py:32-35),两库 06-23 fork 后零同步——SD-3① 为修复
- 主张 2 成立:三链并存且 schema.ts 与 atlas 迁移间无 drizzle-kit,纯人工同步——SD-1 为修复
- 主张 3 不成立:worker 已是 TS+测试,缺口仅 CI 接线——X14 已修正
- 主张 4 成立:用户域端点在 agent FastAPI(conversations/routes),旧前端 supabase-js 纯 auth,用户表 RLS 有开关无策略——与 SD-2/SD-3 兼容
- 附加:session state 与 message_history 分表、独立写路径、best-effort;都在 Supabase(SD-3④ 待迁)
