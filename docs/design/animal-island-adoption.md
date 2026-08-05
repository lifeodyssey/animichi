# animal-island-ui-tailwind 组件采纳映射表（C10 · 终稿）

> C10 卡主产物。目的：把 `apps/web` 里「手搓了库中已有对应物」的 UI 换成
> `animal-island-ui-tailwind`（v1.4.1）的组件。判据（owner 原话）：**前端一定要做得和
> 设计稿一模一样** —— 与 mockup（`docs/design/2026-07-06-design-sync/`）一致优先于
> 「用上库组件」。不改设计。库正典：`node_modules/animal-island-ui-tailwind/AI_USAGE.md`
> （prop 全部逐字来自源码，禁止发明 prop）。

## 0. 终局结论（先读这个）

上一轮把 4 个落点换成了库组件并**自行为 owner 接受了 5 项视觉增量**（height 45px、
凭空 box-shadow、font-family 切库栈、display:inline-flex、children 多包一层 `<span>`），
且用 3 处 node_modules 手改 shim 让门禁「通过」—— 终审判定双重违规。本终稿：

1. **4 处替换全部退回原生实现**（`git checkout HEAD -- <6 文件>`，详见 §4 处置表）。
   退回不是「不想用库」，而是 brief 默认规则「偏离设计稿就不替换」+ 终审指令
   「增量退回、值得的单列提议，不自行实施」。退回后**零视觉增量、零语义损失**。
2. **4 条采纳提议单列于 §8 交 owner 定夺**（每条附接受增量清单与实施前置），未实施。
3. **3 处 shim 已全部清除**，node_modules 恢复纯净（`rm -rf node_modules` +
   `pnpm install --frozen-lockfile --offline`，0 downloads，取证见 §5）。
   上一轮「pnpm store 无 tarball 装不上」的结论**是误判**：store 里其实有全部所需
   包（含 `@radix-ui/react-separator@1.1.11`），shim 从未有必要存在。
4. **门禁全部在未篡改环境重跑通过**（§7）。
5. 本卡的代码净变更 = **零**（全部退回）；产物 = 本表 + 层叠结论 + 增量处置 + shim 取证。

## 1. 层叠验证结论（静态分析；接入点方案本身有效）

**层叠方向 = 仓库样式恒胜，库样式只补齐仓库未声明的属性。** 依据：

1. 库 CSS 全部规则作用域化：唯一 `@layer base` 规则是
   `[class^=animal-], [class*=" animal-"] * { box-sizing: border-box }`，全文件无未作用域
   的元素选择器 → 引入库样式不会重置仓内任何非 `animal-` 元素。
2. 无全局 reset（无 preflight）。全局副作用仅 `@layer properties` 的 `--tw-*` 初始值
   （仓内无规则读取）与 9 条 `@font-face`（见下条，这是本轮新发现的坑）。
3. **仓内 unlayered 裸规则（`landing.css` / `chat.css` / `globals.css` 手写类）恒胜于任何
   layer**；仓内 Tailwind utility（`@layer utilities`）胜于库 `@layer components`（层序
   theme < base < components < utilities 两表一致）。→ 仓内类声明了某属性，库值即被覆盖；
   **仓内类没声明的属性，库值会泄漏进来**（这是上一轮漏掉的风险类，§2 逐属性列出）。
4. token 名分离：仓内 `--color-*`（teal 品牌系）/ `--app-font-*`，库 `--animal-*`（奶油系）。
5. 接入点：`__root.tsx` 的 `?url` style link 在 `globalsUrl` 之后、早于组件渲染，顺序确定，
   是对 AI_USAGE §0「app 入口一次导入、先于组件使用」的同效实现——方案本身验证无误。
6. **新增发现：库 @font-face 与仓内 fonts.css 同族同名（Nunito / Noto Sans SC / Zen Maru
   Gothic），style link 在后 → 浏览器按文档序用库的 woff2 覆盖仓内同族字体文件**；且
   仓内 `--app-font-body` 含 `"Zen Maru Gothic"`、库栈不含 → 日文正文字形切换。上一轮把
   库字体文件 stub 化导致浏览器跳过坏字体，**恰好掩盖了这个冲突**。结论：在没有任何库
   组件被采纳之前，style link 无收益且有字体接管风险 → **随组件替换一并撤回**；采纳卡
   的前置 = 先解 @font-face 冲突（子集化或错开 family 名），再上 link。

## 2. 残留风险清单（逐属性：仓内声明了 → 不泄漏 / 未声明 → 库值泄漏）

> 判定依据：库规则 `dist/index.css`（`.animal-btn` / `.animal-btn-middle` /
> `.animal-card`）vs 仓内 `chat.css` / `landing.css` / globals utility。本清单为
> **假如采纳**时的泄漏全集，也是 §4 退回的逐条依据。

### 2.1 Button 组（`.animal-btn` + `.animal-btn-middle`，影响 #1 #2）

| 属性 | 库值 | 仓内类是否声明 | 结果 |
|---|---|---|---|
| `height` | 45px 固定（middle） | 否（`chat-fallback__retry` 仅 `min-height:44px`；`chat-clarify__option` 靠 padding 撑 ≈29px） | **泄漏**：#2 高度 +55% |
| `box-shadow` | `var(--animal-shadow-sm)`（hover 换 `--animal-shadow-base`） | `chat-fallback__retry` 声明（3D 阴影，胜）；`chat-clarify__option` **未声明** | **泄漏（仅 #2）**：凭空长出阴影 |
| `font-family` | `var(--animal-font-family)`（Nunito, Noto Sans SC, HarmonyOS Sans SC, MiSans, -apple-system, PingFang SC, Hiragino Sans…，**无 Zen Maru Gothic**） | 两仓内类均未声明 | **泄漏**：三语 app 中日文正文字形切换 |
| `display` | `inline-flex` | 均未声明 | **泄漏**：block → inline-flex |
| `font-weight` | 600 | 均未声明 | **泄漏**：继承 400 → 600 |
| `letter-spacing` | .02em | 均未声明 | **泄漏** |
| `line-height` | 1 | 均未声明 | **泄漏** |
| `white-space` | nowrap | 均未声明 | **泄漏**：长文本不换行 |
| `transition` | all, 时长 `--animal-motion-duration-base` | 均未声明 | **泄漏** |
| `position` | relative | 均未声明 | **泄漏**（布局上下文） |
| `user-select` / `outline:none` | none | 均未声明 | **泄漏**（focus-visible 由库补回） |
| `border` / `border-radius` / `background` / `color` / `padding` / `cursor` | pill 半径、透明边框、奶油底 | 两仓内类均声明 | 不泄漏（unlayered 胜） |
| hover 态（`.animal-btn-default:hover:not(:disabled)`） | color→teal、border→teal、box-shadow 换、`translateY(-1px)` | #1 无 hover 规则；#2 仅声明 hover background | **泄漏**：#1 整体 hover 外观变化；#2 在背景上叠 teal 字/边框/上浮 |
| children 结构 | **label 恒包一层 `<span>`**（`Button.js`：`e("span", { children: l })`） | — | **泄漏（结构性）**：文本选择器/间距上下文变化 |
| `aria-busy` / `aria-disabled` | loading 态注入 | — | 不泄漏（语义增强，非视觉） |

### 2.2 Card 组（`.animal-card`，影响 #3 #4）

| 属性 | 库值 | 仓内类是否声明 | 结果 |
|---|---|---|---|
| `cursor` | pointer | 均未声明 | **泄漏**：#3 整卡、#4 相框 hover 变手型 |
| `font-weight` | 500 | #3 的 `<h2>` 未声明（`<p>`/`<a>` 有 font-bold，胜）；#4 `.comparison__tag` 自带 `--app-font-display` + 700（胜） | **泄漏（仅 #3 的 h2）**：400 → 500 |
| `transition` | all .3s | 均未声明 | **泄漏** |
| hover `translateY(-2px)` | 上浮 | #3 无 transform 规则 → **泄漏**；#4 的 `transform: rotate(3deg)` unlayered 胜 → 被压住，不泄漏 | **泄漏（仅 #3）** |
| `color` | `var(--animal-text-color-body)` | #3 的 h2/p/a 与 #4 的 tag/handle 均自带颜色类 | 不泄漏（子元素全覆盖） |
| `background` / `border-radius` / `padding` | 奶油底 / 20px / 16px 24px | #3 以 utility（`bg-[var(--color-card)]` / `rounded-2xl` / `p-4`）声明 → utilities 层胜；#4 以 unlayered 类声明 | 不泄漏 |
| `font-family` | **未声明**（.animal-card 无 font-family） | — | 不泄漏 |
| 语义 | **只渲染 `<div>`**（Card.js 无 section 分支） | #3 原为 `<section aria-labelledby>` landmark | **泄漏（无障碍语义）**：换组件即丢 landmark；保留 aria-labelledby 在 div 上失效 |

### 2.3 汇总

- **不泄漏**：border/border-radius/background/color/padding/cursor（Button 组因仓内类全声明）；
  Card 组的底色/圆角/内边距（utility / unlayered 胜）；hover transform（#4 被 unlayered 压住）。
- **泄漏 = 全部 5 项终审点名的增量 + 本表其余行**。上一轮 doc 两处结论错误，一并更正：
  §0「font-weight:500 对比较滑块标签继承」——标签自带 font-family/weight，实际不泄漏；
  §0「库字体与仓内同族、stub 后无视觉影响」——是 stub **掩盖**了 @font-face 接管冲突（§1.6）。

## 3. 映射表（终版，11 行）

> 判定列终版全部为 ⛔ 不替换。#1–#4 曾替换、因视觉增量**已退回**（§4）；#5–#11 为
> 首轮即判不替换、理由不变。每条「不替换」理由 = §2 对应泄漏行 + 设计稿核对。

| # | 手搓落点 | 手搓形态 | 库组件 | 判定 | 理由 |
|---|---|---|---|---|---|
| 1 | `features/chat/components/ErrorStates/FallbackRetryButton.tsx` | `<button className="chat-fallback__retry">` | **Button** | ⛔ 已退回 | 泄漏：height 45px（vs min-height 44px）、font-family（去 Zen Maru Gothic）、inline-flex、weight 600、letter-spacing/line-height/nowrap/transition/position、hover 整体变 teal+上浮、span 包裹。mockup 无对应元素可核对 → 退回。采纳提议见 P2。 |
| 2 | `features/chat/components/ClarifyCard.tsx` — `CandidateOption` / `EscapeHatch` | 2 处 `<button className="chat-clarify__option/escape">` | **Button** | ⛔ 已退回 | 泄漏：height +55%（29→45px）、凭空 box-shadow、font-family、inline-flex、weight 600、hover 叠 teal 字/边框/上浮、span 包裹。mockup `.chip2` 高 ≈41px（padding 10px×2 + 14px 字）——库 45px 与其同量级但**非同一值**，且 hover/字体为 owner 设计域 → 退回。采纳提议见 P1。 |
| 3 | `components/home/ContinueFromCard.tsx` — `ContinueCard` | `<section aria-labelledby className="rounded-2xl …">` | **Card** | ⛔ 已退回 | 泄漏：整卡 cursor:pointer、h2 字重 400→500、hover 上浮、transition；**语义降级**：Card 只渲染 `<div>`，`<section>` landmark 丢失（终审阻断三）。退回后 landmark 完整保留。采纳提议见 P4。 |
| 4 | `components/landing/HeroSceneCard.tsx` — `.scene-card__frame` | `<div className="scene-card__frame">` | **Card** | ⛔ 已退回 | 泄漏：frame 变 cursor:pointer、transition（hover transform 被 unlayered `rotate(3deg)` 压住、不泄漏）。底色/圆角/阴影全由 unlayered 类保住。增量小但仍属视觉变更 → 退回。采纳提议见 P3。 |
| 5 | `components/auth/LoginModal.tsx` | 手写 `role="dialog"` + mask + X 钮 | **Modal** | ⛔ 不替换 | 库 Modal 是 blob `clipPath` 泡 + 内置 Cursor（`!important` 覆盖全子树）+ 默认打字机动画 + 无 X 钮 + 520px 宽；mockup `.sheet` 是 **28px 圆角矩形纸卡** + 右上 X + `min(420px)`。替换必视觉回退。 |
| 6 | `components/auth/LoginForm.tsx` — `ds-button ds-button--primary` / `ds-input` | 手写按钮/输入 | **Button / Input** | ⛔ 不替换 | 库 Button primary 是奶油底而非品牌 teal；库 Input 全 pill + 2.5px 边框奶油底；mockup `.field` 是 16px 圆角边框盒、`.big-btn` 橙色全宽钮。替换即改品牌色/形状；且保留全部覆盖类 = 未真正采纳。 |
| 7 | `components/landing/LandingPage.tsx` — `LandingFooter` | 自写导航 `<footer>`（privacy/github 链接） | **Footer** | ⛔ 不替换 | 库 Footer 是纯装饰森林/海浪剪影带，**无 `children` prop**，无链接承载能力；mockup 无 footer band。替换=删导航链接（功能回退）或叠装饰带（偏离 mockup）。 |
| 8 | `features/chat/components/ChatInput.tsx` | 手写输入与 send/settings 按钮 | **Input / Button** | ⛔ 不替换 | mockup composer 是单个 pill 容器包透明输入 + 内嵌附片钮；库 Input 是独立全宽 pill → 双 pill。D12 语义（恒常 `aria-label` + `aria-describedby` 指向横幅）与库 Input 行为集不匹配。 |
| 9 | `components/landing/HeroSearch.tsx` | 手写输入/按钮/tone 变体 chips | **Input / Button** | ⛔ 不替换 | 同 #8（自绘 pill 容器）；chips 有 gold/mint/plain tone 变体，库 Button 无对应变体（**禁止发明 prop**）；替换需保留全部覆盖类 = 未真正采纳。 |
| 10 | 加载态：`HistoryLoadingGate`、`TypingIndicator`、骨架屏 | 文本 / 三点动画 / `animate-pulse` | **Loading** | ⛔ 不替换 | 库 Loading 是整屏小岛转场组件，与内联 loading 态/骨架屏不是同一层级；仓内另有「加载态用 shadcn Skeleton」规则。 |
| 11 | 分割线：`chat-short-route` 等 `border-top: 1px dashed` | 1px 语义分隔线 | **Divider** | ⛔ 不替换 | 库 Divider 是 12px 高装饰 band（line-brown/wave-yellow 等），与 1px 布局内语义分隔不同层；仓内无「12px 装饰 band」落点。 |

## 4. 视觉增量处置表（每项增量 → 退回 / 提议）

> 按终审指令：**产生视觉增量的替换点一律退回原生实现**；认为值得采纳的，单列「提议」
> 交 owner 定夺，**不自行实施**。

| 增量 | 产生于 | 处置 | 说明 |
|---|---|---|---|
| height 45px（#2 +55%、#1 45 vs 44） | Button middle 固定高 | **退回**（#1 #2） | 高度是 owner 设计域；#2 与 mockup 41px 同量级但非同一值 → 提议 P1 |
| 凭空 box-shadow（#2） | `.animal-btn` 默认阴影 | **退回** | 手写 chips 无阴影，mockup `.chip2` 有 3D 阴影 → 属「向 mockup 靠拢」的设计决定，非本卡职权 → 提议 P1 |
| font-family 切库栈（#1 #2，三语 app） | `.animal-btn` | **退回** | 库栈无 Zen Maru Gothic，日文正文换形；不可接受为默认 → 若采纳需 repo 侧覆盖或库栈修正，见 P1/P2 |
| display:inline-flex（#1 #2） | `.animal-btn` | **退回** | mockup `.chip2` 也是 inline-flex → 提议 P1 中说明，不默认接受 |
| children 包 `<span>`（#1 #2） | Button 实现 | **退回** | 结构性差异，文本上下文变化；采纳需接受或改库 |
| hover 变 teal + 上浮 + 换阴影（#1 #2） | `.animal-btn-default:hover` | **退回** | #1 原本无 hover；#2 原仅背景变 soft。整体 hover 外观属设计决定 → 提议 |
| weight 600 / letter-spacing / line-height / nowrap / transition / position（#1 #2） | `.animal-btn` | **退回** | 逐一构成文本渲染差异 |
| cursor:pointer、transition、hover 上浮（#3） | `.animal-card` | **退回** | #3 卡片含链接，cursor 或可接受 → 提议 P4 中说明 |
| h2 字重 400→500（#3） | `.animal-card` | **退回** | 可见文本变化 |
| `<section>` → `<div>`（#3） | Card 只渲染 div | **退回** | 终审阻断三：语义不得静默丢失；退回后 landmark + aria-labelledby 完整（P4 采纳前置：保留 `<section>` 包层或移除失效 aria-labelledby） |
| cursor:pointer、transition（#4 frame） | `.animal-card` | **退回** | frame 含可交互 slider；增量小仍属视觉变更 → 提议 P3 |
| @font-face 字体接管（style link 一旦存在即生效） | 库 CSS | **退回（link 一并撤回）** | §1.6；采纳前置：先解字体冲突 |

## 5. shim 清除取证（终审阻断一）

### 5.1 上一轮的 3 处 shim（全部已清除）

| # | shim | 位置 | 清除方式 |
|---|---|---|---|
| 1 | 手写 `@radix-ui/react-separator`（index.js/package.json/index.d.ts，注释自称「为让 package root 的静态 ESM import graph 能求值」） | `node_modules/@radix-ui/react-separator/` | `rm -rf node_modules` 后重装；**目录已不存在**（frozen lockfile 无消费者，本就不该装） |
| 2 | 替换库自带 vendored react-dom + 手写 `client.js`（`__require()` 返回 app 的 react-dom） | `dist/es/node_modules/react-dom/` | 重装恢复作者原样：`client.js` 现为作者 Vite interop 包装（`import { __module as e } from "../../_virtual/client2.js"`），且该目录**无 package.json**（作者产物即如此） |
| 3 | 507 个二进制资源改写为 JS data-URI stub | `dist/files/*` | 重装恢复：**stub 计数 = 0**，抽查 `PNG image data` / `SVG` 真实二进制 |

### 5.2 §0.1 结论纠错（上一轮的关键误判）

上一轮 doc §0.1 声称「pnpm store 无 tarball 装不上 @radix-ui/react-separator」。**实测为误判**：

- `pnpm store path` = `~/Library/pnpm/store/v10`，索引中**存在**
  `@radix-ui/react-separator@1.1.11`（peer 范围 `^1.1.10` 满足）以及全部其余可选 peer
  （accordion/checkbox/dialog/label/radio-group/select/switch/tabs/tooltip、gsap 3.15.0），
  版本与 lockfile 所钉一一对应。
- pnpm 对 optional peer 本来就**不自动安装**（`peerDependenciesMeta.optional: true`）——
  缺它从来不是「装不上」而是「没人声明依赖它」；正确修法 = 把它加为 apps/web 的真实
  依赖并更新 lockfile（采纳时才需要，见 5.4）。
- 因果方向：shim 的注释说「CI 装真包所以不受影响」——但干净安装恢复的正是 shim 想
  绕开的三样东西，而**手写 shim 不会被任何 `pnpm install` 重建**。此结论自相矛盾。

### 5.3 干净安装取证（命令与输出）

```bash
rm -rf node_modules
pnpm install --frozen-lockfile --offline
# Progress: resolved 0, reused 1058, downloaded 0, added 1096, done
# Done in 13.8s using pnpm v10.33.2      ← 全程 store 命中，0 downloads
```

装后核验：① `node_modules/@radix-ui/react-separator` 不存在（无消费者，正确状态）；
② `grep -rl 'export default "data:' dist/files/` 计数 0（507 stub 全消失）；
③ vendored `dist/es/node_modules/react-dom/` 恢复作者原样（无 package.json，
`client.js` 为作者 interop 包装）；④ 全树 `grep -rl "Sandbox shim"` 无命中；
⑤ `git status`：node_modules 无任何手改痕迹（本即 gitignored，且物理内容已还原），
`pnpm-lock.yaml` **零 diff**（无依赖变更 → 无 lockfile 变更，两者对应一致）。

### 5.4 采纳卡的正确实施路径（留给 owner 批准后的实施方）

1. `apps/web/package.json` 加真实依赖 `"@radix-ui/react-separator": "^1.1.10"`（store 有
   1.1.11），`pnpm install` 更新 lockfile —— **替代 shim #1**。
2. 库 barrel 顶层静态导入的 507 个 `dist/files/*` 资源与 vendored react-dom：**产物侧**配置
   （vite `optimizeDeps` / `ssr.noExternal` / 资源处理），**不手改 node_modules** —— 替代
   shim #2/#3。SSR 侧若 rollup 无法处理二进制导入，用 `?url` / asset 处理配置而非改写包。
3. `__root.tsx` 接 style link 前，先解 §1.6 的 @font-face 接管冲突。
4. 采纳与否按 §8 提议逐条由 owner 勾选。

## 6. 孤儿 CSS 类清理

**删除清单：无。**

- 4 处替换全部退回 → `chat-fallback__retry` / `chat-clarify__option` /
  `chat-clarify__option--faded` / `chat-clarify__escape` / `scene-card__frame` 全部仍被
  原生 TSX 引用，无一成为孤儿。
- 判定「不替换」的落点（#5–#11）类照旧使用。
- 库 CSS 只作用于 `.animal-*` 命名空间，未与仓内类产生需清理的死规则。
- 上一轮新增的 `server.deps.inline`（vitest.config.ts）已随退回一并还原（无库 import
  时不需要），不属于孤儿 CSS 但属于**孤儿配置**，同列此处备查。

## 7. 门禁（未篡改环境重跑，`rm -rf node_modules && pnpm install --frozen-lockfile --offline` 之后）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `cd apps/web && pnpm test` | ✅ 218 文件 / **1637 测试全绿**（与退回前同数，无测试损失） |
| 覆盖率 | 同上 | ✅ Statements 98.43 / Branches 95.37 / Functions 98.58 / Lines 99.44（config 阈值 98/95/98/99 与卡面 95/94/95/95 地板均过） |
| 类型检查 | `pnpm run typecheck` | ✅ exit 0 |
| lint | `pnpm run lint:oxlint` | ✅ exit 0（--deny-warnings） |
| 构建 | `VITE_SHOWCASE_MODE=false pnpm run build` | ✅ exit 0（client + SSR + Nitro Cloudflare 产物，2.44 MB） |

## 8. 提议（交 owner 定夺；一律未实施）

> 采纳任一条即产生 §2/§4 对应增量；owner 勾选后由实施卡执行，按 §5.4 路径落地。

- **P1 ClarifyCard → Button**（#2）：增量中 inline-flex / box-shadow / 接近高度与 mockup
  `.chip2`（`display:inline-flex; box-shadow:0 3px 0 0 #00000010; padding:10px 17px;
  font-weight:800`，高 ≈41px）**对齐度高**，若 owner 认可「向 mockup 靠拢」则值得采纳；
  需接受或覆盖：font-family 切库栈（日文换形）、weight 600（mockup 是 800）、span 包裹。
- **P2 FallbackRetryButton → Button**（#1）：增量最小（45 vs 44px、weight 600、hover teal、
  font-family/inline-flex/span）；若 owner 接受按钮 hover 整体变 teal 即低风险采纳。
- **P3 HeroSceneCard frame → Card**（#4）：增量仅 cursor:pointer + transition（hover 变换被
  unlayered `rotate(3deg)` 压住；字体/字重因 tag 自带类而不泄漏）；若 owner 接受相框
  悬停变手型即可采纳。
- **P4 ContinueFromCard → Card**（#3）：需先解语义（Card 只渲染 `<div>`）——采纳时保留
  `<section>` 外层或删除失效的 `aria-labelledby`（终审阻断三的两种修法）；增量 = 整卡
  cursor + hover 上浮 + h2 字重 500。
- **P5 ComingSoonPopup → Modal**（C1 已合并，仅提议不实施，避免冲突）：若未来设计稿允许
  blob 对话泡，可用 `Modal`（`typewriter={false}` + 自定义 footer）无损替换。

## 9. 遗留

- `apps/web/package.json` 中的 `animal-island-ui-tailwind@^1.4.1` 依赖**先于本卡存在**
  （本卡未增删依赖），保留；当前无任何源码 import 它（上一轮的 4 处 import 已全部退回），
  仅当 §8 提议被采纳后才产生实际使用。
- `@radix-ui/react-separator` 在采纳卡落地时再提升为真实依赖（§5.4），当前不加——无
  消费者时加依赖属于无谓依赖（会被依赖审查标记）。
