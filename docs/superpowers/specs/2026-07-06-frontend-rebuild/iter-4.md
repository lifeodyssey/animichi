# Iteration 4 — 残す:しおり

详细度:**开工前细化**。Story 数:9(原 7 个产品/enabler story + SD-26 阶段 2 新增的 S4.8/S4.9,见下)。

依赖顺序建议:S4.5(share token enabler)/ S4.7(R2 enabler)可先行 → S4.1 → S4.2 → S4.3 → S4.4;S4.6 依赖 S4.7。S4.8(图搜阶段2粗筛+精排管线)可与対比図/しおり主线并行开发,共享 S4.7 的图片数据管线;S4.9 依赖 S4.8。

**数据访问路径(定案,SD-2)**:S4.5、S4.7 均经 `workers/users` oRPC + Neon,不使用 Supabase RLS 直连——与主 spec §②"全局约定:用户域数据访问路径"一致。

**图片管线(定案,X6)**:所有用户照片的 resize/压缩/合成一律在客户端 canvas 完成,R2 只存最终成品;分享物默认剥 EXIF(GPS 隐私),EXIF 回传维持 opt-in。

**SD-26 阶段 2(图搜精匹配)排期提醒**:阶段 1(LLM vision 粗认作品)已在迭代 1 交付并可独立 releasable;本迭代交付阶段 2(作品内机位精匹配),与対比図/迭代 3 Walk 机位共享参考图数据管线,顺路建索引边际成本最低(SD-26 定案原文)。

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

### S4.4 动态 OG 渲染管线(1200×630,分享页首发模板)+ 対比図入 image sitemap(回填自 SD-27 seo-geo-plan.md §4)

**Scope**(**修订**:此前版本按 `user-journey.md` §6.6 写的"9:16 竖图 satori+resvg しおり视觉"规格已被 SD-27 落地包覆盖——权威规格改为标准 **1200×630** OG 尺寸,文案随页面语言,产物缓存 R2;技术选型(Satori 系 `workers-og` / CF Images)留给 executor 定夺,不锁死实现)。本迭代交付**共享的动态 OG 渲染基础设施**,首个具体模板是 `/s/:id` 分享页(路线缩略图 + 完走站数);作品页模板(cover + 点位数 + 帧对比拼版)因 `/anime/:id` 要到迭代 5 才建,渲染管线在此预留可扩展的模板注册机制,由 `iter-5.md`(S5.1)接入具体作品页模板(不重建管线)。

**设计依据**:`docs/superpowers/specs/2026-07-06-seo-geo-plan.md` §4"sitemap 体系 + 新番 SLA + 动态 OG";迭代 0 的静态 OG(S0.8)是兜底,本 story 不替换兜底逻辑只叠加动态层。

**核心 AC**:
- 快乐路径:请求某完走路线的 OG 图端点返回 1200×630 的有效 PNG,内容为路线缩略图 + 完走站数,文案按请求的页面语言渲染 -> integration
- 快乐路径:生成的 OG 图片产物缓存进 R2,同一分享 token 的重复请求命中缓存而非重新渲染 -> integration
- 空:无代表场景帧的路线回退到通用品牌渐变底,不是破图 -> unit
- 错误:OG 渲染失败(渲染器抛错)时返回 S0.8 的默认静态 OG 卡兜底,不是 500 -> integration
- 扩展性(为 iter-5 接线预留):渲染管线按"模板注册"方式组织(分享页模板为本迭代唯一实现),新增作品页模板时不需改动核心渲染/缓存逻辑 -> unit
- **対比図入 image sitemap**(回填自 SD-27 seo-geo-plan.md §4/§7):经 S4.7 上传并确认的対比図成品图片,由构建/部署时脚本从 Neon `comparison_uploads` 表自动生成 `sitemap-images.xml` 条目(R2 公开 URL + 关联页面 URL),不是手工维护 -> integration

**变更文件**:`apps/web/src/routes/s/$shareToken/og-image.tsx`(边缘渲染路由,模板化)、`apps/web/src/lib/og/renderOgImage.ts`(通用渲染 + R2 缓存)、`apps/web/src/lib/og/templates/shareRoute.ts`、`scripts/generate-image-sitemap.ts`(新增)。

**依赖**:S4.3、S4.7(image sitemap 数据源)。

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

---

### S4.8 图搜阶段 2:作品内机位精匹配(embedding 粗筛 + LLM vision 精排,回填自 SD-26)

**Scope**:图片搜索两阶段架构(SD-26)的阶段 2——阶段 1(LLM vision 零索引粗认作品)已在迭代 1 交付并独立 releasable;本 story 交付候选已压缩到"单一系列"范围内的机位级精匹配管线。**架构确认(SD-26 定案,数据实测修正后)**:Anitabi 数据 [实测:君の名は。68 点抽查] 仅有动画截图字段,**无现实参考照字段**(origin/originLink 只是截图出处署名)——意味着 anime2real(动画帧↔现实照片)是唯一现存的跨域匹配路径,real2real 同域快路初期不存在。因此:
- **embedding 粗筛 = 标配但只是初筛**:系列并集(按 series-aware resolve 归属同一系列的全部作品)→ top 20-30 候选。起手模型 **Gemini Embedding 2**,裁 1536 维 + `halfvec` 存储(Neon pgvector);系统自有 key,**不占用 BYOK 配额**(与用户 BYOK key 无关,这是系统内部检索基建)。
- **LLM vision 精排 = 主力**(不是粗筛的从属环节):对 embedding 粗筛后的候选做 anime2real 推理式比对(而非向量距离),因为只有推理式比对吃得住动画→现实的 domain gap;分批处理,**10-20 张/批**;三个 BYOK provider 族(OpenAI 兼容/Anthropic/Gemini)均需支持 vision 输入。
- **不建 ANN 索引(明确的非目标,非遗漏)**:当前实测规模——单作品 10~600 点,系列合并 1000+([实测]青ブタ全系列 1031、Summer Pockets 374)——在此规模下 `bangumi_id`/系列过滤后的 pgvector 暴力扫描(brute-force scan)保持毫秒级,远低于 HNSW 等 ANN 索引的收益拐点(5-10 万行量级);`halfvec` + 裁维进一步后移这个拐点。全库跨系列搜索(ANN 索引可能才有必要的场景)是 DD-11/DD-12 冻结项,不进本迭代。
- **离线 AB 评测矩阵(硬 AC,以实测定终选,不是拍脑袋选模型)**:{Gemini Embedding 2, Qwen3-VL-Embedding(若有托管 API 可用), Voyage 3.5} × {emb-only, LLM-only, 混合} 六(或视 Qwen3-VL 可用性为四)组合的离线评测,产出准确率/延迟/成本对照报告,最终配置写入代码配置(不是继续讨论)。

**设计依据**:无视觉画布(纯后端检索管线);inputs 第十一节 SD-26 行(图片搜索两阶段完整定案文本)。

**核心 AC**:
- 快乐路径:给定一张查询图片 + 已知系列范围,embedding 粗筛在该系列全部点位(含系列内其他作品的点位并集)中返回 top 20-30 候选,响应时间在可接受范围内(具体阈值由执行者按实测数据定,记入 AC 断言而非猜测)-> integration
- 快乐路径:embedding 粗筛候选经 LLM vision 精排(分批 10-20 张)后返回排序后的最佳匹配点位 + 置信度 -> integration
- 空:候选系列 embedding 尚未建库(冷启动/新作品)时,精排管线优雅降级为对该系列全部点位做直接 vision 批量扫描,而不是报错或返回空结果 -> unit
- 性能门槛(不建 ANN 索引的验证性断言):系列合并规模(≤1200 点位量级)下 pgvector 暴力扫描查询延迟锁定在性能回归测试的阈值内;超过阈值时记录告警并触发 DD-12(ANN 索引)复评,而不是静默劣化 -> integration
- **离线 AB 评测矩阵(硬 AC)**:执行 {Gemini, Qwen3-VL(若可用), Voyage 3.5} × {emb-only, LLM-only, 混合} 的离线评测,产出量化报告(准确率/延迟/成本),并将报告结论落地为实际使用的模型/策略配置(非文档层面的建议)-> eval

**变更文件**:`apps/agent/agent/infrastructure/vision_search/embeddingIndex.py`(新增,粗筛)、`apps/agent/agent/infrastructure/vision_search/visionRerank.py`(新增,精排)、`apps/agent/agent/tests/eval/vision_search_ab.py`(新增,离线 AB 评测)、Neon `spot_embeddings` 表迁移(`halfvec(1536)` 列,经 SD-1 工具链)。

**依赖**:S4.7(共享的图片数据管线)、迭代 1 的 series-aware resolve(系列归属)。

---

### S4.9 反向发现层 2 完整化 + 飞轮 3 打卡照解锁 real2real 快路(回填自 SD-26)

**Scope**:反向发现三层(SD-26 定案)——现场看到眼熟场景但不知道是哪部作品时的识别路径:层 1(LLM 世界知识直认,迭代 1 已免费获得)→ **层 2(GPS 附近搜粗筛 + vision 精排,本 story 完整化)** → 层 3(全库向量搜,DD-11 冻结未来项)。层 2 的粗筛键在迭代 1 已可用(`search_nearby` 现成工具,改用 `ST_DWithin` 地理查询),本迭代补齐层 2 的**精排**半段(复用 S4.8 的 vision 精排管线),使层 2 成为完整可用的识别路径而非只有粗筛。**飞轮 3 战略资产确认(SD-26 实测修正)**:Anitabi 无现实参考照字段(见 S4.8 背景),意味着**打卡照片是唯一的现实参考照片来源**;本 story 交付"逐点位解锁"机制——某点位累积的打卡照片数量达到阈值后,该点位获得 real2real(现实↔现实)快路(比 anime2real 跨域推理更快更准),否则继续走 S4.8 的 anime2real 路径。

**设计依据**:无视觉画布;inputs 第十一节 SD-26 行"反向发现三层"+ 飞轮运行手册(第十一节)"飞轮3 UGC→catalog"关于打卡照片的战略定位。

**核心 AC**:
- 快乐路径:查询图片无法被层 1(LLM 世界知识)直接认出作品,但请求携带 GPS 坐标时,层 2 按 `ST_DWithin` 粗筛该坐标附近的候选点位,再交给 S4.8 的 vision 精排管线确认最终匹配 -> integration
- 空:无 GPS 权限/无坐标数据时,优雅降级为纯层 1 结果(不假装有层 2 候选,不阻断流程)-> unit
- **real2real 快路解锁**:某点位累积的打卡照片数达到预设阈值后,后续对该点位的识别请求标记为可走 real2real 快路(不同于默认的 anime2real 跨域路径);阈值未达到的点位继续走 S4.8 默认路径 -> integration
- 埋点完整性(呼应迭代 1 全信号埋点清单,SD-26 五件套在层 2 完整版下的实际记录):`query_type`/`gps_available`/`layer_hit`(应可标记为 2)/`candidates_shown`/`user_confirmed` 五字段在层 2 命中时被正确记录,供 DD-11(层 3 触发判断)未来复检使用 -> unit

**变更文件**:`apps/agent/agent/agents/tools/search_nearby.py`(粗筛键改用 `ST_DWithin`)、`apps/agent/agent/infrastructure/vision_search/real2realUnlock.py`(新增,解锁判定)、`apps/agent/agent/infrastructure/telemetry/visionSearchEvents.py`(五件套埋点扩展)。

**依赖**:S4.8;迭代 1 的 `search_nearby` 工具与图搜埋点五件套(已定义,本 story 补齐层 2 记录路径)。
