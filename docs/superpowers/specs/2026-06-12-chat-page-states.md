# Chat 页面状态清单(State Inventory)

> 配套 `2026-06-12-chat-page-design.md` 的实现级状态契约。
> 每个状态 = 一条可测 AC(unit/browser),命名沿用此处编号。
> 视觉值全部引用 globals.css token,不出现裸色值。

## 0. 四层状态模型

```
页面级 (A)   进入方式决定初始画面
  └ 回合级 (B)   一次发送的生命周期:composing → running → streaming → settled
      └ 内容形态 (C)   settled 时由 intent 决定渲染哪批卡片(registry)
          └ 卡片级 (D/E)   每张卡自己的子状态(skeleton/就绪/过时/错误)
输入区 (G) 独立正交,贯穿所有层
```

回合状态机:

```
composing ──send──▶ sending ──▶ running(B2a→B2b→B2c 按时长升级)
    ▲                              │ 视觉工具开跑 ──▶ +skeleton (B2d)
    │                              ▼
    └──settled ◀──streaming ◀── tool 完成
         │
         ├─ error(D4/D5/D6)──retry──▶ running
         └─ 追问/勾选 ──▶ 新回合(E1/E2)
```

## A. 页面级(进入方式)

| # | 状态 | 触发 | 长什么样 | 退出 |
|---|---|---|---|---|
| A1 | 冷启动空态 | 已登录,无历史 | 狐狸 AI 气泡问候 + 3 枚 nook tile 示例 chips + input 自动聚焦。P2 右栏:虚线框(`--color-border` dashed)+ 🗺️ +「作品をきくと、ここに地図とルートが現れます」 | 发送→B |
| A2 | 带 query 进入 | 首页搜索框提交跳转 | 进页即渲染 user bubble + 直接进 B2(不重复打字);URL 带 `?q=` | →B2 |
| A3 | 恢复历史会话 | 再访/会话列表进入 | 历史消息全量渲染:旧管线一律折叠为足迹行;滚动锚定到底部;最后一张路线卡保持 settled 态 | 任意交互 |
| A4 | 未登录访问 | 无 session | **未决**(critique P2 登录墙,docs/todo.md)。占位方案:重定向 /login。倾向方案:允许 1 次试用回合后弹登录,本期不实现 | — |
| A5 | 后端不可达 | /healthz 失败或首请求网络错误 | 页面可见但顶部 banner(`--color-error` bg / `--color-error-fg` 字):「サーバーに接続できません · 再試行」;input 禁用 | 重试成功→A1 |

## B. 回合级 — 分级等待(核心体验)

| # | 状态 | 触发 | 长什么样 |
|---|---|---|---|
| B0 | composing | 默认 | 见 G 输入区 |
| B1 | sending | 点发送 | user bubble 乐观渲染(nook-teal tile,右对齐,圆角 18/右下 6);input 立即清空;发送键播放按压动画(下移 4px,影消失,`--duration-fast`) |
| B2a | running <1s | agent 开跑 | 仅狐狸 typing 指示:狐狸头像 + 三点跳动。**不出管线**(短回合不值得仪式感) |
| B2b | running 1–4s | 持续运行 | 升级为管线/足迹 building 态:步骤逐个点亮——done=teal 圆✓,running=gold 圆+shimmer 条(`--color-muted`→#e2d6bb 流动),waiting=muted 圆;每步带数据源徽章(Bangumi/Anitabi,muted 小 pill);狐狸第一人称副标题(「いま Anitabi でさがしてるよ… 8/23」) |
| B2c | running ≥4s | 长等待 | 管线下追加**作品情绪卡**:该作台词/场景帧渐变底,白字+text-shadow,出处行(「— 高坂麗奈 · 第8話」);`.entrance-up` 入场 |
| B2d | 视觉工具开跑 | search_* / plan_route 启动 | P1:流中先插入对应卡片的 skeleton(`--color-muted` pulse);P2:右栏出 map band skel + 3 张卡 skel。**纯文字回合永不出 skeleton** |
| B3 | streaming | 文字开始返回 | AI 气泡打字机效果;generative 卡片按 parts 到达逐个 `.entrance-up` 落位;自动跟随滚动(用户上滚则停跟,出「↓ 最新へ」浮钮) |
| B4 | settled | 回合完成 | 管线折叠为足迹一行(「✓ タイトル確認 → 23スポット → ルート作成 **9.2s** · 詳細を見る ▾」,可展开);追问 chips(nook 三色 tile)+ 👍👎 出现;input placeholder →「続けて話す…」 |

## C. 五种回合内容形态(settled 渲染什么)

| # | intent | 渲染(按序) |
|---|---|---|
| C1 | greet / answer | 仅 AI 气泡。无卡、无 skeleton、无足迹(单工具瞬时完成时 B2a 直达 B4) |
| C2 | clarify | ClarificationBubble:AI 气泡 + 2–4 个候选按钮(cream 按压按钮,`--shadow-3d-md`,44px)+ 逃生口「都不是,我重新说」(ghost 文字钮)。点选后候选变为 user bubble,其余候选淡出 |
| C2g | clarify(地理) | 跨圏作品且用户未指明区域:候选 = 圣地圏按钮(圏名 + 件数 pill,按件数降序 top3 +「その他 N 圏 ▾」展开)。用户消息已含位置 → **跳过此回合**,agent 自动选圏 |
| C3a | search_bangumi 集中型 | 触发:点位包络 ≤50km(单圏)。点位卡组 top-6(按人气/有图排序)→ 地图卡(static)→ AI 总结。「すべて見る →」开全列表:**虚拟滚动**,GroupToggle 按话数/区域分组,DOM 永不渲染全量 |
| C3b | search_bangumi 分散型(圣地圏总览) | 触发:圏数 ≥2 或包络 >50km(如『君の名は。』全国 1,000+ 件)。渲染:全国概览地图卡——**只画圏泡**(teal 圆,面积∝件数,白字数量徽章;静态层永不画 >50 pin)+ 圣地圏卡组(圏名、件数、代表圣地 2-3、「この圏で絞り込む」cream 钮)。选圏 → C3a。GL 升格后才有 supercluster 点级聚合 |
| C4 | search_nearby | 先 LocationPrompt 卡:用途说明 +「位置情報を許可」(gold)+「場所を入力する」fallback(cream)。授权后同 C3;拒绝→fallback 输入 |
| C5 | plan_route | 路线卡(海报级,见 design spec §3)→ 地图卡带路径 → AI 总结 → 追问 chips |

## D. 异常与边界(9 态)

| # | 状态 | 长什么样 |
|---|---|---|
| D1 | 作品识别失败 | AI 气泡道歉 + 建议(确认拼写/试原文名/给一句剧情我来猜)+ 示例 chips 重现。狐狸副标题「うーん、見つからない…」 |
| D2 | 0 圣地收录 | 「この作品はまだ Anitabi に聖地が登録されていないみたい」+ 相邻推荐 chips(同制作社/同圣地城市作品) |
| D3 | 点位 <3 难成路线 | 仍出点位卡组;AI 说明 + 提议 chips「近くの別作品も足す?」 |
| D4 | 网络/流中断 | 中断处 inline 重试条:error token 底/字 +「接続が切れました · 再試行」。**已渲染内容保留**,重试只续跑未完步骤 |
| D5 | agent 超时(60s) | 同 D4 形态,文案「時間がかかりすぎているみたい · もう一度」 |
| D6 | 校验拒绝(ModelRetry 耗尽 / output_validator) | 通用道歉气泡 +「言い方を変えてみて」+ 重试钮。不暴露技术细节 |
| D7 | 地图静态图加载失败 | 卡内占位插画(自绘 SVG 兜底,永不裸 alt)+「地図アプリで開く」外链 |
| D8 | session 过期 | inline 登录提示条(warning token),**对话内容不丢**;重新登录后原地恢复 |
| D9 | 场景帧 404(Anitabi 图床) | scene-thumb 退化为渐变占位 + 话数文字(mockup 即此做法,作为正式兜底) |

## E. 交互过程态(多轮/旁路)

| # | 状态 | 长什么样 |
|---|---|---|
| E1 | 追问细化(活文档更新) | **P1 V3**:旧路线卡降为过时态(opacity .55 + 左上「以前の版」角标),新卡落底部——流即历史,不原地改写。**P2 V1**:右栏卡片原位更新,变更行 nook-yellow 背景 flash 1s(`--ease-animal`)——面板即活文档 |
| E2 | 勾选重排(selected_point_ids 旁路) | 点位卡勾选变化 → 底部浮出 sticky 操作条「5 件選択中 ·『ルートを組み直す』(gold)」→ 路线卡仅时间轴区域 skeleton → 足迹行只显示「再計算 1.2s」(无管线——没经过 agent 就不演 agent 的戏) |
| E3 | 站点↔地图锚定 | P2:hover 消息/站行 ↔ 地图 pin 弹跳放大(双向);P1:点站行 → 平滑滚到地图卡 + pin 弹跳 |
| E4 | しおり导出 | 按钮 loading(按压保持态)→ 竖版 9:16 预览 modal(`--shadow-popup`,scrim `--color-overlay`)→ 保存/分享/关闭 |
| E5 | 地图 GL 升格 | 静态图右下角「地図を操作 ↗」pill → 点击 → 角落小 spinner(不遮内容)→ GL 无缝接管,pins/路径连续。失败→静态图保留 + toast |

## F. Phase 2 双栏附加态

| # | 状态 | 长什么样 |
|---|---|---|
| F1 | 右栏空(冷启动) | A1 描述的虚线框 quiet 态 |
| F2 | 右栏 skeleton | B2d 的右栏形态 |
| F3 | 锚定就绪 | AI 气泡含「→ 右のルートを見る」链接(teal 下划线);hover 消息高亮右栏对应卡(边框 `--color-primary` 1.5px) |
| F4 | 宽度回流 | <1024px:右栏组件回流进消息流原位(同组件换挂载点);滚动位置保持当前阅读消息 |

## SP. 选点工作台(SpotPicker)—「すべて見る」/「この圏で絞り込む」的目的地

形态:P1 V3 全屏 takeover(从流上滑入,「← チャットに戻る」返回);P2 V1 右栏原位
变形。移动端:列表全屏 + 右下「地図」浮钮切视图,托盘 sticky 底部。
Mockup: `spot-picker.html`。

**核心区分:浏览排序(sort)≠ 路线顺序(order)。**

| # | 状态 | 长什么样 |
|---|---|---|
| SP1 | 浏览主态 | 头部(返回 + 标题「聖地を選ぶ — 作品 · 圏 N件」+ 圏内搜索)/ 工具条(GroupToggle 話数⇄エリア 分组 + 並び順下拉 + 「写真あり」filter chip)/ 左列表 + 右地图。列表 ≤300 行直接渲染(实测单季最重 206 点,见 design spec §4.1);虚拟滚动在系列合并视图落地时引入;图片一律懒加载 |
| SP2 | 浏览排序 | 並び順三档:**おすすめ**(有图+截图数加权,默认)/ **話数順**(ep,s)/ **駅から近い順**。只影响列表顺序,不影响路线 |
| SP3 | 选中托盘 | sticky 底部:N 件選択中 + 横向缩略卡(序号圆标 + 拖拽柄 ≡)+ 步行/距离/时段估算 + 金色 CTA「このN件でルートを組む」。0 件时托盘收起 |
| SP4 | 路线顺序模式 | 托盘内 segmented:**おまかせ順**(最近邻,默认)/ **物語順**(按 ep,s 剧情序)/ **手動**。物語順步行代价超阈值 → warning 提示条「物語順だと徒歩 +40分(3.8→6.1km)」,可一键回おまかせ |
| SP5 | 拖拽排序中 | 被拖卡片抬起(rotate -2.5° + shadow-lg + teal 边框),插入位显示 teal 竖条;**任何拖拽 → 顺序模式自动切「手動」**;托盘序号与地图 pin 序号实时同步 |
| SP6 | 应用重排 | CTA → 走 E2 旁路(selected_point_ids + 顺序模式,无管线戏,「再計算 1.2s」)→ 返回流,路线卡按 E1 规则更新 |
| SP7 | 列表↔地图锚定 | hover 行 ↔ pin 放大(同 E3);已选 pin = teal 实心 + 顺序序号,未选 = 空心描边 |
| SP8 | 大规模模式(>100 地点自动切换) | 选点反转为**编辑草稿**:顶部 =「いまのルート案」(agent 已选 8 件,每件有「入れ替え」→ 弹 3 个同区域同时间成本的邻近候选,局部替换永不全局重选)→「名場面 TOP」横滚(按カット数)→ 其余折叠为区域组头(件数+3 缩略,**永不平铺**)。地图侧变主导航:子区域泡(件数)→ 下钻 pin → 预览卡 → 追加。季节 chips 过滤(S1/S2/S3/劇場版) |
| SP9 | 锚点委托 | 用户标 1-3 个「絶対行く」📌 →「残りはおまかせで埋める」chip → agent 围绕锚点 + 时间预算重新补全草稿(走 agent 回合,有管线戏)。chat 产品独有的选点方式:把"从 300 选 8"变成"说出 2 个必去 + 委托" |

## G. 输入区(正交)

| # | 状态 | 长什么样 |
|---|---|---|
| G1 | 默认 | pill 形,`--color-surface` 底 + border + `0 4px 0 0 --color-input-shadow`;placeholder muted-fg |
| G2 | 聚焦 | focus ring:2px `--color-focus` + `--shadow-focus-glow` |
| G3 | 有文字 | 发送键激活:explore 橙 + 按压影。空文字时发送键 muted 底/muted-fg(无按压影=不可按的视觉语义) |
| G4 | 回合运行中 | **input 可继续输入,发送键禁用**(muted),placeholder「考え中…」。不做排队发送(P1 简化);Esc/停止钮本期不做 |
| G5 | 发送失败回填 | 失败的文字回填进 input(不让用户重打),光标定位末尾 |

## H. 状态级决策记录

**已决**(有异议随时推翻):
- 千点策略 = 对话漏斗:作品 → 圣地圏(C2g/C3b)→ 圏内点位(C3a top-6 + 虚拟列表)→ 路线(≤8 站,永远圏内)。"全部 1,042 件"只存在于圏泡数字里,**永不平铺**。后端 `LocationCluster` 是微观聚合(同点多截图),宏观圣地圏为新增数据层
- G4 运行中=可输入不可发送(最小惊讶;排队发送复杂度后置)
- 路线顺序三档(SP4):おまかせ(最近邻)/ **物語順(剧情序,竞品无此模式,利用 ep+s 数据)** / 手動(拖拽)。物語順显示步行代价,尊重用户选择不阻止
- 微观聚类双阈值(系列合并实测后定):SpotPicker 卡片 = **10m 机位级**;路线 TimedStop = **50m 停留点级**(`cluster_by_location` 现有默认)。单链接 50m 在系列合并密度下会链式过併(最大簇 135 张),故选点层必须用细阈值。详见 design spec §4.1
- E1 双轨:V3 流追加新版本(流即历史)/ V1 右栏原位更新(面板即活文档)——同一数据,两种挂载点语义
- E2 旁路不演管线戏:没经过 agent 的操作不显示 agent 过程,只给再計算用时

**未决**:
- A4 登录墙(critique P2,产品决策,docs/todo.md 已记)
- B 各时长阈值(1s/4s/60s)上线后按真实 agent 延迟分布调参
