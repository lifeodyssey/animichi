# Cloudflare 全产品目录对照审计 v2 — animichi (2026-08-03)

方法:先枚举 developers.cloudflare.com/products/ 全目录 + cloudflare-docs MCC 逐项核状态,再对照仓库。
所有 GA/beta 判断以 docs/changelog 引文为准,非训练记忆。

## 第一步:CF 产品目录枚举(dashboard 可见开发者面全集)

**Developer platform**: Workers(GA)· Pages(GA,维护模式,官方推 Workers)· Durable Objects(GA)· Containers(GA 2025-06)· Queues(GA,$0.40/M ops)· KV(GA)· D1(GA,serverless SQLite)· Workflows(GA)· **Pipelines(open beta**,流式摄取→SQL 变换→R2 Iceberg/Parquet;定价已公布未开始计费)· **Secrets Store(仍 beta**,账户级 secrets,100/账户)· **Workers VPC(beta**,2025-09 公告 VPC Services、2026-04 VPC Networks public beta;beta 期免费)· Workers for Platforms · Sandbox SDK · Artifacts
**AI**: Workers AI(GA,按 token 计费)· AI Gateway(GA,LLM 代理/缓存/BYOK)· AI Search/AutoRAG · Vectorize(GA,仅 paid)· **Browser Run(原 Browser Rendering;REST API GA 2025-04,Playwright GA 2025-09**,免费档 10min/天,$0.09/browser-hr)· Agents SDK · AI Crawl Control
**存储/数据库**: R2(GA,零 egress)· R2 Data Catalog/R2 SQL(open beta)· Hyperdrive(GA,TCP 连接池+查询缓存)· **托管 Postgres/MySQL = PlanetScale 合作(2026 新**:dashboard 内建库、CF 账单代收、经 Hyperdrive 接入 — 非 CF 自营数据库)
**媒体/实时**: Stream(GA,视频托管)· Images(GA;Free 档 5k unique transformations/月,可变换 R2 内图)· **Realtime 系列(RealtimeKit SDK / Realtime SFU / TURN**,WebRTC 音视频,GA)· MoQ
**Email**: **Email Service = Email Routing(GA,收)+ Email Sending(public beta 2026-04-16**,`env.EMAIL.send()`,Workers Paid;2026-06 加 SMTP submission beta)
**安全/边缘**: Turnstile(GA)· WAF/DDoS/Bots/Rate Limiting/API Shield · Access/Zero Trust 全家桶 · Page Shield/Client-side Security · Snippets(GA)
**网络**: Tunnel · Cloudflare Mesh/WAN · Magic Transit · Spectrum · Load Balancing/Health Checks · Argo · Internal DNS
**其他**: Zaraz · Waiting Room · Cache/Cache Reserve · Web Analytics · Logpush/Log Explorer · Registrar/DNS · Terraform/Pulumi provider

## 第二步:四栏判定

### A. 已在用
| 产品 | 现状 |
|---|---|
| Workers | edge `worker/`(wrangler.toml)、`workers/catalog`、`workers/users`、apps/web OpenNext |
| Containers + DO | agent 容器 `wrangler.toml:125`(RuntimeContainer DO `:127`)、EdgeGuard DO `:141` |
| Service bindings | CATALOG/USERS 内网直连 `wrangler.toml:107-113`(`catalog.internal` outboundByHost `:102`) |
| R2 | MAP_TILES `wrangler.toml:121`、catalog 媒体桶 `workers/catalog/wrangler.toml:48`;lazy-R2 照片 `workers/catalog/src/media/img.ts` |
| Turnstile | `worker/turnstile.ts`(+replay/arm 测试) |
| Pulumi provider | `infra/index.ts` |

### B. 该用而未用(逐项评估)
| 产品 | 现状 | 成熟度 | 定价 | 迁移成本 | 判定 |
|---|---|---|---|---|---|
| **Images** | 手写 `/img/*` 代理 `worker/app.ts:331,383` + lazy-R2 原图直出 `media/img.ts`(无缩放/格式协商) | GA | Free 5k unique 变换/月;超出 $0.50/1k;可直接变换 R2 图 | 低:R2 已是源,加 transformations 或 binding 即可,现有 URL 结构可保留 | **该用**。photo-search/点位卡片全是原图字节直出,AVIF/宽度裁剪是白捡的带宽与 LCP;free 档大概率够 |
| **Email Sending** | 无发件能力;Neon Auth 走 Neon 共享发件域(不可品牌化、限流共享) | public beta(2026-04);Routing GA | Workers Paid 含;发到已验证地址免费 | 中:需 animichi.com DNS 先上线(目前零记录),Better Auth `sendMagicLink` 换成 `env.EMAIL.send()` 一个函数 | **该用**(排在 SD-31 auth 割接 + 域名上线之后)。beta 风险可接受:magic-link 丢失可重试 |
| **AI Gateway** | agent 直连 MiMo/Gemini;#284 BYOK 刚做了逐请求注入 | GA | 免费(缓存/日志/限流);付费加高级功能 | 低:改 base_url 即可,容器内 Python 也能走 | **该用-轻量**。给 MiMo/Gemini/BYOK 统一加缓存、审计与故障转移面板,与 Logfire 互补不冲突 |
| **Workers AI(vision,番剧识别)** | photo-search 走 MiMo/Gemini vision(`worker/photoSearch.test.ts`、#479 vision/probe) | GA;llama-3.2-11b-vision $0.049/M in;kimi-k2.6 带 vision $0.95/M in | 按 token | 低(仅 Workers 侧可用 binding;容器内走 REST) | **观望→spike**。通用开源 vision 模型认「圣地实拍照→具体番剧」能力存疑,Gemini 仍是上限;价值是廉价预筛/降级层。先拿 eval 集对 llama-3.2-11b-vision 跑一轮再定 |
| **Vectorize** | S4.8 以图搜图尚无 embedding 底座 | GA | paid:50M queried dims/月含,$0.01/M 超出 | 中:新增索引服务;但数据平面在 Neon | **观望**。先在 Neon 上试 pgvector(单库可与 PostGIS/works 表 join,零新组件);触发条件:pgvector 在目标量级(>1M 向量或 p95 超标)顶不住时切 Vectorize |
| **Workers VPC** | 服务间隔离用 service binding + `catalog.internal` 主张(wrangler.toml:65,102) | **beta**(Services 2025-09、Networks 2026-04);beta 期免费 | beta 免费,GA 定价未出 | 高且无对象:它解决「Workers→Tunnel 后面的私网(AWS/GCP/本地)」 | **无场景**(修正项,见第三步)。我们没有私网;Neon 是公网 SaaS,不在 Tunnel 后。service binding 的隔离主张不被 VPC 替代——两者解决不同问题 |
| **托管 Postgres(PlanetScale via CF)** | 数据面 = Neon(branching/Neon Local/MCP/Atlas 全链路已建) | 合作层新;PlanetScale 本体成熟 | PlanetScale 标价经 CF 账单 | **高**:迁库 + 重建 branch-per-PR/test-infra/Auth(Neon Auth 刚定案 SD-31),还要 Hyperdrive 层 | **观望**。收益(同账单、Hyperdrive 加速)远小于重迁成本;触发条件:Neon 定价/冷启动/耐久性出实际事故 |
| **Hyperdrive** | 显式不用:`workers/catalog/AGENTS.md:16`「no Hyperdrive」;`workers/catalog/wrangler.toml:32-40` 留有注释掉的配置 | GA | Workers Paid 含 | 低 | **无场景(维持,理由核实)**:catalog 用 @neondatabase/serverless neon-http(无状态 HTTP fetch,无 TCP 连接可池化),Hyperdrive 的连接池/缓存收益为零。若未来换 TCP 驱动(postgres.js/pg)则必须重评 |
| **Queues** | ingest 单飞用 `ingest_jobs` 表(`workers/catalog/src/ingest/jobs.ts:1-10`,INSERT..ON CONFLICT 原子夺锁+负缓存) | GA | $0.40/M ops | 中 | **观望**。现设计的核心是**去重/单飞**,DB 行锁比队列语义更贴;Queues 的价值在「请求生命周期外的重试/扇出」。触发条件:enrich 阶段要拆成多步异步重试,或出现批量回填任务 |
| **Pipelines** | catalog ingest 是事务型逐 work 拉取,非流式事件 | open beta(计费未开) | ingress 免费;transforms $0.04/GB | 高 | **无场景**(对 ingest);**观望**(对产品分析事件流:搜索词/巡礼行为→Iceberg,做检索质量标尺时再评) |
| **Browser Run** | e2e 用本地 Playwright(`e2e/`);OG 图为静态 | REST GA、Playwright GA、Stagehand beta | 免费 10min/天;$0.09/hr | 低(REST /screenshot 一个调用) | **观望**。CI e2e 留本地(免费+快);触发条件:要做动态 OG 卡片(每番剧分享图)时用 REST screenshot,免费档够 |
| **Workflows** | ingest 编排在 `workers/catalog/src/ingest/orchestrator.ts` 请求内完成 | GA | Workers Paid 含 | 中 | **观望**。触发条件同 Queues:出现跨分钟级多步 durable 任务(如全量 enrich 回填) |

### C. 观望(其余)
- **Secrets Store**:仍 **beta**(docs 2025-04 起未宣 GA)。现状 wrangler per-Worker secrets ×3 env 触点(已知痛点)。账户级共享能消重,但 beta + 迁移动作多;触发条件:GA 或 secrets 数量再翻倍。
- **KV**:无缓存层诉求(Cache API + R2 覆盖);触发条件:出现高读低写配置面(如 feature flags)。
- **AI Search (AutoRAG)**:检索质量标尺立项后作为对照组候选。
- **Snippets / Load Balancing / Waiting Room / Zaraz / Cache Reserve**:单 Worker 架构下均无当前诉求;流量上量后再看。

### D. 无场景(一句话)
- **D1**:数据面定案 Neon(PostGIS 硬依赖,D1 是 SQLite)。
- **Realtime 全家桶(SFU/RealtimeKit/TURN/MoQ)**:是 WebRTC 音视频,不是消息推送;聊天 SSE(`apps/agent/agent/interfaces/routes/chat.py:347`)完全够,无音视频功能规划。
- **Stream**:无视频内容。
- **Pages**:官方自己在推 Workers,apps/web 已是 Workers 部署。
- **Access/Zero Trust/Tunnel/Mesh/WAN/Magic Transit/Spectrum**:无企业内网、无自有机房、无非 HTTP 协议面。
- **Workers for Platforms / Sandbox SDK / R2 SQL**:无多租户代码托管、无沙箱执行、无 lakehouse 查询需求。
- **Email Routing(收件向)**:无收件产品面(support@ 未来可白捡,随 Email Sending 一起开)。

## 第三步:v1 结论修正
1. **「CF 无 VPC」不成立(v1 结论修正)**:Workers VPC 真实存在 —— VPC Services beta(changelog 2025-09-25 发布、2025-11-05 上线),VPC Networks + Mesh public beta(changelog 2026-04-14),2026-05-21 起可达 WAN on-ramp。但它是「Workers 访问 Tunnel 后私网」,**不是** service-to-service 私网隔离;我们的 service-binding 隔离主张仍然成立且不被其替代。判定从「产品不存在」改为「产品存在、无适用场景」。
2. **Secrets Store 状态(v1 复核)**:截至今日 docs/changelog 仍标 **beta**(2025-04-09 入 beta,后续仅扩容到 100 secrets/账户,无 GA 公告)。v1 若写「GA」为误;若写「beta」维持。
3. **「托管 Postgres/MySQL(新)」定性**:owner 在 dashboard 看到的是 **PlanetScale 合作**(经 Hyperdrive,CF 账单代收,docs hyperdrive/planetscale/ 2026-07-14 更新)——不是 CF 自营数据库,「CF 原生 Postgres」的说法不准确;对 Neon 的替代评估见 B 表(观望)。
4. **Browser Rendering 已更名 Browser Run**,REST API 自 2025-04 起 GA 且有免费档 —— v1 若按「beta/仅付费」评估需更新。

## 行动清单(按收益/成本比排序)
1. **Images transformations 接管 photo 出图**(该用,~半天):`/img/*` 与 media/img.ts 出口加 `/cdn-cgi/image/` 或 binding,AVIF+宽度裁剪,free 档起步。移动端 LCP 直接受益。
2. **AI Gateway 前置 MiMo/Gemini/BYOK**(该用-轻量,~半天):统一缓存/限流/故障转移,顺手给 #284 BYOK 加审计面。
3. **Email Sending 接 Better Auth magic-link**(该用,依赖域名上线 + SD-31 割接,~1 天):摆脱 Neon 共享发件域;顺带把 animichi.com DNS 债一起清。
4. **Workers AI vision spike**(观望→spike,~半天):用现有 photo-search eval 集测 llama-3.2-11b-vision 当廉价预筛层,数据说话。
5. **S4.8 前置决策**:先 pgvector-on-Neon PoC,Vectorize 仅作规模逃生门(写进 S4.8 spec 的 OQ)。
6. **文档修正**:把 v1 审计中「CF 无 VPC」「Secrets Store GA」两处结论按本文第三步更正;`workers/catalog/AGENTS.md:16` 的 no-Hyperdrive 旁注补理由「neon-http 无 TCP 可池化」。
