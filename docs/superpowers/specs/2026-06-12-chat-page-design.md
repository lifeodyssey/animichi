# Chat 页面设计 Spec — 双形态 Generative UI 工作台

> 产出自 /design-consultation,2026-06-12。形态级决策已由用户拍板(D1–D4),
> 本 spec 是实现前的设计契约。视觉规范遵循 frontend/DESIGN.md(動森キャンプ,CI-locked)。
> Mockups: `~/.gstack/projects/Seichijunrei-agent/designs/chat-mockups-2026-06-12/`
> (board.html / v1-workbench.html / v2-camp.html / v3-stream.html,真 token 手写 HTML)。
> 状态清单(实现级契约,每态一条 AC): `2026-06-12-chat-page-states.md`

## 1. 业务梳理(chat 是什么)

对话是手段,**可出发的路线是产物**。chat 不是通用 AI 聊天,是 agent 的外衣。

### 回合类型(后端 7 工具 → 5 种 UI 回合)

| 工具 | 回合 | UI |
|---|---|---|
| `resolve_anime` + `clarify` | 澄清 | 澄清气泡 + 可点选项 |
| `search_bangumi` | 视觉回合 | 点位卡片组 + 地图卡 |
| `search_nearby` | 视觉回合(需定位) | LocationPrompt + 同上 |
| `plan_route` | 视觉回合 | TimedItinerary 路线卡 + 地图路径 |
| `greet_user` / `answer_question` | 纯文字 | 普通气泡 |

**关键业务事实**:`selected_point_ids` 旁路——用户在点位卡勾选后直接重排路线,
不经过 agent。结果面板/卡片本身是输入设备,不只是输出。

## 2. 形态决策(D1–D4 记录)

- 三形态 mockup 对比后:**V2(map-first+狐狸浮窗)淘汰**——该形态属于 Anitabi
  的产品基因;其"狐狸第一人称等待态"作为遗产保留。
- **最终:双形态分期,同一套 generative UI 组件,两个挂载点**:

```
Phase 1  全端 V3 单列流:组件 inline 插入对话流(≈ 移动端最终形态)
Phase 2  桌面 ≥1024px 升级 V1 双栏:同一批组件挂右侧 workspace 面板
          (Artifacts/Canvas 模式 = "活文档":右栏被多轮对话持续修改)
```

V1 仍是 generative UI——registry(intent→组件)不变,变的只是挂载点。

### 记忆点合成(每形态原配 → 最终合成)

主打 **「一句话,拿到能出发的时刻表」**(效率,路线卡海报级),注入两份遗产:
- V2 狐狸语气:等待态由狐狸第一人称叙述("いま Anitabi でさがしてるよ… 8/23")
- V3 透明徽章:足迹行/管线步骤带数据源徽章(Bangumi/Anitabi)与中间结果数

## 3. 路线卡(TimedItinerary)— 形态无关的核心资产

调研结论全部固化于此(两份 Sonnet 调研,2026-06-12):

- **站粒度**垂直时间轴(非"天"粒度——巡礼原子单位是取景地),HH:MM 精确时刻(精确派)
- **散步段独立可见**:绿色 walk 胶囊(`--color-walk-bg/fg`)+ 沿途看点("🚶6分 · 平等院表参道,第2話に登場")
- 节点 = **场景卡**:内嵌动画参考帧缩略图 + 话数 tag(nook-yellow)+ 停留时长
- pacing 章:ゆったり=walk 绿 / 适中=explore 橙 / 紧张=nook-red
- 起点 pin teal 实心、高光站金色★、终点金——沿用首页 RouteTrail 视觉语言
- 金色 CTA **「しおりにして共有」**:完成后导出竖版 9:16 分享图(しおり文化,小红书素材)
- 预留**现场行走态**:当前站置顶放大(Citymapper 范式)——本期不实现,组件状态先留位

## 4. 地图策略:static-first, GL-on-demand

Anitabi 卡顿的反面教材:整页驮 WebGL + 全量 pin。我们:

1. 默认渲染**静态层**:插画风底图(品牌资产)或 Mapbox Static 图,pins + 路径
   为 SVG 叠加层(可被流式更新,零 WebGL)。**静态层永不画 >50 pin**——
   跨圏作品在低 zoom 只画圣地圏泡(面积∝件数),详见 states spec C3b
2. 用户点击地图卡才挂载 Mapbox GL,且只渲染当前路线点位
3. 数据层(投影、pin 布局、升格编排)写 **plain TS**,React 只是适配器

### 4.1 体量实测与实现阶梯(2026-06-12 实测 Anitabi API)

ラブライブ!サンシャイン!! 第2期 **206** 点(实测最重)/ 青春ブタ野郎 126 /
サンシャイン S1 109 / 君の名は。91 / ぼっち・ざ・ろっく! 91 / あの花 86 /
氷菓 63 / ゆるキャン 57 / らき☆すた 42。
**TV 番剧约为剧场版 2 倍,单作品(单季)实测上限 ~200 量级**——"千点"不存在
于策展型数据源。系列合并视图(series-aware resolve,已有 spec)可聚到
300–500,那是虚拟滚动的真实触发点。由此:

- **Phase 1 就做**:圣地圏聚合(≤100 点进程内毫秒级,网格聚类即可,圏名用
  KNOWN_LOCATIONS 最近匹配)、C2g 地理澄清、C3b 圏总览卡——这些是对话与卡片,
  不是性能工程
- **余量设计,推迟实现**:虚拟滚动(<200 行直接渲染)、supercluster GL、
  mega-map——设计已画好(states spec SP 区),数据长到需要时再上
- 可能出现几百点的场景仅:search_nearby 密集区跨作品(半径+LIMIT 封顶)、
  未来的系列合并视图——圣地圏漏斗同样适用
- **系列合并实测**(同日):京吹全系列(S1 228 + S2 153 + S3 70 + 剧场版×2)
  = 499 点;ゆるキャン全系列 = 829 点(实测最重合并)。用生产算法
  `cluster_by_location`(union-find 单链接)去重:10m→309 地点(最大簇 18 张)/
  30m→149(最大簇 128 张 ⚠)/ 50m→115(最大簇 135 张 ⚠)——单链接在系列合并
  密度下**链式过併**(整条街连成一簇)
- **双阈值决策**:SpotPicker 卡片用 **10m 机位级**(每簇截图 ≤~20,filmstrip
  可承受);路线 TimedStop 用 **50m 停留点级**(现有默认不动)。UI 单位永远是
  物理地点而非截图:829 截图 → 300-500 地点,仍在直接渲染射程内

## 5. Headless 约束(Anitabi 回贡献路径)

- 所有 chat 组件按既定 shadcn 模式:headless 逻辑核 + 動森 token 皮
- 地图性能核(§4-3)保持框架无关,未来可整体贡献给 Anitabi(我们是其 API
  消费者,CC BY-NC-SA;回贡献性能核 = 上游公民 + 数据合作铺路)
- 多框架打包/文档**不做**,等与 Anitabi 实际接洽后再投入;现在只守住
  "核不焊死在 React"这一条

## 6. 等待态(State2 spec 翻新)

2026-05-08 state2 spec 的交互骨架沿用,リズ淡蓝配色作废,改動森 token:

- 管线步骤:done=teal ✓ / running=gold + shimmer / waiting=muted
- 纯文字回合不出 skeleton;视觉工具开跑右栏才出 skeleton
- 完成后管线折叠为一行**足迹**(带数据源徽章 + 用时),可展开
- 等待 ≥4s:**作品情绪卡**(台词/场景帧,如「上手くなりたい…」高坂麗奈·第8話)
- 狐狸第一人称叙述贯穿(§2 遗产)

## 7. 组件清单(registry 注册)

气泡(user=nook-teal tile / ai=cream)、管线卡+足迹行、作品情绪卡、点位卡
(勾选=selected_point_ids 入口)、地图卡(static-first)、路线卡(§3)、追问
chips(nook 三色 tile,按压影)、chat 输入(pill+input 影+explore 橙发送)、
LocationPrompt、FeedbackButtons。铁则:按压影只给按钮/输入,卡片浮起。

## 8. 未决事项(不阻塞 Phase 1)

- 登录墙问题(critique P2,docs/todo.md)——chat 入口是否允许未登录试用
- 流式协议:Vercel AI SDK 迁移曾 revert(79f34a8),Phase 1 实现前需重新定案
- しおり导出的具体排版(另开设计任务)
- 现场行走态完整设计(Phase 3+)
