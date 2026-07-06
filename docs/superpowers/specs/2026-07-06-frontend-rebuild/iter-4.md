# Iteration 4 — 残す:しおり

详细度:**开工前细化**。Story 数:7。

依赖顺序建议:S4.5(share token enabler)/ S4.7(R2 enabler)可先行 → S4.1 → S4.2 → S4.3 → S4.4;S4.6 依赖 S4.7。

**数据访问路径(定案,SD-2)**:S4.5、S4.7 均经 `workers/users` oRPC + Neon,不使用 Supabase RLS 直连——与主 spec §②"全局约定:用户域数据访问路径"一致。

**图片管线(定案,X6)**:所有用户照片的 resize/压缩/合成一律在客户端 canvas 完成,R2 只存最终成品;分享物默认剥 EXIF(GPS 隐私),EXIF 回传维持 opt-in。

---

### S4.1 しおり版式族(切符/一枚看板/アルバム格子/ポスター fallback)

**Scope**:构建 4 种版式(切符 ticket / 一枚看板 poster-single / アルバム格子 album-grid / ポスター fallback),按枚数驱动的选择逻辑。

**设计依据**:`しおり share 状态总览.html`(版式族);`しおり demo.html`(逐枚勾选实时换版式)。

**核心 AC**:
- 快乐路径:不同照片数量正确切换到对应文档版式(切符/看板/格子)-> browser
- 空:零照片选中时回退到 ポスター fallback 版式,不是破损的空切符 -> browser
- 错误:超出常规范围的照片数量(极端多张)仍能收敛到某个有效版式(album-grid 高密度模式),不崩溃 -> unit

**变更文件**:`apps/web/src/components/shiori/layouts/{Ticket,PosterSingle,AlbumGrid,PosterFallback}.tsx`、`apps/web/src/lib/shiori/layoutSelector.ts`。

**依赖**:无(本迭代地基)。

---

### S4.2 しおり生成屏(計画版/完走記念版)+ EXIF 默认剥离(X6)

**Scope**:从路线+打卡数据自动合成しおり(用户无需手动编辑),按路线数据态(主 spec §8.2 Q2 默认)产出 計画版(无✓)或 記念版(带✓+完成率)。

**设计依据**:`しおり share 状态总览.html`(生成屏×2);`spec-route-detail.md` §3(CTA 文案证据,Q2 默认已定);主 spec X6。

**核心 AC**:
- 快乐路径:完走路线自动生成带✓与完成统计(徒歩N分・Nkm・时刻窗)的記念版预览,无需任何手动输入 -> browser
- 快乐路径:未完走/计划中路线生成無✓的計画版预览 -> browser
- 空:零打卡且非"今日"的路线仍生成某个有效計画版预览,不是空白 -> browser
- **X6 硬 AC**:任何流入しおり图像的用户照片内容在渲染进可导出图片前默认剥离 EXIF(GPS);需勾选 opt-in 才保留 -> unit
- i18n:計画版/記念版标签与统计文案按 ja/zh/en 渲染 -> unit

**变更文件**:`apps/web/src/components/shiori/ShioriGenerator.tsx`、`apps/web/src/lib/shiori/compose.ts`、`apps/web/src/lib/image/exifStrip.ts`。

**依赖**:S4.1。

---

### S4.3 `/s/:id` 公开分享页(SSR)+ SW network-first 落地验证(X7)

**Scope**:公开只读分享页,选择性 SSR(G3)渲染,展示"✓作者已走完"徽章+动画帧×实拍并列+「自分用にアレンジ」CTA 深链进 chat A2b;移动端完走/计划两态 + 桌面态。

**设计依据**:`しおり share 状态总览.html`(公开页×3);`user-journey.md` §3.1(公开分享页描述);主 spec X7。

**核心 AC**:
- 快乐路径:请求 `/s/:id`(完走路线)在未执行任何客户端 JS 前(view-source 级别)已含路线标题与✓徽章的服务端渲染 HTML -> browser
- 快乐路径:「自分用にアレンジ」CTA 导航进 chat 并预填 A2b 引用上下文卡 -> browser
- 空:不存在/已撤销的分享 token 渲染"このページは見つかりません"等效 404,不是破损半页 -> browser
- **X7 硬 AC**:在已激活 service worker(S3.6)的情况下,请求 `/s/:id` 不会返回陈旧缓存的 HTML——用浏览器测试切换网络条件验证 network-first 生效 -> browser
- i18n:页面按 locale/query 渲染 ja/zh/en -> unit

**变更文件**:`apps/web/src/routes/s/$shareToken.tsx`(SSR loader)、`apps/web/src/components/share/*`、`apps/web/src/sw.ts`(扩展 network-first 规则覆盖此路由)。

**依赖**:S4.2、S4.5(分享 token 数据源)。

---

### S4.4 `/s/:id` 动态 OG/Twitter 卡

**Scope**:SSR 生成的 OG meta + 动态渲染的 9:16 竖图(satori+resvg),用于社交链接预览,视觉对齐しおり本体。

**设计依据**:`user-journey.md` §6.6"OG 竖图技术与设计"(satori+resvg PNG、封面帧渐变、打卡清单、完成率)。

**核心 AC**:
- 快乐路径:请求某完走路线的 OG 图端点返回与しおり视觉构图一致的有效 PNG -> integration
- 空:无代表场景帧的路线回退到通用品牌渐变底,不是破图 -> unit
- 错误:satori/resvg 渲染失败时返回 S0.8 的默认 OG 卡兜底,不是 500 -> integration

**变更文件**:`apps/web/src/routes/s/$shareToken/og-image.tsx`(边缘渲染路由)、`apps/web/src/lib/og/renderShioriImage.ts`。

**依赖**:S4.3。

---

### S4.5 分享 token 后端 enabler(`workers/users` oRPC + Neon,SD-2 定案)

**Scope**:发放与公开解析路线分享 token。

**设计依据**:无视觉画布。

**Backend enabler(定案)**:Neon 新表 `route_shares`(`id`、`route_id` FK、`share_token UNIQUE`、`created_by` user_id、`created_at`、`view_count`);`workers/users` 新增两类端点——鉴权端点 `users.shares.create`(仅 owner)+ **公开**端点 `users.shares.resolve`(按 token 查询,无需 JWT,面向匿名访客只读);`apps/web` 的 `/s/:id` SSR loader 直接服务端调用这个公开 oRPC 端点(服务端到服务端,不是浏览器直连 Neon)。

**核心 AC**:
- 快乐路径:为自己拥有的路线创建分享返回 token;经公开端点解析该 token 返回路线摘要,无需鉴权 -> integration
- 空:解析不存在的 token 返回干净的"未找到"响应,不是 500 -> unit
- 错误:尝试为不属于自己的路线创建分享被拒绝(403)-> integration

**变更文件**:`workers/users/src/db/schema.ts`(新增 `route_shares`)、`workers/users/src/api/shares.ts`(新增,含公开只读子路由)、`packages/contract/src/users-contract.ts`(新增分享契约)。

**依赖**:S2.8。

---

### S4.6 対比図作成流程(客户端 canvas 管线,X6)

**Scope**:CMP-0 構図確認 → 1 現場撮影(getUserMedia ghost 叠加)→ 2 写真を選ぶ → 3 合成(canvas)→ 4 完成,共 5 态;HEIC 警告;EXIF opt-in。

**设计依据**:`対比図作成 状态总览.html`;`対比図作成 demo.html`(真 getUserMedia+canvas 合成);主 spec X6、X10。

**核心 AC**:
- 快乐路径:流程从 CMP-0 走到 CMP-4,产出的对比合成图完全经客户端 canvas 完成(合成本身不经服务端往返)-> browser
- 空:未授予相机权限时优雅降级到"写真を選ぶ"(上传既有照片)路径,不是死路 -> browser
- 错误:选择 HEIC 文件显示文档规定的警告("JPGで保存"指引),不是静默渲染失败 -> browser
- **X6 硬 AC**:源照片的 resize/压缩在任何上传前于客户端完成;最终合成图默认剥离 EXIF,除非用户 opt-in -> unit
- 经由适配层(X10):`getUserMedia` 访问一律走 `platform.camera` -> unit

**变更文件**:`apps/web/src/components/comparison/*`、`apps/web/src/lib/comparison/canvasComposite.ts`、`apps/web/src/platform/camera.ts`。

**依赖**:S4.7(最终成品上传)。

---

### S4.7 图片上传 R2 enabler(presign worker 路由)

**Scope**:用户生成的对比图/しおり素材的预签名上传流程。

**设计依据**:无视觉画布。

**Backend enabler(定案)**:root Worker(`worker/app.ts`)新增一个轻量路由,签发限定 R2 bucket `seichijunrei-assets` 的 `/uploads/{user_id}/` 前缀、短 TTL 的 presigned PUT URL(鉴权走 JWT);上传成功后 `apps/web` 经 `workers/users` 的 oRPC 端点写入元数据(Neon 新表 `comparison_uploads`:`id`、`user_id`、`point_id`、`r2_key`、`exif_opt_in`、`created_at`)。

**核心 AC**:
- 快乐路径:请求 presigned URL 并直接 PUT 图片到 R2 成功,产生的 `r2_key` 经 `workers/users` 记录 -> integration
- 空:零既有上传记录的用户仍能正常请求第一次 presign,不报错 -> unit
- **安全 AC**:为用户 A 的前缀签发的 presigned URL 不能被用来写入用户 B 的前缀(路径由服务端限定,不信任客户端传入的路径参数)-> integration

**变更文件**:`worker/r2Presign.ts`(新增)、`worker/app.ts`(接入路由)、`workers/users/src/db/schema.ts`(新增 `comparison_uploads`)、`workers/users/src/api/uploads.ts`(新增)。

**依赖**:S2.8、S0.4(R2 bucket 已建)。
