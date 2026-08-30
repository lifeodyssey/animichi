# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

动漫圣地巡礼者(アニメ聖地巡礼),两条入口渠道:中文小红书圈(图片导向,外链不友好)和日本 X 圈(链接卡导向)。两类用户都在"现场"完成核心行为:对照动画截图找机位、打卡、发帖。设计必须服务"站在户外强光下、单手、可能弱网"的现场用户。

## Product Purpose

Seichijunrei = 动漫圣地巡礼的「现场作战系统」。一句话(作品名) → 一张能直接出发的站粒度时刻表路线,然后陪用户走完并生成分享物。核心价值在现场(走的那一刻),不在规划。产品是环不是漏斗:每个走完的用户产出分享物(9:16 竖图しおり + 免登录公开页),回流成下一个人的入口。

## Positioning

不是泛用 AI 旅行规划器。机制差异:作品名 → 时刻表粒度路线(HH:MM 站粒度、散步段可见、场景帧对照),且免登录可看可改,登录只为"把路线带去现场"(跨设备连续)。

## Operating Context

- 规划在桌面/chat,执行在手机 Walk Mode(户外、单手、弱网、离线包)
- 入口:分享物(小红书竖图/X 链接卡)→ 免登录公开页 → chat 改装
- 出口:しおり 9:16 竖图(直接入相册)+ 公开分享页
- 全产品日文 UI 为主(中日用户都看日文),狐狸 コンちゃん 是第一人称叙述者

## Capabilities and Constraints

- TanStack Start SSR apps/web;catalog/users CF Workers;Neon 数据面;oRPC 契约
- 移动端 `/` 首效应交接给 `/chat`;桌面端 `/` 是访客首页
- 地图 static-first(静态层永不画 >50 pin),MapLibre 点击才升格
- 测试地板:单测 2339 用例,coverage statements 98 / branches 95 / functions 98 / lines 99,只升不降
- 登录墙只在"保存"一刻(Neon Auth magic link)

## Brand Commitments

- 名称 Animichi(聖地巡礼);狐狸向导 コンちゃん 是品牌人格
- 视觉方向(2026-08-29 用户确认):忠实上游 animal-island-ui 的绿底动森风——叶绿 #6eb68e 地面 + 叶纹、奶油卡、teal #19c8b9 交互、金 #f5c31c CTA、棕 #827157 文本
- 吉祥物(2026-08-29 用户确认):极简扁平狐(橙 #e8742e + 奶白 #f8f8f0,绿底/透明底),阵容 P2 眯眼探头 / J1 欢呼 / L1 趴趴探头,素材在 public/images/mascot/

## Evidence on Hand

- 产品旅程与状态机:`docs/design/user-journey.md`(5 段 18 断点,Walk 是审判时刻)
- 设计方向稿:`~/.gstack/projects/lifeodyssey-Seichijunrei-agent/designs/home-20260829/variant-E.png`(已批准)
- 设计系统参照:`docs/design/animal-island-ref/`(4 份规范)
- 无真实用户评价/数据——未来工作不得编造 testimonials 或指标

## Product Principles

- UI stays quiet, content speaks:照片和地图出彩,UI 安静
- 没经过 agent 的事不演 agent 的戏
- 户外现场是一等公民(大字、高对比、单手、可离线)
- 永不裸 alt / 永不裸错误:每个失败都有兜底和人话文案
- 环的每一断点都要问:这一屏是在帮环往前转,还是卡住它

## Accessibility & Inclusion

WCAG AA 对比度全量实测(注释在 globals.css token 层);prefers-reduced-motion 必须有无动效替代;Walk Mode 户外强光可读性是一等约束。
