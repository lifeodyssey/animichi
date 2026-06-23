# Design Overhaul Retrospective (2026-04-28 → 2026-05-01)

## Summary

Seichijunrei 前端从 "能用但不好看" 到 "系统化的设计体系"。跨 4 天、多个 session、20+ commits、63 files changed。

## Timeline

### Phase 0: Product Pivot (04-28)
**背景：** PR168 完成后（PydanticAI runtime + 800 tests），用户想重新设计前端。

**关键决策：**
- 产品从 chat-first 转为 map-first（chat 降级为 floating popup）
- 路由从单页 AuthGate 拆分为 `/`（Landing）、`/chat`（AppShell）、`/anime/[id]`（Guide）、`/search`
- 决定用 SSR（@opennextjs/cloudflare）替代 static export

### Phase 1: Page-by-Page 重建 (04-28 → 04-30)

| Commit | What |
|---|---|
| `8b42c81` | SSR migration + Landing page redesign |
| `82308eb` | 匿名搜索预览页 /search |
| `2f4f9e2` | Anime guide pages /anime/[id] |
| `7a1348b` | 共享 Spot 组件 + Guide Variant E（Filmstrip + Map） |
| `d85e0fd` | AppShell map-first layout — chat 降为 popup |

**问题：** 每个页面独立开发，没有统一的设计体系。三种 header、两种 card 系统、硬编码的日文字符串。

### Phase 2: 设计方向探索 (04-30)

用户说 "整个设计语言都不太好看，想重新设计一下"。

**探索过程（花了大量 token）：**
1. 尝试暖色系 → 用户说 "感觉不对"
2. 尝试深蓝 → "太深了"
3. 分析京阿尼画面 → 用户说 "我比较喜欢浅蓝色"
4. Wanderlog 参考 → "结构感不错"
5. **最终确定：リズと青い鳥（Liz and the Blue Bird）浅蓝色调**

**关键教训：** 用户不是设计师，对开放式设计问题很困惑。应该给**具体选项**（A/B/C），不要问 "你想要什么感觉"。

**产出：**
- `.impeccable.md` 更新了 Design Context
- `globals.css` 新调色板（oklch 色彩空间，WCAG AA 验证）
- 字体从 Shippori Mincho + Outfit 换为 Noto Serif JP + Noto Sans JP

### Phase 3: Skill-Driven 系统化改造 (05-01)

**重大转折：** 用户发现我之前没有用对应的 skill（"在做刚刚的那些事情的时候你用了对应的skill了吗"）。被要求返工，重新用 skill 一步步来。

**返工前 vs 返工后：**

| 返工前（手动改） | 返工后（skill-driven） |
|---|---|
| 直接改 px→rem，没走 /typeset | 先调用 /typeset，扫描所有文件，系统化替换 |
| 直接写 header，没走 /impeccable craft | 先调 /impeccable craft，TDD + design brief |
| 没做 i18n 审计 | 调用 /harden，系统扫描 8 个硬编码字符串 |

**Skill 执行顺序（最终版）：**

```
Step 1: /impeccable teach    → 视觉方向（.impeccable.md）
Step 2: /impeccable craft    → SharedHeader 重设计（TDD）
Step 3: /typeset             → Perfect Fourth 字体规范（px→rem）
Step 4: /harden              → i18n + accessibility 修复
Step 5: CSS Cleanup（3 skill 联合）
  → /shadcn                  → cn() + gap + Skeleton
  → /tailwind-design-system  → 提取 shadow/overlay/gradient tokens
  → /design-tokens           → 验证 token 完整性
Step 6: /animate             → 审计 + 补齐入场动画 + 提取 CSS 类
Step 7: /critique            → 未做（等全部页面完成）
Step 8: /polish              → 未做（等全部页面完成）
```

### Phase 3a: var() → Tailwind 迁移 (05-01)

发现 421 处 `bg-[var(--color-*)]` 应该用 `bg-primary` 等 Tailwind utility。

**做了什么：**
- 421 `var(--color-*)` → Tailwind 语义类
- 45 `font-[family-name:var()]` → `font-display` / `font-sans`
- 57 `rounded-[var(--r-*)]` → `rounded-sm/md/lg`
- 覆盖率阈值调整：排除 shadcn `components/ui/**`

### Phase 3b: shadcn 合规 + Design Tokens (05-01)

安装了 3 个新 skill：`/shadcn`（118K installs）、`/tailwind-design-system`（38K）、`/design-tokens`（1K）。

**做了什么：**
- 9 处 template literal → `cn()`
- 21 处 `space-y-*` → `flex flex-col gap-*`
- 2 处 `animate-pulse` → shadcn `<Skeleton>`
- 提取 8 个新 token（shadow-xs/sm/md/lg/hero, overlay, marker-active, gradient-soft/hero）
- 33→14 hardcoded oklch（58% reduction, 0 duplicates）

### Phase 3c: Animation 提取 (05-01)

**审计发现：** Landing 和 Guide 动画完整，Search 和 Chat WelcomeScreen 缺入场动画。

**做了什么：**
- 定义 9 个语义 CSS 类（`.entrance-up`, `.entrance-slide-right`, `.entrance-message` 等）
- ~35 处 inline `style={{ animation }}` → CSS class
- 补充 Search 结果列表 + WelcomeScreen 入场动画
- 修复 ChatInput 中 duplicate className bug

### Phase 3d: DESIGN.md + Skill 体系 (05-01)

**做了什么：**
- 生成 DESIGN.md（Google 开源标准格式，YAML tokens + 8 markdown sections）
- 安装 `google-labs-code/stitch-skills@design-md`（40K installs）
- 创建 `/css-audit` skill（CSS anti-pattern 审查）
- 更新 CLAUDE.md CSS Rules（自动加载到每次对话）
- 更新 AGENTS.md 指向 DESIGN.md

---

## 关键数据

| Metric | Before | After |
|---|---|---|
| `var(--color-*)` in className | 421 | 1 (CSS fallback) |
| `var(--app-font-*)` in style | 45 | 0 |
| `space-y-*` usage | 21 | 0 |
| Template literal className | 10 | 0 |
| Hardcoded oklch in components | 33 | 14 (all unique) |
| Inline animation strings | ~40 | 4 (unique one-offs) |
| Design token categories | 3 (color, font, radius) | 8 (+shadow, overlay, marker, gradient, motion) |
| Tests | 517/517 | 517/517 |
| Files changed | — | 63 |

---

## 教训 (Lessons Learned)

### 1. 必须用 Skill，不能手动改

**问题：** 最初手动改字体大小、header、i18n，结果不系统、遗漏多，被用户要求返工。
**教训：** 每个改造步骤必须先调用对应的 skill。Skill 提供了系统化的审计清单和修复流程。
**修复：** 在 CLAUDE.md 的 Skill Routing 里写明每种任务对应的 skill。

### 2. 设计讨论用中文 + 给具体选项

**问题：** 问用户 "你想要什么感觉" 导致大量来回和 token 浪费。
**教训：** 用户不是设计师。给 A/B/C 具体选项（带参考图片），不要开放式提问。
**修复：** Memory 记录了 `feedback_design_chinese.md`。

### 3. 先定 Token，再改组件

**问题：** 早期先改组件样式，后改 token，导致组件和 token 不一致需要返工。
**教训：** 正确顺序是 `视觉方向 → Token 定义 → 组件改造`。
**修复：** 工作流固定为 Foundation → Per-page → Global 三阶段。

### 4. Tailwind v4 的 var() 写法是 anti-pattern

**问题：** 整个项目 421 处 `bg-[var(--color-primary)]` 写法，Tailwind v4 有原生 utility（`bg-primary`）。
**教训：** `@theme inline` 注册的 token 自动生成 Tailwind utility class，不需要 arbitrary value 语法。
**修复：** CLAUDE.md 加了 CSS Rules 禁止 `var(--color-*)` 在 className 中出现。

### 5. inline style={{ animation }} 是 anti-pattern

**问题：** ~40 处 inline 动画字符串，不可复用、优先级过高、难以被 prefers-reduced-motion 覆盖。
**教训：** 动画应该定义为 CSS class（`.entrance-up` 等），inline 只保留 `animationDelay`。
**修复：** 创建了 9 个语义 CSS 类，`/css-audit` skill 检查这个问题。

### 6. 先安装 Skill 再干活

**问题：** 开始做 CSS 清理时没有 `/shadcn`、`/tailwind-design-system` skill，靠经验手动改。
**教训：** 先 `npx skills search` 找相关 skill，安装后再开始工作。
**修复：** 安装了 6 个新 skill（shadcn, tailwind-design-system, design-tokens, design-md, css-audit, find-skills）。

---

## 新增的 Skill / 工具

| Skill | Source | Purpose |
|---|---|---|
| `/shadcn` | shadcn/ui@shadcn (118K) | shadcn v4 组件规范 |
| `/tailwind-design-system` | wshobson/agents (38K) | Tailwind v4 design system |
| `/design-tokens` | julianoczkowski (1K) | Token 完整性验证 |
| `/design-md` | google-labs-code/stitch-skills (40K) | DESIGN.md 生成 |
| `/css-audit` | 自建 | CSS anti-pattern 审查 |

## 新增的文档 / 配置

| File | Purpose |
|---|---|
| `frontend/DESIGN.md` | Google 标准格式的设计规范（AI agent 通用） |
| `~/.claude/skills/css-audit/SKILL.md` | CSS 审查 skill |
| `CLAUDE.md` CSS Rules 段 | 每次对话自动加载的 CSS 规则 |
| `AGENTS.md` Design System 段 | 指向 DESIGN.md |

---

## Token Usage 估算

**注意：** 以下数据基于 sub-agent 报告 + 主对话估算，不是精确计量。

| Phase | Work | Tokens (est.) | Notes |
|---|---|---|---|
| Phase 2: 设计探索 | 颜色方案反复讨论 5+ 轮 | ~200K | 最大的浪费——开放式提问导致大量来回 |
| Phase 3: /impeccable teach+craft | 视觉方向 + Header TDD | ~80K | 正常 |
| Phase 3: /typeset | 字体审计 + px→rem | ~60K | 29 files |
| Phase 3: /harden | i18n + a11y 修复 | ~40K | 审计 + 修复 |
| Phase 3a: var()→Tailwind | 421 处替换 | ~85K | 最大的 sub-agent 任务 |
| Phase 3b: shadcn 合规 | cn() + gap + Skeleton | ~78K | 30 files |
| Phase 3b: Token 提取 | oklch → design tokens | ~65K | 15 files |
| Phase 3c: Animation | 审计 + 提取 CSS 类 | ~120K | 审计 40K + 替换 82K |
| Phase 3d: DESIGN.md | 生成 + skill 创建 | ~50K | 包含 web search |
| Skill loading | /shadcn, /tailwind 等 6 个 skill 的 prompt | ~100K | 每个 skill 加载消耗 ~15K context |
| **Total** | | **~880K** | **约 1M tokens（含 context 压缩前）** |

**最贵的步骤：** 设计探索（颜色讨论）— 如果用 A/B/C 选项而不是开放式提问，至少省 50% token。

**最高 ROI 步骤：** var()→Tailwind 迁移 — 85K tokens 改了 421 处、63 files，每 200 tokens 改一处。

---

## 未完成

- `/critique` — 等所有页面改完后统一做
- `/polish` — 等所有页面改完后统一做
- ResultPanel 迁移 — 还在用旧的 PhotoCard/GridContent，未换成 SpotCard/SpotGroup
- Hero 对比图片 — 需要生成/找到 須賀神社 实景 + 动画对比图
- 剩余 14 个 unique oklch — 复杂渐变和 Mapbox 属性，不可进一步提取
