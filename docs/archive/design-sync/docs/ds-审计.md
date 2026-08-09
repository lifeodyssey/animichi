# DS 审计 — Animal Island UI × Seichijunrei Chat 桌面（2026-07-02）

> 结论：**品牌层强（狐狸人格/语气/按钮影深/色彩铁律），系统层 ~50%，撑不起桌面工作台**。补全交付 = `DS 补全 - Chat 桌面.html`（视觉规范画布，值以它为准）。

## 判定依据（standard DS checklist）
| 层 | 状态 | 缺口 |
|---|---|---|
| Token（色/字/形） | ✓ 强 | 地图色板未收编（画布私造）、spacing/radius scale 未成文、z-index 无梯 |
| 图标 | ✗ | 手绘 SVG 描边 2–2.4 飘忽，无网格/尺寸档 |
| 基础组件 | 半 | 无 modal/sheet/toast/select/segmented/switch/filter-chip/skeleton/empty 规范 |
| 状态矩阵 | ✗ | disabled/loading/error 散落个案 |
| 产品组件 | ✗ | TimedItinerary/足迹行/点位卡格/圈总览/澄清chips/重排条 spec 有、DS 无 |
| A11y | 半 | focus 黄✓/44px✓；#9f927d 小字对比 ~2.8:1 FAIL、白字 on teal ~2.1:1 FAIL、aria-live/焦点陷阱/reduced-motion 未声明 |
| 布局 | ✗ | 桌面 grid（760 线程/440 栏/1024 阈值）散落 spec |
| 动效 | 半 | 有时长+bezier，无角色分工；「毕业转场」零规范 |
| 治理 | ✗ | 无 decision log/单一来源；金 CTA 中途改，旧屏 teal 未回刷 |

## 分期
- **P0（本轮）**：token 补遗 + 图标系统 + 基础组件状态矩阵 + overlay 三件套 + 生成式家族规范 + A11y 规则 + 动效角色 + decision log → 全部进补全画布
- **P1**：对比度修正落地（teal 文字 token/用户气泡二选一）、aria-live 实装规则
- **P2**：毕业转场 storyboard（待舞台模型裁决）
- **P3**：旧屏回刷清单执行（Step 6）

## 已裁决记录（来自 journey 走查讨论）
- 出发时间+地点 = **必问**（说全则跳过）；「いまいる場所から」→ 定位授权卡入主线（C4 并入）
- 先做桌面；接驳电车/transit 段 = roadmap，本期徒步 only
- 舞台毕业模型（对话→地图滑移）= **提案，待裁决**
- しおり 计划版/完走版之分 = 待裁决
