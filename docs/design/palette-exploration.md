# 首页配色方向探索 (2026-06-19)

**状态:决策待定。** 首页已恢复到 6473916 衬线单页(commit `f47a17f`)。因为脱离 `animal-island-ui` 库,配色从"微调"升级为"重选方向"。

## 已锁的一点
- 地色 `--color-bg: #f7f1e6`(暖羊皮纸,app 自有意图;`design-token-alignment.test.ts` 已收窄到只断言交互色 teal/gold/error)。
- 但整体 palette 在重选,地色也可能随方向改 —— 见下 5 个候选,grounds 已各不相同。

## 5 个候选方向
真实 hex(来自命名出处的社区/品牌色板),正文对 ground 对比度全过 WCAG AA;CTA 统一暖橙,和橙狐狸+鸟居同一条暖红线。

| 方向 | 出处 | ground | surface | text | primary | accent | cta |
|---|---|---|---|---|---|---|---|
| A · Island Pop | あつ森 ACNH | `#FFFBF0` | `#FFFFFF` | `#4A3B2E` | `#17A89E` | `#56BA5A` | `#FF8A3D` |
| B · Cinnamoroll Sky | 三丽鸥 玉桂狗 | `#EAF4FB` | `#FFFFFF` | `#2E4A66` | `#2F9FD6` | `#F9C9DD` | `#FF9E45` |
| C · Sakura Mochi | 桜色 日本传统 | `#FFF0F4` | `#FFFBFC` | `#5A3A4A` | `#E86A8C` | `#7FC8C0` | `#FF8A4C` |
| D · Splatoon Pop | スプラトゥーン | `#FBF7FF` | `#FFFFFF` | `#2B2440` | `#7A3CF0` | `#2BD66E` | `#FF6B2C` |
| E · Doraemon Clean | ドラえもん/宝可梦 | `#FFFFFF` | `#F7FAFD` | `#1F3A52` | `#0E84C4` | `#FFCB05` | `#FF7A2F` |

**倾向(按"可爱+游戏感"):** C 樱粉最甜 / B 天空蓝最清新 / D 斯普拉遁最游戏。E 偏干净产品,A 是现状亮化。**未定。**

## 分享预览
- https://sharehtml.zhenjia.dev/s/7h4m2AU9eH （5 版迷你 hero,匿名存至 2027-06-19）
- claimToken: 本地保管，不入库（登录后认领/管理用）
- 本地存档:`agent-review/palette-preview.{html,png}`、`palette-compare.png`

## 参考资源
- **DESIGN.md 库:** github.com/voltagent/awesome-design-md — 73 个真实 DESIGN.md(Google-Stitch 格式),含 Nintendo / PlayStation / Stripe 等,可拿来当我们自己 DESIGN.md 范本。
- `dembrandt`(一条命令把任意网站抽成 DESIGN.md)、nipponcolors.com(日本传统色)、ColorHunt /pastel、Game UI Database。

## 下一步
1. 定方向(报字母)→ 套真首页(弯线/狐狸/真对照卡)精修明暗+hover/active+对比度。
2. 落进 `frontend/app/globals.css` 的 `--color-*`。
3. 脱 `animal-island-ui` → 退掉 `--animal-*` 契约测试(它只为跟那个包同步而存在)。
