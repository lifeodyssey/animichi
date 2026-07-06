# Iteration 6 — 工作台(Chat Phase 2 桌面双栏)

详细度:**开工前细化**。Story 数:6。

依赖顺序建议:S6.1 → S6.2 → {S6.3, S6.4} → S6.5 → S6.6。

**架构前提**:本迭代复用 Iteration 1 建立的 generative UI registry(组件不变,只是挂载点从"流里"变成"右栏"),不重新设计组件——见 `generative-ui.md`"Phase 2(环闭合后)"与 `spec-chat-page-design.md` §2 的双形态分期决策。

**Generative UI 宪法提醒([提案待确认],见主 spec §②)**:本迭代的 lightbox/草稿编辑/锚点委托等新组件同样应遵守"LLM 只填数据不产 UI 代码、payload URL 只来自白名单来源"的原则(该宪法本身待用户确认,但若确认后,本迭代新增组件也在适用范围内,不需要额外补 story,Reviewer checklist 层面覆盖即可)。

---

### S6.1 桌面双栏 shell(F1-F4)

**Scope**:≥1024px 视口的左右双栏骨架——右栏空态(F1 虚线框 quiet)、右栏 skeleton(F2)、宽度回流(F4)。

**设计依据**:`工作台 - 地图常驻方案.html`;`spec-chat-page-states.md` §F(F1-F4)。

**核心 AC**:
- 快乐路径:≥1024px 且无路线时,右栏显示 F1 虚线框 quiet 态,左栏正常运作 -> browser
- 快乐路径:右栏只在视觉工具(搜索/plan_route)实际运行时显示 F2 skeleton(地图带+卡片骨架),纯文字回合永不触发 -> browser
- 空:F1 空态不显示任何教学浮层/提示气泡(遵循"UI 保持安静"原则)-> browser
- 错误:会话中途跨越 1024px 断点的窗口缩放(F4)正确把右栏组件回流进消息流原位,不丢失滚动位置 -> browser

**变更文件**:`apps/web/src/components/chat/workbench/WorkbenchLayout.tsx`、`apps/web/src/components/chat/workbench/EmptyPanel.tsx`。

**依赖**:S1.1-S1.5(复用 Phase 1 组件,registry 不变)。

---

### S6.2 右栏常驻地图 + hover 双向锚定(E3)

**Scope**:右栏持续显示地图;左栏消息/站行与右栏地图 pin 之间的 hover 双向高亮。

**设计依据**:`工作台 - 地图常驻方案.html`;`spec-chat-page-states.md` §E3。

**核心 AC**:
- 快乐路径:hover 左栏消息/站行,右栏对应 pin 弹跳放大高亮,反之亦然 -> browser
- 空:hover 无可锚定内容的消息(如纯文字回复)不产生任何效果(无报错、无幽灵高亮)-> unit
- 错误:快速连续 hover 多行不产生高亮闪烁/竞态(防抖处理)-> browser

**变更文件**:`apps/web/src/components/chat/workbench/PersistentMap.tsx`、`apps/web/src/lib/chat/workbench/anchoring.ts`。

**依赖**:S6.1、S0.4(MapLibre)。

---

### S6.3 Lightbox 機位浏览器

**Scope**:一点多图的全屏 lightbox 浏览器,逐帧翻页 + 话数时间戳。

**设计依据**:`user-journey.md` §6.5 J10(多图分层露出);`工作台 - 地图常驻方案.html`(lightbox)。

**核心 AC**:
- 快乐路径:打开有多张候选カット的点位显示完整 lightbox,逐帧翻页并带话数时间戳 -> browser
- 空:只有 1 张照片的点位跳过多页 lightbox chrome(直接显示单图)-> browser
- 错误:lightbox 内某帧图 404 降级为 D9 渐变占位,不是浏览过程中出现破图 -> browser

**变更文件**:`apps/web/src/components/chat/workbench/SpotLightbox.tsx`。

**依赖**:S6.1。

---

### S6.4 エリア/話数分组同步

**Scope**:左侧参照与右栏卡片分组(エリア⇄話数)保持同步。

**设计依据**:`user-journey.md` §6.9(桌面"内容很多"三层消化);`spec-chat-page-states.md` 既定分组规则。

**核心 AC**:
- 快乐路径:在左侧切换 GroupToggle(エリア/話数)后,右栏卡片分组以相同分组键同步重排 -> browser
- 空:数据只有单一区域/话数(无可分组)时显示单个未分组区段,不是空的分组壳 -> unit
- 错误:滚动过程中切换分组保持用户当前阅读位置,不跳回顶部 -> browser

**变更文件**:`apps/web/src/components/chat/workbench/GroupToggleSync.tsx`。

**依赖**:S6.1、S6.2。

---

### S6.5 SP8 大规模草稿编辑模式

**Scope**:>100 点位结果自动反转为"编辑草稿"模式(agent 预选 8 件 + 名場面 TOP 横滚 + 折叠区域组头)。

**设计依据**:`spec-chat-page-states.md` SP8;`journey-走查.md` §2(规模分档)。

**核心 AC**:
- 快乐路径:>100 点位结果自动切换为草稿编辑模式(agent 预选 8 件 + 横滚名場面 TOP + 折叠区域组头),不是平铺列表 -> browser
- 快乐路径:点击预选项的「入れ替え」提供 3 个同区域/相近时间成本的邻近候选做局部替换(不是全局重选)-> browser
- 空:恰好 100 点位的边界情况按一个明确规则(取其一模式)确定性处理,不在两种模式间闪烁 -> unit
- 错误:替换零邻近候选的项显示明确的"代替候補なし"提示,不是破损的空替换菜单 -> browser

**变更文件**:`apps/web/src/components/chat/workbench/DraftEditMode.tsx`、`apps/web/src/lib/chat/workbench/nearbySwapCandidates.ts`。

**依赖**:S6.1、S1.4(点位卡组件复用)。

---

### S6.6 SP9 锚点委托

**Scope**:用户标记 1-3 个"絶対行く"锚点,其余交给 agent 围绕锚点+时间预算补全。

**设计依据**:`spec-chat-page-states.md` SP9;`user-journey.md`(把"从 300 选 8"变成"说 2 个必去+委托")。

**核心 AC**:
- 快乐路径:标记 1-3 个锚点后选择"残りはおまかせで埋める"触发 agent 回合(带管线戏),围绕锚点与时间预算补全草稿其余部分 -> integration
- 空:零锚点直接选"おまかせ"仍产出有效草稿(等效于默认的 agent 预选行为)-> unit
- 错误:标记的锚点相互不兼容(如时间预算内距离过远)时显示警告 chip,而不是静默生成不可行路线 -> browser

**变更文件**:`apps/web/src/components/chat/workbench/AnchorDelegation.tsx`。

**依赖**:S6.5。
