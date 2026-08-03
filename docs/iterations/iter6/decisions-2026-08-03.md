# 决议册 — 2026-08-03(owner 逐项签核)

一天内的全部架构/流程决议,按域归档。执行载体:iter6 milestone + #674 系 + S 线卡。

## 方法论(长期有效)

- **两侧(Python/TS)统一 follow TDD、DDD(战略层)、SOLID、OOP、Clean Architecture**;战术 DDD(聚合根/领域事件/CQRS)不在授权内——模式必须报得出守护的不变量。
- 依赖规则一律**机器守卫**(import-linter / oxlint 约束),不靠纪律。
- PR 合并前必须处理**全部** robot 评论线程(读内容、判定、修或有据拒)与失败 CI。
- 平台能力调研必须**先枚举厂商完整目录**再对照;"平台没有 X"类断言必须当场 docs 核查。

## Secrets / 凭证

| 决议 | 备注 |
|---|---|
| **Pulumi ESC = 唯一账本**(方案 A:GH OIDC + `esc run`) | GH 只留 PULUMI_ACCESS_TOKEN bootstrap;#674 C2/C3 |
| **Pulumi state 留 R2**(owner 否决同迁) | passphrase 保管 + #521 快照 lifecycle 为固有成本,单独记卡 |
| **CF Secrets Store 立即试点**(不等 GA) | 仅 Worker 侧密钥(binding.get() 可达);容器转发链密钥待适配。角色=递送端,非账本 |
| **模型密钥收敛 MiMo-only**(#684) | DeepSeek/OpenAI-compat 立删;Maps 验证后删;Gemini 随 #656——#656 升关键路径 |
| Token 最小权限矩阵 | Pulumi 专用 token 已接线(#675);Neon project-scoped、R2 bucket-scoped 待做 |
| Secret 语义化改名(SUPABASE_DB_URL→AGENT_DATABASE_URL 等) | 随 ESC 迁移批同车,#312 联动 |

## 数据库

- **staging agent DSN 已切 Neon**(2026-08-03 执行完毕);production 随 #312 数据迁移。
- **角色矩阵**(#685):migration_admin / agent_rw / catalog_rw / users_rw / readonly / developer。现状实测:svc 组角色 NOLOGIN、GRANT 从未生效、人人 neondb_owner。起点=wip/catalog-db-roles-salvage。
- **Neon 留任**;CF 托管 PG(PlanetScale 合作款)S1 复评(#681)。
- 迁移权威:Atlas(db/migrations)唯一;supabase/migrations 仅 auth/legacy,**不收新表**(#672 因此撤案)。

## CI/CD

- **per-package pipelines**(pipeline-agent/catalog/users/web/edge/infra.yml)+ **`reusable-*` 命名模板**;全留 monorepo(GH 约束:reusable 必须平铺 .github/workflows/);弃 `_` 前缀。底稿=cicd-rebuild-spec pipeline 章节(#679)。
- **Artifact promotion = git-SHA 不可变 tag**(build-once,staging→prod 同 tag 提升;digest 引用卡内 spike;兜底双重建仅 spike 失败期间临时用,digest mismatch **阻断** prod 非告警)。
- **告警全套**(#678):GHA 失败通知 + Logfire alert 规则 + CF 健康检查(随 C6 生效)。
- **回滚 = 分层手册**(#680):Worker 平台秒回滚止血,容器 tag 重部,迁移走 revert 链;不建自动化。
- Workers Builds 不替代 GHA(无审批门/编排);merge queue 评估在 #671。

## 网络 / 隔离

- **Service bindings 为平台内隔离正解**。Workers VPC 经 docs 定谳:是 Workers→外部私网的出口桥(需 Tunnel/Mesh/WAN),不提供 worker↔worker 隔离;我们无外部私网,无场景(触发条件:未来有自托管资源时复评)。
- **私网收口顺序**:N1 ingest WorkerEntrypoint(#540,独立先行,防注入收益最大)→ N2 hostname cutover(#541,staging 验通后立即,不等产品 launch)→ N3 staging WAF → N4 关 staging workers_dev。
- #529 staging CORS wildcard 保留至 C6,cutover 时收紧。

## CF-native 采纳清单(全目录审计 v2 定谳)

| 采 | 内容 |
|---|---|
| ✅ | purge crons → **Workers Cron Triggers**(=#661 修复形态:消灭 GHA cron) |
| ✅ | `/img/*` → **CF Images** transformations(#682) |
| ✅ | 手写 DO 限流 → 原生 **ratelimit binding**(#680;EdgeGuard 保留预算闩/turnstile) |
| ✅ | **AI Gateway** 前置模型调用(#683;BYOK SSRF 语义须设计期核对) |
| ✅ | **Workers AI** llama-vision 进 #656 eval 候选(预筛层,不预设结论) |
| 观望 | Email Sending(依赖 C6 域名)、Workflows(等 S2 异步批量)、Browser Run(E2E/OG 备选)|
| 不采 | Hyperdrive(neon-http 无 TCP 可池化)、Queues/Pipelines(ingest=同步单飞)、Realtime(WebRTC≠SSE)、AE 做执法(采样≠强一致)、Access 替 WAF |

## 产品分析 / 开关(待落卡,owner 已认可方向)

- **Analytics Engine 做产品埋点** + CF Web Analytics 做 RUM(S 线;现状=零产品分析)。
- **KV 动态开关**替 env-var 重部署翻转 + Workers 灰度部署做 canary;第三方 flag 平台暂不上。

## iter6 执行序(更新)

Wave 2 进行中(B2 #676 / B4 #677 在 PR;B1/B3/D3/E1/E2/R1✅);Wave 3 = C1→C4(含#663)→C5→C2→C3→L1(设计全部已批);#674 系 C0-C7 与 CF-native 卡并行穿插;#656 vision 升关键路径。
