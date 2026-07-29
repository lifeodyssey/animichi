# 设计工具箱 (2026-06-20)

脱离 baoyu AI 图那条路,改用专业设计 skill + 动效/组件库来认真搞设计。

## 已装设计 Skills(Claude Code,Skill 工具直接调)
| skill | 干嘛 | 调用 |
|---|---|---|
| `impeccable` | 颗粒化设计命令(critique/audit/polish/typeset/layout/animate/colorize…) | `/impeccable <cmd>` |
| `design-taste-frontend` | 反 slop 落地页/重设计,整体直出有方向的界面 | auto / Skill |
| `hallmark` | 反 AI 味:greenfield / audit / redesign + 从 URL/截图**提取设计** | `/hallmark` |
| `superdesign` | 资深前端设计 agent:ASCII 线框→OKLCH 主题→动效→单文件 HTML,**并行变体** | Skill |
| `ui-ux-pro-max` | UI/UX 智库:50+ 风格 / 161 配色 / 57 字体对 / 99 UX 指南 / 25 图表 | auto / Skill |
| `ui-design-brain` | 60+ 真实 UI 组件模式 + 最佳实践 | auto |
| `design-lab` | 设计访谈 → 5 个变体 → 收反馈 → 实现计划 | `/design-lab` |
| `make-interfaces-feel-better` | UI 打磨:hover/阴影/边框/排版/微交互/进出场动画 | auto / `/make-interfaces-feel-better` |
| `emil-design-eng` | Emil Kowalski 的 UI 打磨哲学(看不见的细节) | `/emil-design-eng` |
| `review-animations` | 动效代码评审(高 craft 标准,手动调) | `/review-animations` |
| `ui-skills-root` | UI skills 注册表路由 | `npx ui-skills start` |
| `better-icons` | 20 万+ Iconify 图标 CLI/MCP | `npm i -g better-icons` |

## Codex Skill
- **`image2_UI_skill`** — 图/设计稿 → 可点击 UI demo。已 clone 到 `~/.codex/skills/image2_UI_skill`,**重开 Codex 会话后生效**。

## 动效 / 组件库(用到时 `npm i` 进项目,不是全局 skill)
| 库 | 用途 | 装 |
|---|---|---|
| GSAP | 重型时间线 / 滚动劫持动效 | `npm i gsap` · gsap.com |
| Motion (motion.dev) | React 主力动效 `motion/react` | `npm i motion` |
| Animate.css | 现成 CSS 入场动画 | `npm i animate.css` |
| react-spring | 物理弹簧动效 | `npm i @react-spring/web` |
| Hover.css | 现成 hover 效果 | `npm i hover.css` |
| matter-js | 2D 物理引擎(掉落/碰撞/拖拽) | `npm i matter-js` |
| performativeUI | AI-native React 组件库 40+ | vorpus.github.io/performativeUI |
| math-curve-loaders | 数学曲线加载动画(纯 HTML/CSS/JS,零依赖) | github.com/Paidax01/math-curve-loaders |

## 装不了 / 需付费
- **motion.dev/docs/ai-kit**(Motion Studio MCP)—— 付费,要 Motion+ 订阅 `MOTION_TOKEN`;需要的话订阅后 `npx -y add-mcp`。
