# 任务文档:Chat 页视觉还原

> 创建于 2026-08-21。状态:**进行中(第 1 批已派工)**。
> 本文件是该任务的唯一执行依据;继续任务时先读本文件。
> 姊妹任务:`docs/iterations/design-restore-landing-splash/task.md`(Landing + Splash,已基本收尾)。

## 1. 为什么优先级最高

owner 2026-08-21 定:**移动端流程 = 开屏 Splash 停留 → 自动进入 `/chat`**
(工作台页面暂未定,先统一进 chat)。

推论:移动端用户**永远看不到 Landing**,他们看到的第一个真实界面就是 chat。
chat 从"某个内页"变成了**移动端主界面**,因此视觉还原优先级高于 Landing 收尾。

## 2. 现状判断

chat 的**功能骨架已完整**——29 个组件、~40 个 feature 模块、99 个单测文件、6 条 E2E;
BYOK、Turnstile、配额、会话过期、流恢复这些实现侧甚至比设计稿更多。

缺的是**皮肤**:只落实了 token 变量名,没落实设计稿的几何、描边、3D 阴影深度、装饰与动效。

## 3. 基准设计稿

本地服务器(会话内起的,重启后需重开):`python3 -m http.server 8090`,根目录见 §7。

| 页面 | 路径 |
|---|---|
| Chat 完整状态(最全,`<style>` 404 行) | `docs/archive/design-sync/Chat 完整状态.html` |
| Chat 初始状态(空态首屏,203 行) | `docs/archive/design-sync/Chat 初始状态.html` |
| Chat 状态总览 | `docs/archive/design-sync/Chat 状态总览.html` |
| DS 补全 — Chat 桌面 | `docs/archive/design-sync/DS 补全 - Chat 桌面.html` |

## 4. 设计稿的视觉语言(把 404 行 CSS 压成 6 条模式)

**这是本任务的核心资产。**逐个组件抄 CSS 会漏、会不一致;按这 6 条模式走才能整体像。

### 4.1 卡片

```
background: var(--paper);  border: 2px solid var(--line);  border-radius: 18px;
overflow: hidden;  box-shadow: 0 14~16px 30~34px -20px #5a3c2066;
入场: cardPop .4s cubic-bezier(.2,.8,.3,1)   /* opacity 0→1, translateY(10px) scale(.985)→none */
```
用于:`.gcard`(spot 组)、`.itin`(行程卡)、`.fcard`(失败态)、map card。

### 4.2 按钮 — 3D 按压

```
border-radius: 50px(--pill);  font-weight: 800;
box-shadow: 0 3~4px 0 0 <同色系深一档>;
:active { transform: translateY(2px); box-shadow: 0 1~2px 0 0 <同色> }
:hover  { transform: translateY(-2px); border-color: var(--teal-bright) }   /* 幽灵/次要按钮 */
```
深色档对照:teal→`--teal-deep`、gold→`--gold-deep`、纸底→`#bdaea0`。

### 4.3 pill 标签

```
border-radius: 50px;  font-weight: 900;  font-size: 11~11.5px;  padding: 3px 10px;
white-space: nowrap;
```
六个色系(底/字):
| 色系 | 底 | 字 |
|---|---|---|
| green | `#e7f4dd` | `#4e7a2c` |
| orange | `#fde9d6` | `#b9682a` |
| red | `#fdeeee` | `#c94444` |
| gold | `#fdf1cf` | `#a8801a` |
| plain | `#f0ece2` | `#7c6c55` |
| teal | `var(--teal-bg)` | `#0e7c72` |

### 4.4 选中 / 已用态

```
选中:  background: var(--teal); color:#fff; border-color: var(--teal);
       box-shadow: 0 3px 0 0 var(--teal-deep);
同组未选中: opacity: .42; pointer-events: none;
```
用于:`.cchip`(clarify)、`.fup`(追问)、`.cand .pick`(候选)、`.srow .pcb`(勾选框)。

### 4.5 分隔线

- 区块之间:`2px solid var(--line)`
- 列表项之间:`1px dashed var(--line2)`

### 4.6 动效(全部要尊重 prefers-reduced-motion)

| 名称 | 用途 | 参数 |
|---|---|---|
| `rowIn` | 消息入场 | `.34s cubic-bezier(.2,.8,.3,1)`,translateY(10px)→0 |
| `cardPop` | 卡片入场 | `.4s` 同曲线,叠 `scale(.985)` |
| `bob` | 空态大狐狸浮动 | `4s ease-in-out infinite`,±7px |

## 5. token 对照(重要:实现侧少了一层)

`globals.css` 注释写「動森 cream triad: page < card < muted」,但和设计稿错了一位:

| 设计稿 | 值 | 实现侧对应 | 状态 |
|---|---|---|---|
| `--bg` 页面底 | `#f0e8d8` 暖米 | **无** | ❌ 缺这一层 |
| `--paper` 纸面 | `#f8f8f0` | `--color-bg` | ⚠️ 被当成页面底用了 |
| `--content` 气泡底 | `#f7f3df` | `--color-card` | ✅ 值正好一致 |

后果:整页少了最暖的底色,且层次方向反了——设计稿是**暗底上浮亮纸**,
实现是亮底上放稍暗的卡。设计稿页面背景还叠了 3 层 radial-gradient 光斑。

**修这层要动 `globals.css` 的全局 token,影响全站,需 owner 确认后单独一批做。**

## 6. 分批计划

### 第 1 批 ✅ 已完成(commit `e76e6fac`)

1. AI 气泡:去掉 `--color-primary-soft` 覆盖,回到 `--color-card` + 2px 边 + 左上尖角 6px
2. 气泡几何:radius 20px、padding 13/17px、15.5px/1.62/500;用户气泡 3D 阴影改 `0 4px 0` teal
3. 狐狸头像:38px + 2px 描边(描边色 `#cdeee8` 无对应 token,待报告)
4. `rowIn` 消息入场动画
5. 空态 hero:108px 大狐狸 + `bob` + Zen Maru Gothic 27px 标题 + 引导气泡
6. chips → pill 形态 + 四色系 3D 阴影(复用既有 `data-tone` 机制)

**第 1 批实测结论**:几何、动效、hero 都到位,但**观感反而更平**——气泡改成 `#f7f3df`
后比近白页面底 `#f8f8f0` 还暗,层次方向是反的。**单独修一层不够,两层的相对关系才是层次。**

第 1 批还挖出两笔债:
- **既有 AA 破损**:用户气泡 `#ffffff` on `#19c8b9` = **2.10:1**(AA 要 4.5);设计稿用 `#073f3a` = 5.62:1
- **描边太硬**:实现 `--color-border:#aaa69d`,设计稿 `--line:#e8e2d6` 几乎只是"暗示"

### 第 2 批 ✅ 已完成(commit `edc2b5b1`)

`--color-bg` → `#f0e8d8`;新增 `--color-paper` / `--color-border-soft` / `--color-primary-ink`;
body 两层光斑渐变;夜间同步。**影响全站** —— 22 处 `var(--color-bg)` 语义分三类
(页面底 / 纸面 / 拿底色当文字色),必须逐处判断。`shiori.css:18,149` 风险最高。

### 第 3 批 ✅ 已完成(commit `e316a83a`)— 输入区 composer(按 executor 建议提前)

页面底变暖后,底部白色直角输入条成了整屏最刺眼的元素。改成设计稿的圆角胶囊 dock,
并实现 spec §G 的五态。**关键做法**:按压影挂在 enabled 键上、`:disabled` 移除它 ——
「能否按」与「有无影」是同一个事实,不会漂移。同批把情绪卡渐变整体压暗
(白字最差点 2.10 → 5.01);夜间 `--color-primary-fg` 会翻转,故夜间单独一套。

### 第 4 批 ✅ 已完成(commit `dcb27c60`)— appbar + dock 对齐 + 夜间软线

- appbar:鸟居+狐狸叠标、三语字标(en=Animichi)、AI GUIDE 副行三语都保持拉丁
  (它是 mark 的字距锁定块,不是句子);
- **⊕ 新会话必须是整页导航**:会话身份是 `chat:${sessionId ?? "draft"}`,从 draft 跳 `/chat`
  scope 不变、组件不重建;只清 messages 又会留下 tracker 里的 server session id;
- 身份槽:pending 不渲染任何占位、anonymous 给登录按钮而非假头像;
- appbar 在 notices **之上且之外**:chrome 不该被瞬时状态挤动,`role="alert"` 也不该被当站点 chrome 念;
- **夜间软线的真正理由是落影消失,不是"夜里更暗"**(按比值夜间 1.37 反而高于日间 1.21):
  日间 `#bdaea0` 投影在 `#f0e8d8` 上有 1.77:1 光晕,胶囊无边框也找得到;夜间投影仅 1.12:1、
  光晕消失,**边框成为唯一边界**,1.4.11 的 3:1 才完整适用。设计稿的"软描边"意图是在
  **有投影托底**的前提下成立的。

### 第 5 批 — 卡片语言(尚未开始)

按 §4.1/4.2 统一 `.chat-card` / `.chat-itinerary` / `.chat-spot-card` / 失败态卡片:
2px 边、18px 圆角、柔投影、`cardPop` 入场、3D 按压按钮。

### (已完成,见上)第 4 批原计划 — 输入区(composer)

设计稿 `.composer`:
```
全圆角胶囊(--pill) + var(--paper) 底 + 2px var(--line) 边
padding: 8px 8px 8px 18px;  box-shadow: 0 12px 28px -16px #5a3c2055;
:focus-within { border-color: var(--teal-bright) }
发送键 .snd: 42px 圆形 + 3D 阴影;未激活 #d8d0bf,激活 var(--orange)
附件键 .att: 36px 圆形
```
当前实现是**直角横条 + 1px 上边框**,差距最大的一处。

### (已完成,见上)第 5 批原计划 — 顶栏 appbar

2px 底边 + torii 叠狐狸的双拼色字标 + 3D 按压按钮 + 38px 头像。
`chat.css` 目前**完全没有 appbar 相关规则**。

## 6.5 待办:移动端流程变更的连带失效

owner 定的「移动端 `/` 停留 1.5s 后 replace 进 `/chat`」(commit `c79e53ec`)让两处失效:

| 文件 | 问题 | 已定修法 |
|---|---|---|
| `e2e/web-splash.spec.ts` | 390×844 访问 `/` 断言开屏 800ms 内隐藏 —— 现在 dwell 1500ms,**必红** | 改指 `/privacy`(仍 320ms 即出即走,保住冷启动契约),**另加** `/` 的 handoff 契约测试 |
| `apps/web/web-cwv.config.ts` | `routes:["/"]` 在移动 profile 测 CWV —— 现在测到一半就跳走,**数字失效且不会报错** | `routes` 改 `/chat`;性能基线换页面,需重新定基线 |

后者是更阴险的一类:**测试继续通过,但测的东西已经不存在了**。

## 6.6 更权威的设计文档(2026-08-21 发现,此前遗漏)

`docs/archive/design-sync/docs/` 下有比 HTML 设计稿更有信息量的规格文档——**带决策理由和实现级 AC**:

| 文档 | 内容 |
|---|---|
| `spec-chat-page-design.md` (123 行) | Chat 页设计契约:双形态分期、7 工具 → 5 种 UI 回合、`selected_point_ids` 旁路 |
| `spec-chat-page-states.md` (142 行) | **状态清单,每态一条 AC** —— 实现级契约,做验收时应对照 |
| `ds-审计.md` (28 行) | 设计系统审计 |
| `DESIGN.md` (255 行) | 動森キャンプ 视觉规范(CI-locked) |

**关键形态结论**(影响后续批次):
```
Phase 1  全端 V3 单列流:组件 inline 插入对话流(≈ 移动端最终形态)  ← 当前实现就是这个,形态正确
Phase 2  桌面 ≥1024px 升级 V1 双栏:同一批组件挂右侧 workspace 面板
         (Artifacts/Canvas "活文档":右栏被多轮对话持续修改)        ← 尚未实现
```
V1 仍是 generative UI —— registry(intent→组件)不变,变的只是挂载点。

## 7. 环境

- worktree:`/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/design-restore`
- 分支:`design/landing-splash-restore`(与 Landing/Splash 同分支)
- dev server:`pnpm dev --port 5210`(chat 页 `/chat`;本地无后端时顶部有红色
  "Can't reach the server",属正常)
- 设计稿服务器:在一个聚合目录内 `python3 -m http.server 8090`,
  该目录软链 `docs/archive/design-sync` 与移动端 mockup

## 8. 注意事项 / 坑

- `chat.css` 顶部规则:**Animal Island semantic tokens only, no raw palette values**。
  设计稿里的 raw hex 不能直接抄进去;缺 token 要先报告,不要自行往 globals.css 加。
- **无障碍不可退化**:`web-a11y-*` E2E + WCAG 2.2 AA 门禁(#1015)。
  触控目标 ≥44px、对比度、动效可关闭。AI 气泡从薄荷绿改米色后**必须重测对比度**。
- 覆盖率下限 statements 98 / branches 95 / functions 98 / lines 99,**只能升**;
  branches 余量最小(~0.85 点)。
- 禁止一切抑制指令;命名按 `.claude/rules/naming-ownership.md`。
- `chat.css` 已 1265 行,分区按 issue(S1.x)组织;改既有规则优先于新增。
- 素材:`apps/web/public/images/chat/fox-guide.webp`、`fox-thinking.webp`。


## 9. 2026-08-22 追加发现

### 9.1 CTA 层级:设计稿在这一点上是「旧屏未回刷」

`docs/DESIGN.md` §142-143(動森キャンプ 视觉规范,CI-locked)**点名了具体按钮**:

> **Explore**: Pumpkin orange ≈ `#e8742e` — the primary marketing action color —
> `Start Exploring`, `Save my route`, `Send login link`. …
> Reserved for the single dominant action per surface; **the header Login stays a quiet cream pill**.
> **CTA**: Gold `#f0b429`. … on marketing/landing surfaces, prefer explore orange —
> gold read as low-contrast "disabled" at hero scale.

`DS 补全 - Chat 桌面.html` 的 decision log 同向:「CTA 层级改判:金=唯一主行动、teal 降为
interactive、explore 橙仅 marketing+send 键 → **旧屏 teal CTA 待回刷**」。

⇒ `Landing - Seichijunrei.html` 把 CTA 画成 teal 属于**未回刷的旧屏**。owner 2026-08-22 拍板回刷
(commit `9c8b248f`)。**教训:HTML 设计稿不是最高权威,DESIGN.md + DS decision log 才是。**

### 9.2 上游组件库验证了第 2 批的取值

`node_modules/animal-island-ui-tailwind`(owner 指引参考)的 token 与第 2 批**逐一相同**:
`--animal-bg-color #f8f8f0`(=我们的 `--color-paper`)、`--animal-bg-color-secondary #f0e8d8`
(=`--color-bg`)、`--animal-bg-color-content #f7f3df`(=`--color-card`)、
`--animal-border-color-light #e8e2d6`(=`--color-border-soft`)。

⇒ 第 2 批不是自创,是把上游本来就有的三层补了回来(实现此前漏用了 `-secondary` 那层)。
**上游整个色板没有橙**(只有 teal/gold/red/green),所以 explore 橙是我们品牌层的扩展,
不是组件库资产 —— 这正是 `--color-explore-*` 会漂移成一对 teal 的原因。

### 9.3 `bubble-ink #073f3a` 是正式裁决,但只覆盖成段正文

`DS 补全 - Chat 桌面.html` decision log:07-02 待裁决(A 底加深 `#0e8578` / B 深字 `#073f3a`),
**07-03 定 B 案**,token 名 `bubble-ink`。裁决理由明确区分:
「上游对**短标签**接受低对比白字 on teal;**气泡是成段正文,按 AA 取正文级**」。

⚠️ 实现侧第 2 批新增的 token 叫 `--color-primary-ink`,与 DS 的 `bubble-ink` **命名不一致**,
是个待对齐点。

### 9.4 并行瓶颈已解

同树多 executor 并发跑 vitest 会互删 `coverage/.tmp/*.json` 产生 ENOENT 假红。
**解法(已实测有效)**:`pnpm exec vitest run --coverage --coverage.reportsDirectory=<独立目录>`。
不必为每个 executor 单开 worktree。

### 9.5 未决 / 待办

| 项 | 状态 |
|---|---|
| `web-a11y-axe` login-modal 红 | 根因 `globals.css:598` 白字 on teal 2.09;DESIGN.md 点名该按钮属 explore 橙。**修复进行中** |
| `e2e/web-splash.spec.ts` + `web-cwv.config.ts` | 移动端流程变更的连带失效。**修复进行中** |
| 日间 `--color-border` 2.28:1 / `--color-border-soft` 1.21:1 | 按 1.4.11 同样不达标(axe 不查非文字对比故不红)。改动影响全站视觉,**待 owner 定** |
| `chat.css` 1566 行 | 远超 300 行上限,建议按 S1.x 分区拆成 `@import`。独立重构 |
| 空态 hero 收口 | 设计稿 chips 是奶油底,实现是三色 tint;lead 气泡文案密度不同 |
| 登录态 appbar 实机验证 | 需 `make local-login`,建议交给 tester |
| `compare/anime.jpg` 版权 | 1920×1080 全帧、带 CoMix Wave Films 水印、现为首页主视觉;许可未确认。见 `apps/web/public/images/landing/ATTRIBUTIONS.md` |
