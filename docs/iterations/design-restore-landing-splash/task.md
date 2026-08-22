# 任务文档:Landing + Splash 设计还原

> 创建于 2026-08-20。状态:**进行中(已暂停,待继续)**。
> 本文件是该任务的唯一执行依据;继续任务时先读本文件。

## 1. 目标

将 `apps/web` 的 Landing 页与 Splash 开屏**视觉还原**到设计稿
`docs/archive/design-sync/` 的水准。用户判断当前实现"还差很多"。

基准设计稿(本地 HTML,可用浏览器直接打开确认):

| 页面 | 设计稿 |
|---|---|
| Landing(昼/夜) | `docs/archive/design-sync/Landing - Seichijunrei.html` |
| Splash(动态展示板) | `docs/archive/design-sync/Splash - Seichijunrei.html` |
| Splash(静态版 = 实现目标) | `docs/archive/design-sync/Splash 静态版.html` |

## 2. 已确认决策(用户拍板,勿再变更)

1. **范围**:Landing + Splash 先行;Chat 等复杂页面后续再开。
2. **基线**:worktree 从 `origin/main` 切出(不基于 codex/issue-992-orm)。
3. **验收**:逐页用浏览器并排渲染 mockup 与实现,截图比对迭代。
4. **品牌与文案**:视觉 1:1 还原设计稿;文案走现有三语 i18n 字典;
   **英文 locale 品牌名用 "Animichi"**(SD-16),其余语言沿用「聖地巡礼/圣地巡礼」字标。

## 3. Worktree 信息

- **绝对路径**: `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/design-restore`
- **分支**: `design/landing-splash-restore`(tracking `origin/main`)
- 主工作区路径: `/Users/lumimamini/Documents/Seichijunrei-agent`(分支 codex/issue-992-orm,勿混入)

## 4. 设计稿关键规格(Landing)

来源:`Landing - Seichijunrei.html` 内联 CSS(已通读全文 603 行)。

### 4.1 设计 token(昼)

```
--bg:#f0e8d8  --paper:#f8f8f0  --ink:#794f27  --ink-body:#725d42  --ink-soft:#9f927d
--teal:#19c8b9(主色;hover #3dd4c6 / active #11a89b)  --teal-bg:#e6f9f6
--lavender:#c9c6ef  --lavender-bg:#e7e5fa  --line:#e8e2d6
--radius-card:30px  --radius-pill:50px
--shadow-soft:0 14px 40px -14px #6b563a40  --shadow-card:0 22px 60px -22px #5a3c2055
```

页面背景:3 层 radial-gradient(淡蓝/淡粉/淡绿光斑)+ linear-gradient(#f4f4ec→--bg)。

### 4.2 夜模式(body.night 或 [data-theme="night"])

`--bg:#241b0f --paper:#2e2415 --ink:#f2e6cf --ink-body:#d8c9ac --ink-soft:#a2916f
--teal-bg:#14342e --lavender:#565180 --lavender-bg:#2f2c48 --line:#453a24`,
背景换为深蓝/酒红光斑 + 深色渐变;花瓣 opacity 降到 .3。

### 4.3 结构(单屏,无滚动,scrollHeight=1000@1600×1000)

1. **deco 装饰层**(absolute inset 0,pointer-events none):
   - `foliage-tr` 右上角樱花枝 SVG(已抽出为资源,见 §6);
   - 14 片花瓣 .petal(left%/尺寸/动画时长/延迟各异,已抄录),keyframes fall:
     translateY(-44px)→108vh + translateX(70px) + rotate(440deg);
   - cloud c1-c3(默认 display:none,仅 c3 备用);所有动画遵守 prefers-reduced-motion。
2. **nav 胶囊条**:paper 底 + 2px line 边 + 50px 圆角 + shadow-soft。
   左侧 brand:torii.svg(50px)叠加 fox-curious.svg(32px,水平翻转,左下偏移)+
   双字标「聖地」(ink 色)+「巡礼」(白字 teal 底圆角块,Zen Maru Gothic 700,28px);
   英文 brand = "Animichi"。右侧 teal「Log in」胶囊(17px/700,4px 3D 按压阴影)。
3. **hero 双栏网格**(0.92fr / 1.08fr,≤1080px 变单栏):
   - eyebrow:teal 定位 pin 图标 + 全大写拉丁 "FROM SCREEN TO STREET"(15px/800/字距4px);
   - h1:Lora serif 600,clamp(40px,5.2vw,74px),行高 1.06;
     强调段 <em> teal + 波浪下划线(SVG repeat-x 波纹,stroke #1c9b8e);
   - lede:clamp(17-21px),max-width 30em;
   - 搜索胶囊:paper 底 2px 边,放大镜图标 + input + teal「Start Exploring」
     (18px/800,3D 按压阴影,active 下沉 3px);
   - chips 三个彩色标签(无 "try an example" 引导文字):
     green #e7f4dd/#4e7a2c(星形点阵 icon)· yellow #fdf1cf/#a8801a(音符 icon)·
     blue #e3edfb/#3f6aa6(云 icon)。
4. **右侧对比卡(showcase)**:
   - .compare:paper 底、30px 圆角、padding 15px、rotate(2.6deg)、shadow-card;
   - 和纸胶带 ::before(左上,teal 斜纹)与 ::after(右下,橙黄斜纹);
   - .frame 双列 16/11,圆角 22px overflow hidden;
   - 角标 .tag:「Anime」左上 rotate(-4deg) teal 圆点;「Real」右下 rotate(4deg) 灰点;
   - 中线 3px 白 + 48px 圆形手柄(白底 3px teal 边,双尖括号 SVG);
   - 顶部探头狐狸 fox-lean.svg(top:-96px right:-20px width:202px rotate 3deg);
   - 两颗 spark 星形闪光(#f3b73a / #19c8b9 / #e6883a,twinkle 动画)。
5. **昼夜切换**:固定右下角,纸底胶囊内两个按钮「昼/夜」,选中项 teal 描边高亮
   (mockup 的 #modeTg);非 header 内的单 switch。
6. **登录弹窗**(mockup 内含设计):圆角 28px 纸卡、顶部狐狸图(fox-welcome.svg)、
   圆形关闭钮、带图标输入框(field:focus-within teal 描边)、teal 大按钮、
   细字条款;发送后切换「メールを確認してください」步骤(fox-cheer.svg + 有效期提示条)。

### 4.4 Splash(静态版,实现目标)

- 402×874 手机框;昼 linear-gradient(#f4f0e2→#f0e8d8→#e9dfc8),夜 (#20180e→#241b0f→#1c150c);
- 状态栏 9:41 / 21:07;中部:torii.svg 92px + 字标(12px/900/字距.34em,朱红 #c44a2e;
  英文用 "ANIMICHI")+「聖地巡礼」(Zen Maru Gothic 900,36px)+ tagline「あの画面に、行こう。」;
- 底部:fox-stand.svg 72px + 虚线 ground + 版权行「画像・座標:Anitabi (CC BY-NC-SA 4.0)」+ 小横条;
- 跟系统深浅色,无动画无 JS,≤800ms 消失(现有 CSS 320ms dismiss 保留)。

## 5. 现状差距(截图比对结论)

当前实现(主工作区 992 分支截图):橙色 CTA(设计为 teal)、headline 文案不同
("Turn anime scenes into today's walking route")、无花瓣/樱花枝/和纸胶带/探头狐狸、
无字标双拼色、无右下角昼夜切换、chips 样式不同、登录弹窗未按设计、对比图用须贺神社
webp(设计稿为踏切场景 anime.jpg/real.jpg)。

Splash 已大体接近静态版,差:聖地巡礼字体应为 Zen Maru Gothic 900(现为 Noto Serif JP 700)、
底部版权行文案不同。

## 6. 已完成的前置工作(worktree 内)

1. worktree + 分支创建,`pnpm install` 完成;
2. 设计资源已拷入 `apps/web/public/images/landing/`:
   - `foliage-tr.svg`(从 mockup 抽出的樱花枝)
   - `fox/fox-{curious,lean,welcome,cheer,stand}.svg`
   - `compare/{anime,real}.jpg`、`torii.svg`
   - **待办**:在 `ATTRIBUTIONS.md` 补充以上资源出处(来自 design-sync 设计资产);
3. 字体已下载到 `apps/web/public/fonts/`:
   Lora latin 500/600/700、Nunito latin 800/900、Zen Maru Gothic 900(japanese+latin)。
   **待办**:写进 `src/styles/fonts.css` 的 @font-face(900 Zen 需配 unicode-range,
   与现有 500/700 同模式);注意 `tests/unit/design-token-alignment.test.ts`
   钉死了 Zen faces 列表为 [500,500,700,700],需同步更新该测试。

## 7. 实施计划(继续时按序执行)

1. `fonts.css`:新增 Lora 500/600/700、Nunito 800/900、Zen Maru Gothic 900 @font-face;
   更新 design-token-alignment.test.ts 的 Zen faces 断言;
2. 字典(`src/i18n/dictionaries/{en,ja,zh}.json`,三语结构必须完全对齐,
   i18n-dictionaries.test.ts 校验):
   - eyebrow 三语统一 "FROM SCREEN TO STREET";
   - headline 拆为 `headline_pre` + `headline_em`(em 为 teal 波浪下划线强调段):
     en "Plan the real route behind an "/"anime scene";
     ja "アニメのあのシーンを、" + "今日歩けるルートに変える"(初稿,可微调);
     zh "把动画里的那一幕," + "变成今天能走的路线";
   - lead 按设计稿文案更新(en 用 mockup 原文;ja/zh 翻译);
   - 新增 brand 双段字标键(如 `brand_pre`/`brand_accent`:ja 聖地/巡礼、zh 圣地/巡礼、
     en Ani/michi——teal 块效果保留);
   - comparison alt 文案改为踏切场景;en comparison_real 改 "Real";
   - 删除不再用的 `headline`/`try_example` 键(三语同步删);
3. `src/styles/landing.css` 按 §4 重写(保留测试依赖的类名:
   .scene-card__fox、.comparison + --reveal、.hero-search__*、.landing__login 等);
   夜模式用 [data-theme="night"] 选择器(对接现有 use-theme);
4. 组件:
   - 新增 `LandingDeco.tsx`(樱花枝 img + 14 花瓣 + aria-hidden);
   - `LandingPage.tsx`:挂 deco、brand 双段字标 + torii/fox-curious 图标;
   - `Hero.tsx`:eyebrow pin 图标、headline pre/em、spark 星;
   - `HeroSearch.tsx`:chips 三色 + 图标,去掉 try_example 引导行;
   - `ComparisonSlider.tsx`:图换 compare/{anime,real}.jpg,手柄换双尖括号 SVG;
   - `HeroSceneCard.tsx`:狐狸换 fox-lean.svg,加和纸胶带(CSS)+ spark;
   - `DayNightToggle.tsx`:改固定右下角双按钮(昼/夜),更新对应测试;
   - `LoginModal` 样式按 §4.3-6 调整(globals.css 的 .login-modal*);
   - `Splash.tsx`/globals.css:聖地巡礼 900、版权行文案;
5. 测试同步更新:landing-page / landing / hero-search / comparison-slider /
   hero-scene-card / day-night-toggle / design-token-alignment;新增 LandingDeco 测试
   (覆盖率下限 statements 98 / branches 95 / functions 98 / lines 99,只能升不能降);
6. 每个阶段截图比对 mockup(Playwright 脚本模式已在主工作区 .local/shot-*.cjs 验证:
   1600×1000 视口,昼/夜各一张;mockup 侧需给 image-slot 注 src 渲染完整效果);
7. `pnpm run typecheck && pnpm run lint:oxlint && pnpm test`(apps/web 内)全绿。

## 8. 注意事项 / 坑

- 1-10-50 铁律:函数 ≤10 行、文件 ≤300 行;装饰层拆组件。
- 不准加 eslint-disable / @ts-ignore 等抑制。
- mobile(≤640px)目前切换为 MobileFoxHome(另一套设计),本次不动;
  mockup 的 ≤680px hero 规则只影响 641–1080px 区间。
- fox SVG 单个 ~260KB,后续可考虑优化(本次先还原视觉)。
- 移动端 Splash:owner 2026-08-21 新决策取代了旧的「≤800ms 即出即走、勿加 JS 动画」约束。
  移动端(≤640px)在 `/` 停留 1500ms 后自动 `replace` 进 `/chat`;停留与跳过由
  `src/features/splash/mobile-splash-handoff.ts` 的 JS 计时器驱动,CSS 侧
  `.app-splash[data-splash-dwell="mobile"]` 把消失延迟拉到 1800ms 与之对齐。
  Splash 本身仍无动画(只有 1ms 离散可见性翻转);桌面端仍是 320ms 即出即走。
- design-sync 的 animated Splash(Splash - Seichijunrei.html)只是展示板,不是实现目标。
